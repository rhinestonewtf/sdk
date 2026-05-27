---
'@rhinestone/sdk': patch
---

Set the intent's declared `signatureMode` to match the bytes the SDK actually signs. EOAs, non-session smart accounts, and claim-only sessions now declare `ERC1271`; sessions with `verifyExecutions=true` declare `EMISSARY_EXECUTION_ERC1271`. Avoids a wasted on-chain validator call per bundle.
