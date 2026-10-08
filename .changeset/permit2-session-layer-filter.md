---
'@rhinestone/sdk': minor
---

Intents signed with a Permit2 cross-chain permit session are now restricted to the layers the permit names, as settlement-scoped sessions already were. A session whose permit lists `settlementLayers: ['ACROSS']` sends `settlementLayers: { include: ['ACROSS'] }`, so you no longer need to set the filter yourself, and the orchestrator cannot plan a layer the session cannot sign:

- An intent's own `settlementLayers` can only narrow the session's layers. A filter that leaves none throws before the intent is quoted.
- `SAME_CHAIN` and the retired `ECO` arbiter add no layer to the filter. A permit that names only those, or names no layers, leaves intents unrestricted as before.
- `Session.settlementLayers` now also lists a Permit2 permit's layers, so its type widens from the IntentExecutor layers to every cross-chain settlement layer. It is metadata only: the session's encoding and permission id do not change, and sessions created on an earlier version keep working without the filter.
