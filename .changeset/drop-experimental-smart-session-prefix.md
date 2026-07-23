---
'@rhinestone/sdk': major
---

Drop the `experimental_` prefix from the smart-session API now that it's stable. Rename across your integration:

- Config: `experimental_sessions` → `sessions`
- Signer set: `type: 'experimental_session'` → `type: 'session'`
- Account methods: `experimental_getSessionDetails` → `getSessionDetails`, `experimental_isSessionEnabled` → `isSessionEnabled`, `experimental_signEnableSession` → `signEnableSession`
- `@rhinestone/sdk/actions/smart-sessions` actions: `experimental_enable` → `enable`, `experimental_disable` → `disable`, `experimental_enableSession` → `enableSession`, `experimental_disableSession` → `disableSession`
