"""Reconcile a single Current MainMarket USDC repayment at its Sui checkpoint."""
import argparse
import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ENDPOINT = "https://graphql.mainnet.sui.io/graphql"
PACKAGE = "0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf"
MARKET = PACKAGE + "::market_type::MainMarket"
USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
DEBT = ("0x" + "2".zfill(64) + "::dynamic_field::Field<0x" + "1".zfill(64)
        + "::type_name::TypeName," + PACKAGE + "::debt::Debt>")
SCALE = 10**18
TX_QUERY = """
query Receipt($digest: String!) {
  transaction(digest: $digest) {
    digest
    effects {
      status timestamp checkpoint { sequenceNumber }
      events(first: 40) { pageInfo { hasNextPage } nodes { sequenceNumber contents { type { repr } json } } }
      objectChanges(first: 40) {
        pageInfo { hasNextPage } nodes { address inputState { ...State } outputState { ...State } }
      }
    }
  }
}
fragment State on Object {
  version owner { ... on ObjectOwner { address { address } } }
  asMoveObject { contents { type { repr } json } }
}
"""
POSITION_QUERY = """
query Position($id: SuiAddress!, $checkpoint: UInt53!) {
  object(address: $id, atCheckpoint: $checkpoint) {
    address version asMoveObject { contents { type { repr } json } }
  }
}
"""


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def query(document, variables, field):
    request = Request(ENDPOINT, data=json.dumps({"query": document, "variables": variables}).encode(),
                      headers={"Content-Type": "application/json", "User-Agent": "Current-receipt/1"})
    with urlopen(request, timeout=30) as response:
        result = json.load(response)
    require(not result.get("errors"), "Historical data query failed: " + str(result.get("errors")))
    record = result["data"][field]
    require(record is not None, "Historical " + field + " unavailable")
    return record


def contents(state):
    return ((state or {}).get("asMoveObject") or {}).get("contents") or {}


def only(records, reason):
    require(len(records) == 1, reason)
    return records[0]


def uint(value):
    require(re.fullmatch(r"[0-9]+", str(value)), "Expected an unsigned integer")
    return int(value)


def event_for(tx):
    effects = tx["effects"]
    require(effects["status"] == "SUCCESS", "Transaction did not succeed")
    for key in ("events", "objectChanges"):
        require(effects[key]["pageInfo"]["hasNextPage"] is False, "Incomplete " + key)
    event = only(effects["events"]["nodes"], "Requires one transaction event")
    content = event["contents"]
    require(content["type"]["repr"] == PACKAGE + "::repay::RepayEvent", "Expected Current RepayEvent")
    body = content["json"]
    require(body["market"] == MARKET[2:] and body["asset"] == USDC[2:], "Unsupported market or asset")
    require(uint(body["refund"]) == 0 and uint(body["amount"]) > 0, "Requires a positive repayment with zero refund")
    return event


def fetch(digest):
    tx = query(TX_QUERY, {"digest": digest}, "transaction")
    event = event_for(tx)
    checkpoint = uint(tx["effects"]["checkpoint"]["sequenceNumber"])
    position = query(POSITION_QUERY, {"id": event["contents"]["json"]["obligation"], "checkpoint": checkpoint}, "object")
    return {"transaction": tx, "positionCheckpoint": checkpoint, "position": position}


def usdc(raw):
    integral, fractional = divmod(abs(raw), 10**24)
    return ("-" if raw < 0 else "") + (f"{integral}.{fractional:024d}").rstrip("0").rstrip(".")


def reconcile(digest, evidence):
    tx, position = evidence["transaction"], evidence["position"]
    require(tx["digest"] == digest, "Digest differs from requested transaction")
    effects = tx["effects"]
    event = event_for(tx)
    body = event["contents"]["json"]
    checkpoint = uint(effects["checkpoint"]["sequenceNumber"])
    require(evidence["positionCheckpoint"] == checkpoint, "Position checkpoint mismatch")
    p = contents(position)
    require(p["type"]["repr"] == PACKAGE + "::obligation::Obligation<" + MARKET + ">", "Unexpected position type")
    obligation = body["obligation"]
    require(position["address"] == p["json"]["id"] == obligation, "Obligation mismatch")
    parent = p["json"]["debts"]["table"]["id"]

    changes = effects["objectChanges"]["nodes"]
    candidates = [c for c in changes if any(contents(c[k]).get("type", {}).get("repr") == DEBT
                                             for k in ("inputState", "outputState"))]
    change = only(candidates, "Requires exactly one changed Current debt field")
    records = []
    for k in ("inputState", "outputState"):
        state = change[k]
        field = contents(state)
        require(field.get("type", {}).get("repr") == DEBT, "Missing paired debt object versions")
        data = field["json"]
        require(data["id"] == change["address"] and data["name"] == body["asset"], "Debt object or coin mismatch")
        require(state["owner"]["address"]["address"] == parent, "Debt belongs to a different obligation table")
        records.append((uint(data["value"]["amount"]["value"]), uint(data["value"]["borrow_index"]["value"])))
    (before, prior_index), (after, index) = records
    require(uint(change["outputState"]["version"]) > uint(change["inputState"]["version"]), "Invalid version order")
    require(before > 0 and after > 0 and index >= prior_index > 0, "Requires a continuing debt and valid indices")
    require(after == uint(body["total_borrow"]["value"]) and index == uint(body["borrow_index"]["value"]),
            "Event differs from resulting debt")
    paid = uint(body["amount"]) * SCALE
    # Match the SDK's Decimal.mul then divDecimal; each fixed-point operation truncates.
    accrued_before_payment = (before * index // SCALE) * SCALE // prior_index
    require(accrued_before_payment - paid == after, "Indexed prior debt less payment differs from resulting debt")
    return {"status": "reconciled", "digest": digest, "checkpoint": checkpoint, "timeUtc": effects["timestamp"],
            "market": MARKET, "asset": USDC, "obligation": obligation, "eventSequence": event["sequenceNumber"],
            "debtField": change["address"], "debtTable": parent, "obligationVersion": position["version"],
            "debtInputVersion": change["inputState"]["version"], "debtOutputVersion": change["outputState"]["version"],
            "oldBorrowIndexRaw": str(prior_index), "newBorrowIndexRaw": str(index),
            "repaidUSDC": usdc(paid), "storedDebtBeforeUSDC": usdc(before), "storedDebtAfterUSDC": usdc(after),
            "storedDebtDecreaseUSDC": usdc(before - after), "indexAccrualUSDC": usdc(accrued_before_payment - before)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("digest")
    parser.add_argument("--replay", type=Path, help="read a saved evidence capture offline")
    args = parser.parse_args()
    try:
        alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
        require(32 <= len(args.digest) <= 44 and all(c in alphabet for c in args.digest), "Invalid Sui digest")
        decoded = 0
        for character in args.digest:
            decoded = decoded * 58 + alphabet.index(character)
        leading_zeroes = len(args.digest) - len(args.digest.lstrip("1"))
        require(leading_zeroes + (decoded.bit_length() + 7) // 8 == 32, "Invalid Sui digest length")
        evidence = json.loads(args.replay.read_text()) if args.replay else fetch(args.digest)
        print(json.dumps(reconcile(args.digest, evidence), indent=2))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"status": "unresolved", "digest": args.digest, "reason": str(error)}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
