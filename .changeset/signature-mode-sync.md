---
'@rhinestone/sdk': patch
---

Sync intent `signatureMode` with the bytes shape the SDK actually signs: EOAs and non-session smart accounts now emit `SIG_MODE_ERC1271` (1), claim-only sessions emit `SIG_MODE_EMISSARY` (0), and sessions with `verifyExecutions=true` continue to emit the dual-sig `SIG_MODE_EMISSARY_EXECUTION_ERC1271` (5). Previously the SDK always picked a hybrid mode, wasting an on-chain call attempt on the wrong validator path.
