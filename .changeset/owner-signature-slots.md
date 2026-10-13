---
'@rhinestone/sdk': minor
---

Fix the `OwnerSignature` and `OwnerSignatureData` declarations to describe `slots`, the ordered per-request signatures that `signTransaction(prepared, { owner })` returns and `assembleTransaction` accepts, instead of the obsolete `origin`.
