---
'@rhinestone/sdk': patch
---

Send the `settlementLayers` `{ include }`/`{ exclude }` filter to the orchestrator natively instead of inverting `exclude` against a hardcoded layer list. `exclude` now stays correct as the orchestrator adds or removes settlement layers.
