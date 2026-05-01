---
'@rhinestone/sdk': major
---

- Replace `Session.actions` with `toSession({ permissions })`, an ABI-driven session definition shape (`{ abi, address, functions }`) that resolves to a low-level `Session`. Function selectors and param calldata offsets are derived from the ABI, and param value types are checked against ABI input types.
