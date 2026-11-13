---
"@rhinestone/sdk": patch
---

Deprecate retained Alps-only route/bundle/cost types, low-level quote/submit methods and bundle-based signing helpers without removing exports or changing their runtime behavior. Mark ineffective `feeAsset` / `lockFunds` intent options deprecated; standalone Compact actions and generic allowance helpers remain current.

Synchronize the repository and npm READMEs with the v1 Blanc migration guide, actual package subpaths, quote costs/signatures, persisted-object migration and coordinated JWT backend opt-in. This cleanup adds guidance and deprecation metadata only; the pending minor changesets select the upcoming breaking legacy-v1 1.23.0 release under `v1-latest`. Version generation and publication remain separate release steps.
