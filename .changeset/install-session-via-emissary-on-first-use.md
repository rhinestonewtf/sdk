---
'@rhinestone/sdk': patch
---

Fix claim-only sessions failing on first use after the `verifyExecutions` derivation change. `resolveSignersForChain` now forces `verifyExecutions=true` whenever the session is not yet enabled on-chain, regardless of `hasExplicitPermissions`. This routes the first intent through the emissary's `verifyExecution` path (mode 5, ENABLE-mode signature, dummy preClaimOp) so the session gets installed via `setConfig`. Subsequent intents on an already-enabled claim-only session drop back to mode 1.
