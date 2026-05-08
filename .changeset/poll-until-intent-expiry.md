---
'@rhinestone/sdk': major
---

- `account.waitForExecution` now polls until the intent's quote `expiresAt`, replacing the previous hardcoded 3.5-minute cap. Long-fill intents are no longer cut off prematurely, and the orchestrator's `EXPIRED` status is now treated as terminal.
- The `IntentStatusTimeoutError` class has been renamed to `IntentExpiredError`. Update any `catch` / `instanceof` checks accordingly.
