---
'@rhinestone/sdk': minor
---

A `crossChainPermits` entry with several `from` or `to` tokens now uses each IntentExecutor layer for the tokens it moves. `from: [USDC, WETH]` to `[USDC, WETH]` settles over ACROSS for both and over CCTP (and LZ with `oneTimeUse`) for USDC, in one session. Each layer's call stays pinned to its one token and the permit's recipients, and a token is approved only to the layers that move it. A layer is no longer refused or dropped because the permit also names a token it does not move; an explicit `settlementLayers` list still refuses a token none of its layers moves.

Under `settlementLayers: 'all'` (the default), a permit whose layers were dropped only for such a token now keeps them, so its session's actions and `permissionId` change and an enabled session must be enabled again.
