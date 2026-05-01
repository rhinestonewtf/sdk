---
'@rhinestone/sdk': major
---

- Drop the `acceptsPreconfirmations` parameter from `account.waitForExecution`. The method now always waits for `FILLED` / `COMPLETED` and never treats `PRECONFIRMED` as terminal.
