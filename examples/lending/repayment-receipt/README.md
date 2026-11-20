# Explain a confirmed Current repayment

A Current position repaid 9 USDC and its stored debt fell by about 4.885 USDC.
The other 4.115 USDC covered interest that accrued since the last debt update.
This example reconstructs the exact amounts from the repayment event and
the debt object's versions immediately before and after the transaction.
[Sample Sui transaction](https://suiscan.xyz/mainnet/tx/HEvKiEg7bLhR8cqXR6XZgzPDyoAajX86168VT4xSTsDk)

## Replay the sample

From the SDK repository root, run the following with Python 3.8 or newer.

```sh
cd examples/lending/repayment-receipt
python3 repayment_receipt.py HEvKiEg7bLhR8cqXR6XZgzPDyoAajX86168VT4xSTsDk --replay repayment-example.json
```

At checkpoint `346828417`, the JSON reports `status: reconciled` and these amounts.

| Output field | USDC |
| --- | ---: |
| `repaidUSDC` | 9 |
| `storedDebtDecreaseUSDC` | 4.884983970901074958400817 |
| `indexAccrualUSDC` | 4.115016029098925041599183 |

The borrow index tracks cumulative interest. Applying the ratio of the new
index to the old index yields the debt just before payment. The example uses
the same fixed-point multiply and divide as the
[SDK debt calculation](../../../sdk/src/core/client.ts) and checks that
subtracting the paid amount produces the resulting stored debt exactly.
The receipt includes both indices, both debt object versions, and the
checkpoint for audit.

The fixture retains the event, all changed object types, the matched debt
versions, and the obligation's debt-table ID. Live lookup provides a fresh
check of the public records.

## Use a confirmed transaction digest

Run the following from this directory with the digest (transaction ID) copied
from your repayment.

```sh
python3 repayment_receipt.py YOUR_TRANSACTION_DIGEST
```

The command reads public Sui mainnet GraphQL history. It sends the digest and
the obligation ID derived from the transaction to the public endpoint. Python's
standard library handles the lookup. The example requires no wallet or SDK
installation. See [SKILL.md](SKILL.md) for agent instructions.

The supported shape is a MainMarket USDC partial repayment with a single
event, one continuing debt object and zero refund. A full payoff, a refund,
multiple events or missing history returns `unresolved` with a reason and
exit code 1. If history is temporarily unavailable, retry the same digest.
If the stored debt decrease is negative, the recorded debt increased. Use the
[SDK obligation query](../../../sdk/src/core/query.ts) and debt calculation
for a present balance.

Run the offline checks from this directory with
`python3 -m unittest -v`.
