---
'@rhinestone/sdk': minor
---

In JWT auth mode, request intent-scoped sponsorship approval when a sponsored transaction is quoted, not when it is submitted. This covers EVM transactions, Solana-origin transfers, instructions and deliveries, and `deploy('solana', …)`.

- `getIntentExtensionToken` runs once per sponsored `prepareTransaction` (or Swig creation), before the quote. It runs even for quotes that are never submitted. `submitTransaction` never calls it, including for restored prepared transactions.
- A denied or failing `getIntentExtensionToken` now rejects `prepareTransaction` with nothing quoted, instead of failing at submission.
- Add `UnsupportedSponsorshipApprovalError` (exported from `@rhinestone/sdk/errors`). It is thrown before `getIntentExtensionToken` runs when the quote request falls outside the approval contract. Use project-wide sponsorship for such a request.
- The `intentInput` a grant commits to is the versioned `sdk-caucasus-singular-2026-09-v1` input (see the singular source and destination entry). A Solana input names the paying Swig as `account.svm`: its wallet, its authority and, for plain operations, its state account; a Swig creation's input also includes the installed root and the Swig id.
- A Swig creation now requests `sponsorship: { gas: true, bridgeFees: false, swapFees: false }` so the request matches its approval input.
