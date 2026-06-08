# Current SDK

Sample TypeScript SDK for interacting with the [Current](https://current.finance) protocol on [Sui](https://sui.io) — a lending, borrowing, and leverage protocol.

This repo is a pnpm workspace with two packages:

- `sdk/` — `@current-finance/current-sdk`, the SDK.
- `examples/` — runnable scripts demonstrating common flows.

**Requirements:** Node.js `>=20.19.0` and [pnpm](https://pnpm.io).

## Build & install

```bash
pnpm install        # install workspace dependencies (from repo root)

cd sdk
pnpm build          # compile TypeScript to dist/
pnpm test           # run the test suite (offline, no RPC needed)
```

## Run examples

The [`examples/`](./examples) directory contains end-to-end scripts for lending
(enter market, deposit, borrow, repay, withdraw, market & obligation detail, …)
and referrals (generate/look up codes, check status, claim rebates).

```bash
pnpm install                       # from the repo root, if not done already
cd examples
cp .env.example .env               # then set PRIVATE_KEY (see below)

pnpm tsx lending/market-detail.ts  # read-only, no key required
pnpm tsx lending/enter-and-deposit.ts
```

Scripts that send transactions read a `PRIVATE_KEY` from `examples/.env`. Both the
Sui `suiprivkey1...` format and a raw hex key (with or without `0x`) are supported.

> ⚠️ Use a dedicated test wallet. Never commit a key or use one that holds significant funds.

Some flows are stateful: run `enter-and-deposit.ts` first, then copy the resulting
`ObligationOwnerCap` ID into the `OBLIGATION_OWNER_CAP_ID` constant at the top of
`deposit.ts`, `borrow.ts`, `repay.ts`, and `withdraw.ts`.

## Contributing

This SDK is provided as a sample. If you spot a bug, an inaccuracy, or something
that could be clearer, feel free to open a pull request — contributions are welcome.

## License

[MIT](./LICENSE)
