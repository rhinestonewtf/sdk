---
'@rhinestone/sdk': minor
---

Refuse two `claimPolicies` / `crossChainPermits` configurations that previously resolved but could not be enforced. Declaring `signing` with mode `scoped` or `disabled` alongside them throws — both rewrite the ERC-7739 content gate the claim policy is reached through, so the declared policy would never be consulted. A validity window (`{ mode: 'unrestricted', validAfter, validUntil }`) is kept instead: it lowers to a `TimeFramePolicy` that ANDs with the claim policies and leaves the gate alone. Declaring more than one Permit2 claim policy (including a `claimPolicies` entry plus a `crossChainPermits` one) also throws: they resolve to the same policy contract, and enabling stores one config per contract, so only the last would be installed while the signing path still built calldata for the rest. Split them across sessions.

Permit2 claim policies are now enforced from the ERC-1271 policy list — the list Permit2's `isValidSignature` consults — for every session. Previously only one-time-use sessions placed them there. They replace a windowless signing policy rather than joining it, since that list is an AND and a permissive entry alongside would be dead config advertising a capability the session no longer has.

A session carrying claim policies is now salted, so its permission id differs from a plain session for the same signer. Enabling adds to each on-chain policy list rather than replacing it, so without this the two would share a permission id and the plain session's signing policy would sit beside the claim policy.

Sessions enabled by an earlier version keep their existing configuration and are unaffected. Because the permission id changes, picking this up means enabling the new session rather than re-enabling the old one.
