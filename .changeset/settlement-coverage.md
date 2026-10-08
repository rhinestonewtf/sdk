---
'@rhinestone/sdk': minor
---

Add `settlementCoverage` to a `Session` created with a settlement-scoped cross-chain permit, and export its `SettlementCoverage` and `DroppedSettlementLayer` types. With `settlementLayers: 'all'`, `settlementCoverage.dropped` lists each layer left out with the reason it cannot settle the permit on the session's chain; the kept layers stay in `settlementLayers`. The field is metadata only: the session's encoding and permission id are unchanged, and stored sessions without it still work.
