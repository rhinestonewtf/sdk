---
'@rhinestone/sdk': minor
---

Add `settlementCoverage` to a `Session` created with a settlement-scoped cross-chain permit. It lists the layers the session covers and, for `settlementLayers: 'all'`, each layer left out with the reason it cannot settle the permit on that chain. The field is metadata only: the session's encoding and permission id are unchanged, and stored sessions without it still work.
