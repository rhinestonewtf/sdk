---
'@rhinestone/sdk': patch
---

Re-export `OriginSignature` from the package root and `@rhinestone/sdk/orchestrator`, so consumers iterating intent signature arrays don't need to inline the union locally.
