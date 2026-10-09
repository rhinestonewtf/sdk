---
'@rhinestone/sdk': minor
---

Intents signed with a Permit2 cross-chain permit session no longer offer the orchestrator a Permit2 arbiter the session cannot sign:

- A scoped Permit2 session (no `fallback`) limits intents to `settlementLayers: { include: ['ACROSS'] }`.
- A session with `fallback` excludes only the Permit2 arbiters its permit does not name: a permit without `ACROSS` sends `settlementLayers: { exclude: ['ACROSS'] }`, so routes settled by the IntentExecutor (for example `RELAY` or `CCTP`) stay open, and same-chain intents are not affected. A permit that names no layers, or names `ACROSS`, leaves those intents unrestricted.
- An intent's own `settlementLayers` can only narrow this. A filter that leaves no layer throws before the intent is quoted.
- `Session.settlementLayers` now also lists a Permit2 permit's layers, so its type widens from the IntentExecutor layers to every cross-chain settlement layer. It is metadata only.
