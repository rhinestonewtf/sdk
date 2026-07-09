---
'@rhinestone/sdk': minor
---

Add `getAppFeeBalances` to the account and orchestrator client. Returns the integrator's accrued app-fee balance as USD totals (`withdrawableUsd`, `pendingUsd`), read from `GET /app-fees/balances`. Fees are valued in USD at the moment they are collected, so the balance is unaffected by later price movements of the collected tokens.
