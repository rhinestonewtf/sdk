---
'@rhinestone/sdk': patch
---

Point `PERMIT2_CLAIM_POLICY_ADDRESS` at the Permit2 claim policy's multi-chain deployment, `0x4F9FAbC867E196Ebb27E7D7FaeD8AF41B2021B0e`. The previous address existed on Base, Arbitrum and Optimism only, so a session declaring `claimPolicies` on any other chain referenced a contract with no code. The new address is deployed through yeet and is identical on every supported chain.

Sessions already enabled against the old address keep working — the permission id does not depend on the policy address, and the old contract is still deployed on those three chains. Only newly enabled sessions use the new one.
