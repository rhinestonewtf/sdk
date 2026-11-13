---
"@rhinestone/sdk": minor
---

**Upcoming 1.23.0 is an intentionally breaking minor on the legacy v1 line, published under `v1-latest`, not `latest`.** Existing caret ranges may adopt it automatically. Install `@rhinestone/sdk@v1-latest` deliberately, or pin 1.23.0 after publication; unqualified installation selects another SDK generation.

Preparing, signing and submitting transactions now use the orchestrator's `2026-04.blanc` API: quotes are stored by `POST /quotes`, and `POST /intents` submits by intent ID. The low-level `Orchestrator.getIntentRoute` and `Orchestrator.submitIntent` remain Alps compatibility methods with unchanged behavior. The actual low-level entry point is `@rhinestone/sdk/dist/src/orchestrator`, not `@rhinestone/sdk/orchestrator`.

**Breaking returned types:** `PreparedTransactionData` and `SignedTransactionData` replace `intentRoute` with `quote` (the new `Quote` type: `intentId`, `expiresAt`, `estimatedFillTime`, `settlementLayer`, `signData`, `cost`, `tokenRequirements`). High-level prepared/signed results no longer expose the Alps bundle or cost shape; retained low-level Alps types remain exported. Use `quote.cost` for amounts and fees, `quote.signData` or `getTransactionMessages` for the payloads to sign, and `quote.tokenRequirements` for approvals, wraps and permits. Token requirements are returned for EOA accounts only, with bigint amounts. High-level method inputs are unchanged, but this is not total source compatibility. UserOperation APIs are unchanged. Re-prepare and re-sign persisted pre-migration objects; do not convert Alps bundles to quotes or replay old authorization, and respect `quote.expiresAt`.

`quote.cost.input` and `output` report bigint token amounts. `fees.total.usd` and each category's `usd` represent full costs regardless of payer; each category separately reports `sponsored`. This is not a one-to-one mapping to Alps costs. Upgrade JWT clients and signing backends together with explicit `apiVersion: 'blanc'` on the backend (see the JWT approval note and README).

- `lockFunds` and `feeAsset` remain accepted but are not sent as intent options and have no effect on Blanc fees/locking; the orchestrator never applied them. Standalone Compact actions and generic allowance helpers remain supported.
- Session signers no longer produce a target-execution signature on IntentExecutor routes, where the orchestrator neither serves nor reads one.
- CCTP transfers into the sender's own account are delivered by Rhinestone's relayer. Signature count depends on the server-provided route/payload, with shared origin/destination signatures reused; there is no client opt-out of the served shape. Cross-chain destination calls can now route over bridges other than Across.
- An unsupported token in a quote is reported with the chain in CAIP-2 form, and an unsupported destination chain no longer reports a field path.
- Adds the `Quote` and `QuoteCost` types and `Orchestrator.createQuote` / `Orchestrator.createIntent`.
