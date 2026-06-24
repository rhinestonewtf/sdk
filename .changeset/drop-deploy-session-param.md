---
'@rhinestone/sdk': major
---

Drop the `session` param from `account.deploy(chain, params)`. It was a no-op — sessions cannot be enabled at deployment time. Enable a session after deployment with `experimental_signEnableSession` and the smart-sessions actions.
