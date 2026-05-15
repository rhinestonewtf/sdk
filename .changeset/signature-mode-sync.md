---
'@rhinestone/sdk': patch
---

Sync intent `signatureMode` with the bytes shape the SDK actually signs: EOAs, non-session smart accounts, and claim-only sessions now emit `SIG_MODE_ERC1271` (1), while sessions with `verifyExecutions=true` continue to emit the dual-sig `SIG_MODE_EMISSARY_EXECUTION_ERC1271` (5). Previously the SDK always picked a hybrid mode, wasting an on-chain call attempt on the wrong validator path.
