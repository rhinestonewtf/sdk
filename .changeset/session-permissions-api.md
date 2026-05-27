---
'@rhinestone/sdk': major
---

Replace `Session.actions` with `toSession({ permissions, claimPolicies })`, an ABI-driven session definition shape (`{ abi, address, functions }`) that resolves to a low-level `Session`. Function selectors and calldata offsets are derived from the ABI, parameter value types are checked against ABI input types, and Permit2 claim policies use chain-aware fields that resolve to the internal onchain schema.
