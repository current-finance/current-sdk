---
name: current-repayment-receipt
description: Explain a confirmed Current MainMarket USDC partial repayment when someone asks how the payment changed their position’s stored debt.
---

A borrower or support engineer supplies the Sui mainnet transaction digest. Use the public history path for a fresh check, or replay the supplied sample entirely offline. Python 3.8+ and the standard library suffice. The public endpoint receives the digest and obligation ID. No wallet, position balance, owner capability, API key or SDK installation is required.

Run from this directory. Replace the digest with the one supplied for a live read.

```sh
python3 repayment_receipt.py HEvKiEg7bLhR8cqXR6XZgzPDyoAajX86168VT4xSTsDk
```

To reproduce the bundled observation offline:

```sh
python3 repayment_receipt.py HEvKiEg7bLhR8cqXR6XZgzPDyoAajX86168VT4xSTsDk --replay repayment-example.json
```

On `reconciled`, report (1) the payment, (2) the signed decrease in stored debt, (3) the debt that accrued as the protocol’s borrow index advanced since the debt record’s prior update. If the decrease is negative, say the stored debt increased. Cite the digest and checkpoint, plus the two debt versions if the reader wants to audit the calculation. Keep exact amounts in the receipt. Round only the accompanying explanation. A historical partial repayment demonstrates the debt movement at that point in time. A present balance requires a fresh position and market read.

On `unresolved` (exit 1), report the reason and transaction digest. Refunds, full closes, other assets or markets, missing archive history and transactions with multiple events or debt fields need separate examination. Never fill a missing amount from a current wallet balance. Offline results depend on the integrity of the supplied capture. Re-read the original digest publicly when independent verification matters.
