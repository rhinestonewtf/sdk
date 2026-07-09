---
'@rhinestone/sdk': minor
---

Add `getAppFeeBalances` to `RhinestoneSDK`. Returns the integrator's accrued app-fee balance as USD totals (`withdrawableUsd`, `pendingUsd`), read from `GET /app-fees/balances`. The balance is project-scoped (keyed to the API key), not tied to any account. Fees are valued in USD at the moment they are collected, so the balance is unaffected by later price movements of the collected tokens.
