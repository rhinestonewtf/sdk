---
'@rhinestone/sdk': patch
---

In JWT auth mode, send the intent extension token with the quote instead of the submission, so a sponsored quote is admitted and priced under the integrator's sponsorship grant.

- `getIntentExtensionToken` now runs on every sponsored `prepareTransaction`, including quotes that are never submitted, adding one round trip to your backend before each sponsored quote.
- A sponsorship denial (`SponsorshipDeniedError`) or a failing `getIntentExtensionToken` now surfaces from `prepareTransaction` rather than `submitTransaction`.
- A sponsored mainnet quote is now checked against the project's sponsor record, caps and balance, which quotes previously skipped.
