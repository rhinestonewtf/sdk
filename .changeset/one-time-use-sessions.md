---
'@rhinestone/sdk': minor
---

Add one-time-use session support. A session may pin an id via `oneTimeUse: { id, validUntil? }` (requires `policyAddresses.oneTimeUseId`; `validUntil` is a `Date`, omit for never) so it settles at most once per chain across both settlement routes: the OneTimeUseIdPolicy is installed on every action (executor route) and co-located with the Permit2 claim policy on the ERC-1271 list (permit2 route). Exposes `buildOneTimeUseBurnOp`, `oneTimeUseIdErc1271Policy`, `encodeOneTimeUseIdInitData`, and the `OneTimeUseSettlementRoute` / `OneTimeUseBurnOp` types from `@rhinestone/sdk/smart-sessions`. A one-time-use session is always salted as in `saltMode: 'strict'`, so it never shares a permissionId with another session; combining it with `saltMode: 'v1'`, or a `signing` validity window alongside claim policies, throws. Without claim policies (executor route only) it keeps the ERC-1271 signing list it asked for.
