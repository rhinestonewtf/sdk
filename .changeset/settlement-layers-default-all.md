---
'@rhinestone/sdk': minor
---

A `crossChainPermits` entry that omits `settlementLayers` (or passes `[]`) now means `settlementLayers: 'all'` instead of `ACROSS`.

- It resolves against the orchestrator's `GET /chains` and the clock at creation, as `'all'` does, so build such sessions with `sdk.createSession` and store the result. `toSession` without the settlement addresses throws `SETTLEMENT_CATALOG_MISSING`.
- It is refused wherever `'all'` is refused (for example `NO_LAYER_CAN_SETTLE`), never settled through `ACROSS` instead, and reports dropped layers in `settlementCoverage.dropped`.
- To keep the previous behaviour, pass `settlementLayers: ['ACROSS']`. Otherwise the session's actions, permissionId and enable digest change.
- A session with `fallback` keeps `ACROSS` for an omitted or empty list, since `'all'` cannot be combined with `fallback`.
