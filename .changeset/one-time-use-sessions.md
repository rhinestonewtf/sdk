---
'@rhinestone/sdk': minor
---

Add one-time-use session support (RHI-5798). `oneTimeUse: { id, validUntil? }` (requires `policyAddresses.oneTimeUseId`) makes a session settle at most once per chain:

- Every intent the session signs burns the id first; the SDK injects the burn and forces verify-execution mode.
- The OneTimeUseIdPolicy guards every action and authorises only the session's own burn; with `claimPolicies` it also sits on the ERC-1271 list next to the Permit2 claim policy.
- Its `claimPolicies` must each pin `spenders` (the Permit2 arbiter). Without `claimPolicies` the session has no signing surface, and a `signing` mode throws.
- `validUntil` must be a future `Date`. The session is always salted as in `saltMode: 'strict'`; `saltMode: 'v1'` throws.
- Exports `buildOneTimeUseBurnOp`, `oneTimeUseIdErc1271Policy`, `encodeOneTimeUseIdInitData` and the related types from `@rhinestone/sdk/smart-sessions`.
