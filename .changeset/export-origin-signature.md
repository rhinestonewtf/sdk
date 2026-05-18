---
'@rhinestone/sdk': patch
---

Re-export `OriginSignature` from the public entry. Consumers iterating intent signature arrays for the merkle / encoded-signature path can now `import type { OriginSignature } from '@rhinestone/sdk'` (or from `@rhinestone/sdk/orchestrator`) instead of inlining the union locally.
