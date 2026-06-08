# CLAUDE.md

Guidance for working in this repository with Claude Code.

## What this is

Sample TypeScript SDK for interacting with the **Current** lending/borrowing/leverage
protocol on **Sui**. pnpm workspace with two packages:

- `sdk/` — `@current-finance/current-sdk`, the SDK source. Published from `sdk/dist/`.
- `examples/` — runnable `tsx` scripts that consume the **built** SDK (`@current-finance/current-sdk` resolves to `dist/`, not source).

## Commands

Run from the repo root unless noted.

```bash
pnpm install            # install workspace deps

cd sdk
pnpm build              # tsc -> dist/  (REQUIRED before running examples)
pnpm test               # jest; runs fully offline (RPC is stubbed)
pnpm lint               # eslint
pnpm lint:fix           # eslint --fix

cd examples
pnpm tsx lending/market-detail.ts   # read-only example, no key needed
```

## Conventions

- TypeScript, ES modules (`"type": "module"`). Node `>=20.19.0`.
- ESLint enforces: 2-space indent, single quotes, semicolons, trailing commas
  (multiline), spaces inside `{ }`. Run `pnpm lint:fix` before committing.
- `transaction.populate*` methods append Move calls to a caller-owned `Transaction`;
  they don't sign or execute. Keep that pattern — signing stays with the caller.
- Money/amounts use the `Decimal` type and `bigint` (minimal units), not `number`.
  Don't introduce floating-point math into value calculations.
- The public API surface is the curated barrel in `sdk/src/index.ts`. Add new
  public exports there deliberately; avoid blanket re-exports of internals.

## Gotchas — don't "fix" these

- **Examples need a build first.** They import the SDK's `dist/`, so `pnpm build`
  in `sdk/` must run before `pnpm tsx ...` in `examples/`, or you'll get
  `ERR_MODULE_NOT_FOUND`.
- **"Pebble" is the project's old name** (it was renamed to **Current**). Most
  references have been scrubbed, but `TokenExchange.Pebble` remains in
  `sdk/src/dex/index.ts` because it's a wire value: `parseDexRawString` matches
  the string `'pebble'` (and numeric `6`) returned by the quote backend.
  Renaming the string would break quote parsing — leave it unless the backend's
  response format changes.
- **`any` warnings are accepted.** ~45 `@typescript-eslint/no-explicit-any`
  warnings exist at known SDK boundaries (cross-SDK casts, error parsing,
  RPC response shapes). Lint passes with **0 errors**; don't churn the codebase
  just to silence these warnings.
- **Hex `0x...` literals in source are public on-chain object/pool IDs**, not
  secrets. Private keys come only from `examples/.env` (gitignored) via `PRIVATE_KEY`.

## Before opening a PR

- `pnpm build`, `pnpm test`, and `pnpm lint` (0 errors) all pass from `sdk/`.
- Update snapshots only when an output change is intended (`pnpm test -- -u`).
