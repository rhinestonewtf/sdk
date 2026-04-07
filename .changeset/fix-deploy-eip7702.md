---
"@rhinestone/sdk": patch
---

Fix `deploy()` for EIP-7702 accounts by passing `eip7702InitSignature` through to `sendTransaction`. Auto-signs via `signEip7702InitData` when no signature is provided.
