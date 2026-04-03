---
"@rhinestone/sdk": patch
---

Fix `deploy()` for EIP-7702 accounts by threading `eip7702InitSignature` through `deployWithIntent` to `sendTransaction`. When no signature is provided, auto-signs via `signEip7702InitData` for 7702 accounts.
