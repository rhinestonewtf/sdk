---
'@rhinestone/sdk': minor
---

**Breaking:** declaring `claimPolicies` or `crossChainPermits` alongside an explicit `signing` configuration now throws. The claim policies take over the session's ERC-1271 policy list, so a signing mode or validity window declared beside them would be dropped rather than honoured. Drop one or the other.

Permit2 claim policies are now enforced from the ERC-1271 policy list — the list Permit2's `isValidSignature` consults — for every session. Previously only one-time-use sessions placed them there. They replace the session's signing policy rather than joining it, since that list is an AND and a permissive entry alongside would be dead config advertising a capability the session no longer has.

A session carrying claim policies is now salted, so its permission id differs from a plain session for the same signer. Enabling adds to each on-chain policy list rather than replacing it, so without this the two would share a permission id and the plain session's signing policy would sit beside the claim policy.

Sessions enabled by an earlier version keep their existing configuration and are unaffected. Because the permission id changes, picking this up means enabling the new session rather than re-enabling the old one.

Known limitation: a session declaring several permits emits one policy entry per permit at the same policy address, and the on-chain config is keyed per policy, so only the last is installed. Declare one permit per session until this is resolved.
