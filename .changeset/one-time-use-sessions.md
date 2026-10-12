---
'@rhinestone/sdk': minor
---

Add one-time-use session support (RHI-5798). `oneTimeUse: { id, validUntil? }` makes a session settle at most once per chain:

- Every intent the SDK prepares for the session burns the id first on each chain it settles on (the policy refuses any settlement that does not), in verify-execution mode. The burn is the op that enables the session, so the session installs no dummy pre-claim action. Such intents must list `sourceChains` and cannot run destination calls on a chain that is also one of several sources.
- The OneTimeUseIdPolicy guards every action and authorises only the session's own burn; with `claimPolicies` it also sits on the ERC-1271 list next to the Permit2 claim policy.
- Its `claimPolicies` must each pin `spenders` (the Permit2 arbiter). Without `claimPolicies` the session has no signing surface, and a `signing` mode throws.
- `validUntil` must be a future `Date`. The session is always salted as in `saltMode: 'strict'`; `saltMode: 'v1'` throws.
- A `crossChainPermits` entry's `validUntil` / `validAfter` is a time-frame policy on the permit's actions and does not change the one-time-use deadline.
- Exports `buildOneTimeUseBurnOp`, `oneTimeUseIdErc1271Policy`, `encodeOneTimeUseIdInitData` and the related types from `@rhinestone/sdk/smart-sessions`.
