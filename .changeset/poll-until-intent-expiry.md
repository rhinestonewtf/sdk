---
'@rhinestone/sdk': major
---

- `account.waitForExecution` now polls until the intent's quote `expiresAt`, replacing the previous hardcoded 3.5-minute cap. The orchestrator's `EXPIRED` status is treated as terminal.
- Renamed `IntentStatusTimeoutError` to `IntentExpiredError`. Update any `catch` / `instanceof` checks accordingly.
