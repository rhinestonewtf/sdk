---
'@rhinestone/sdk': minor
---

Map the `LZ` bridge fill the orchestrator now returns for the LayerZero Value Transfer settlement layer, exposing `quoteId`, `dstChainKey` and `routeTypes` on `Quote.bridgeFill`, and accept `'LZ'` in the `settlementLayers` include/exclude filter.

A bridge fill whose type this SDK version predates no longer throws. It is a delivery-tracking handle rather than part of the signed intent, so an unrecognised one now leaves the route untracked — the same shape as a settlement layer that publishes no handle at all — instead of failing the whole quote.
