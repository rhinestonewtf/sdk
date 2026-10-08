---
'@rhinestone/sdk': minor
---

Add one-time-use session support (RHI-5798). `oneTimeUse: { id, validUntil? }` makes a session settle at most once per chain:

- Every intent the SDK prepares for the session burns the id first on each chain it settles on (the policy refuses any settlement that does not), in verify-execution mode. The burn is the op that enables the session, so the session installs no dummy pre-claim action. Such intents must list `sourceChains` and cannot run destination calls on a chain that is also one of several sources.
- The OneTimeUseIdPolicy guards every action and authorises only the session's own burn; with `claimPolicies` it also sits on the ERC-1271 list next to the Permit2 claim policy.
- Its `claimPolicies` must each pin `spenders` (the Permit2 arbiter). Without `claimPolicies` the session has no signing surface, and a `signing` mode throws.
- `validUntil` must be a future `Date`. The session is always salted as in `saltMode: 'strict'`; `saltMode: 'v1'` throws.
- On an IntentExecutor-layer `crossChainPermits` entry, `validUntil` requires `oneTimeUse` and `validAfter` is unsupported; both throw. The one-time-use deadline already bounds every action, so a separate time-frame policy would be redundant and cost enable gas. With `oneTimeUse`, the permit's `validUntil` (a future `Date`) becomes the one-time-use deadline, the earlier of it and `oneTimeUse.validUntil`, and bounds every action in the session. Such sessions get a different permissionId and enable digest than earlier unreleased builds gave them.
- `policyAddresses.oneTimeUseId` defaults to the deployed OneTimeUseIdPolicy: `0x630CEbCf54C7471154CF659088CC4197872Cf5FD` on production contracts and `0x86F7cB4E25626d6a07cfED305c38816F30d07224` with `useDevContracts`. A session using the default resolves to the same session data, permission id and burn call as one passing that address. Resolving a session on a chain without the deployment throws an error naming the chain, and so does preparing an intent that uses a session with a default address on such a chain. An explicit address always wins. Both addresses are exported from `@rhinestone/sdk/smart-sessions` as `ONE_TIME_USE_ID_POLICY_ADDRESS` and `ONE_TIME_USE_ID_POLICY_ADDRESS_DEV`.
- Exports `buildOneTimeUseBurnOp`, `oneTimeUseIdErc1271Policy`, `encodeOneTimeUseIdInitData` and the related types from `@rhinestone/sdk/smart-sessions`.
