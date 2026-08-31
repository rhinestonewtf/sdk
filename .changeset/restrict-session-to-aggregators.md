---
'@rhinestone/sdk': minor
---

Add the ability to restrict a smart session to specific swap aggregators. `SessionDefinition` gains `restrictToActions` (drops the wildcard intent-execution fallback so the session's explicit permissions/actions are the only ops it can run) and `actions` (raw scoped actions for calls the ABI-name `permissions` sugar can't address). New `aggregator-swap-actions` helpers — `swapSessionActions`, `zeroExAggregator`, `fyndAggregator` — build the scoped approve + per-aggregator swap actions. A restricted session also defaults its ERC-1271 signing surface to disabled, so a session key limited to swap/approve cannot sign approvals off-chain.
