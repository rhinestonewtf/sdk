---
'@rhinestone/sdk': patch
---

Resolve the `settlementLayers` `{ exclude }` filter on the orchestrator instead of in the SDK, so excluding specific layers automatically accounts for new settlement layers as they are added.
