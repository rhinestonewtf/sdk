---
"@rhinestone/sdk": minor
---

Preparing, signing and submitting transactions now quote and submit on the orchestrator's `2026-04.blanc` API version, so the SDK's own transaction flows and reads all go through blanc. The low-level `Orchestrator.getIntentRoute` and `Orchestrator.submitIntent` are unchanged and still use `2026-01.alps`.

Breaking (types): `PreparedTransactionData` and `SignedTransactionData` replace `intentRoute` with `quote` (the new `Quote` type: `intentId`, `expiresAt`, `estimatedFillTime`, `settlementLayer`, `signData`, `cost`, `tokenRequirements`). The orchestrator's bundle and alps cost are no longer exposed. Use `quote.cost` for amounts and fees, `quote.signData` or `getTransactionMessages` for the payloads to sign, and `quote.tokenRequirements` for approvals, wraps and permits. Token requirements are returned for EOA accounts only, with bigint amounts. Method signatures are unchanged.

- `lockFunds` and `feeAsset` are no longer sent; the orchestrator never applied them.
- Session signers no longer produce a target-execution signature on IntentExecutor routes, where the orchestrator neither serves nor reads one.
- CCTP transfers into the sender's own account are delivered by Rhinestone's relayer, and may ask for one more signature on the destination chain. Cross-chain destination calls can now route over bridges other than Across.
- An unsupported token in a quote is reported with the chain in CAIP-2 form, and an unsupported destination chain no longer reports a field path.
- Adds the `Quote` and `QuoteCost` types and `Orchestrator.createQuote` / `Orchestrator.createIntent`.
