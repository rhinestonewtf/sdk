---
'@rhinestone/sdk': major
---

Remove the top-level `appFee` leg from quote routes. The orchestrator now charges the whole-intent app fee in a single token, so the concrete leg lives in signed metadata rather than on the route response. `Quote.appFee` and the `AppFee` type are removed; the app fee is available as `quote.cost.fees.breakdown.app.usd`. Requesting an app fee via `options.appFees` (type `AppFeeRate`) is unchanged.
