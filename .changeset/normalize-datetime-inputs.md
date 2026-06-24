---
'@rhinestone/sdk': major
---

Normalize public datetime inputs to accept `Date`.

- `PermissionFunctionConfig.validUntil` / `validAfter` now accept `Date` only (dropped the raw millisecond-epoch `number`).
- `CrossChainPermissionInput.fillDeadline` bounds (`min` / `max`) now accept `Date` (dropped the unix-seconds `bigint`).
- Reshape `ENSValidatorConfig`: replace the parallel `accounts` + `ownerExpirations` arrays with a single `owners: { account: Account; expiration?: Date }[]`. Omit `expiration` for an owner that never expires (previously the `maxUint48` sentinel).
- `CrossChainPermit` is no longer marked `@internal` — the resolved permit shape (unix-seconds `bigint`) is now a documented low-level escape hatch.
