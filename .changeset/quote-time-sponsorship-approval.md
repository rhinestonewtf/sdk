---
'@rhinestone/sdk': minor
---

In JWT auth mode, request intent-scoped sponsorship approval when a sponsored transaction is quoted, not when it is submitted. This covers EVM transactions, Solana-origin transfers, instructions and deliveries, and `deploy('solana', …)`.

- `getIntentExtensionToken` runs once per sponsored `prepareTransaction` (or Swig creation), before the quote. It runs even for quotes that are never submitted. `submitTransaction` never calls it, including for restored prepared transactions.
- A denied or failing `getIntentExtensionToken` now rejects `prepareTransaction` with nothing quoted, instead of failing at submission.
- Add `UnsupportedSponsorshipApprovalError` (exported from `@rhinestone/sdk/errors`). It is thrown before `getIntentExtensionToken` runs when the approval input cannot describe the quote request exactly, for example a `sourceAssets` list naming one token both with and without an `amount`. Use project-wide sponsorship for such a request.
- The EVM `intentInput` is unchanged from 2.16.x, so existing sponsorship policies keep working.
- The Solana `intentInput` now names the paying Swig as `account.svm`: its wallet, its authority and, for plain operations, its state account. A same-chain transfer pins its mint in `accountAccessList`. SVM-only inputs no longer carry `options.signatureMode`. A Swig creation's input also includes the installed root and the Swig id. Solana transactions prepared by an earlier snapshot must be prepared again.
- A Swig creation now requests `sponsorship: { gas: true, bridgeFees: false, swapFees: false }` so the request matches its approval input.
