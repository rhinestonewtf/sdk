---
'@rhinestone/sdk': minor
---

Add the ability to restrict a smart session to specific swap aggregators. `SessionDefinition` gains `restrictToActions` (drops the wildcard intent-execution fallback so the session's explicit permissions/actions are the only ops it can run) and `actions` (raw scoped actions for calls the ABI-name `permissions` sugar can't address). New `aggregator-swap-actions` helpers — `swapSessionActions`, `zeroExAggregator`, `fyndAggregator`, `zeroExSwapActions` — build the scoped approve + per-aggregator swap actions.
