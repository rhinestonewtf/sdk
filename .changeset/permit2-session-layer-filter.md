---
'@rhinestone/sdk': minor
---

Intents signed with a Permit2 cross-chain permit session no longer offer the orchestrator a Permit2 arbiter the session cannot sign. A session whose permit names Permit2 layers but not `ACROSS` sends `settlementLayers: { exclude: ['ACROSS'] }`, so you no longer need to set that filter yourself:

- Only the Permit2 arbiters the permit does not name are excluded. The session keeps the intent-execution fallback, so routes settled by the IntentExecutor (for example `RELAY` or `CCTP`) stay open, and same-chain intents are not affected.
- An intent's own `settlementLayers` can only narrow this. An `include` loses the excluded arbiters, and a filter that leaves no layer throws before the intent is quoted.
- A permit that names no layers, or names `ACROSS`, admits every Permit2 arbiter and leaves intents unrestricted.
- `Session.settlementLayers` now also lists a Permit2 permit's layers, so its type widens from the IntentExecutor layers to every cross-chain settlement layer. It is metadata only: the session's encoding and permission id do not change, and sessions created on an earlier version keep working without the filter.
