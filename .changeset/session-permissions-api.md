---
'@rhinestone/sdk': major
---

- Replace `Session.actions` with `Session.permissions`, an ABI-driven shape (`{ abi, address, functions }`). Function selectors and param calldata offsets are derived from the ABI, and param value types are checked against ABI input types.
