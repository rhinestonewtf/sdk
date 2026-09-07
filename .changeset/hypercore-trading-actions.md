---
'@rhinestone/sdk': minor
---

Support HyperCore trading from an intent. A transaction to `hyperCorePerp` or `hyperCoreSpot` now takes a `hyperCore.action`, and a new `@rhinestone/sdk/hypercore` subpath builds it.

- `hyperCore: { openPerp: { asset, direction, notionalUsd } }` opens a perpetual position. `prepareTransaction` resolves it against Hyperliquid — the asset index, the mark, and the price and size grids — and builds a marketable IOC.
- `hyperCore: { closePerp: { asset } }` closes one, reduce-only and sized from the account's open position, which it reads for you.
- `hyperCore: { action }` passes a Hyperliquid L1 action through verbatim. `HyperCoreAction` types all seven — `order`, `cancel`, `cancelByCloid`, `modify`, `batchModify`, `updateLeverage`, `updateIsolatedMargin`.
- `getPerpMarket`, `getPerpMarkets`, `getPerpPosition`, and `getPerpPositions` on `@rhinestone/sdk/hypercore` read Hyperliquid's public info endpoint, for the questions asked before sending a transaction: which markets exist, what leverage one allows, whether there is a position to close.
- `hyperliquid: { apiUrl, fetch }` on the SDK config points every one of those reads somewhere else.
- `HyperCoreError`, `UnknownPerpAssetError`, `PerpOrderTooSmallError`, `NoOpenPerpPositionError`, and `HyperCoreInfoRequestError` are exported from `/errors` with an `isHyperCoreError` guard.

An action that needs collateral pairs with `tokenRequests` that deliver it; a close, cancel, or leverage change rides a transaction that requests no tokens.
