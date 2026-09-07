---
'@rhinestone/sdk': minor
---

Support HyperCore trading from an intent. A transaction to `hyperCorePerp` or `hyperCoreSpot` now takes a `hyperCore.action`, and a new `@rhinestone/sdk/hypercore` subpath builds it.

- `openPerp({ asset, direction, notionalUsd })` and `closePerp({ asset, account })` build a marketable IOC order in one call, resolving Hyperliquid's asset index, mark and open position, and rounding the price and size onto its grids.
- `getPerpMarket`, `getPerpMarkets`, `getPerpPosition`, and `getPerpPositions` read Hyperliquid's public info endpoint, for the questions asked before building an order: which markets exist, what leverage one allows, whether there is a position to close.
- `HyperCoreAction` types all seven Hyperliquid L1 actions — `order`, `cancel`, `cancelByCloid`, `modify`, `batchModify`, `updateLeverage`, `updateIsolatedMargin` — for anything the builders do not cover.
- `HyperCoreError`, `UnknownPerpAssetError`, `PerpOrderTooSmallError`, `NoOpenPerpPositionError`, and `HyperCoreInfoRequestError` are exported from `/errors` with an `isHyperCoreError` guard.

An action that needs collateral pairs with `tokenRequests` that deliver it; a close, cancel, or leverage change rides a transaction that requests no tokens.
