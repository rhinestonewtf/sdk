---
'@rhinestone/sdk': minor
---

Add one-time-use session support. A session may pin an id via `oneTimeUse: { id }` (requires `policyAddresses.oneTimeUseId`) so it settles at most once per chain across both settlement routes: the OneTimeUseIdPolicy is installed on every action (executor route) and co-located with the Permit2 claim policy on the ERC-1271 list (permit2 route). Exposes `buildOneTimeUseBurnOp`, `oneTimeUseIdErc1271Policy`, `encodeOneTimeUseIdInitData`, and the `OneTimeUseSettlementRoute` / `OneTimeUseBurnOp` types from `@rhinestone/sdk/smart-sessions`.
