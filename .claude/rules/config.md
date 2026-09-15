---
paths:
  - "src/config/**"
  - "src/api/accounts.ts"
  - "src/api/sdk.ts"
---

# SDK config

- Add a new SDK construction field to `legacy.ts` (the snapshot, the account config and both builders) and read it in
  `materializeSdkInvocationConfig` (`resolve.ts`). Otherwise `account.config` types it but leaves it undefined at runtime.
- `legacy.test.ts` cannot catch that omission: it compares `account.config`'s keys with the compatibility object's, and both
  come from the same field list.
