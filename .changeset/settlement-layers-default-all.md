---
'@rhinestone/sdk': minor
---

A `crossChainPermits` entry that omits `settlementLayers` (or passes `[]`) now means `settlementLayers: 'all'` instead of `ACROSS`.

- It resolves against the orchestrator's `GET /chains` and the clock at creation, as `'all'` does, so build such sessions with `sdk.createSession` and store the result.
- Offline `toSession`: pass `options.settlement` (the catalog from `GET /chains`; `toSession` now also accepts `wrappedNativeToken`, as `validateSession` does) or name the layers. Without either it throws `SETTLEMENT_CATALOG_MISSING`, for omitted layers and explicit `'all'` alike.
- It is refused wherever `'all'` is refused (for example `NO_LAYER_CAN_SETTLE`), never settled through `ACROSS` instead, and reports dropped layers in `settlementCoverage.dropped`.
- To keep the previous behaviour, pass `settlementLayers: ['ACROSS']`. A reusable session with `preClaimOps: 'none'` needs it, since `'all'` refuses that option with `PRE_CLAIM_OPS_NOT_APPLICABLE`. Otherwise the session's actions, permissionId and enable digest change.
- A session with `fallback` keeps `ACROSS` for an omitted or empty list, since `'all'` cannot be combined with `fallback`.
