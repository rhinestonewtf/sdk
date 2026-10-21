---
'@rhinestone/sdk': minor
---

A `crossChainPermits` entry with several `from` or `to` tokens now uses each IntentExecutor layer for the tokens it moves. `from: [USDC, WETH]` to `[USDC, WETH]` settles over ACROSS for both and over CCTP (and LZ with `oneTimeUse`) for USDC, in one session. Each layer's call stays pinned to its one token and the permit's recipients, and a token is approved only to the layers that move it. A layer is no longer refused or dropped because the permit also names a token it does not move; an explicit `settlementLayers` list still refuses a token none of its layers moves.

Under `settlementLayers: 'all'` (the default), a permit whose layers were dropped only for such a token now keeps them, so its session's actions and `permissionId` change and an enabled session must be enabled again.

A chain's `maxAmount` counts in the units of the token it is set on, so an IntentExecutor layer is kept only for that token: under `'all'` a layer moving another token is dropped, and an explicit list refuses it with `CAP_TOKEN_MISMATCH`. ACROSS still applies the chain's one cap to each `from` token, as before. Under `'all'`, when both OFT and LZ could settle, the session keeps neither and lists both in `settlementCoverage.dropped`; an explicit list naming both is still refused. An explicit list naming LZ now refuses a `to` leg on a chain LZ does not reach.

A layer also takes only the `to` legs it delivers: a leg on a chain the layer does not serve, or one with a `to.minAmount`, no longer drops the layer for the legs it can settle. A floored leg must be delivered by a layer that enforces its floor (OFT, ECO_IE, LZ's Stargate send); an explicit list refuses a leg none of its layers delivers (`TOKEN_NOT_ROUTED`, or `LAYER_NOT_SERVED` when none routes to that chain).

A `to` leg a layer cannot pin on its own (no route or shared Eco prover to its chain, a recipient the layer cannot pin, a floor it cannot express) is left to the other layers instead of dropping the layer, and ECO_IE weighs only the caps of the `from` tokens it moves. An explicit list still refuses such a leg when none of its layers pins it, with that layer's own refusal.

Two `to` legs that reach the same destination for the same recipient (an open recipient matches any) with different `to.minAmount`s are refused with `CONFLICTING_LEG_FLOORS` for the whole permit, as every flooring layer already refused them. Legs reach the same destination when they share a chain and token, or a CCTP domain or LayerZero endpoint id that a layer pins, as a testnet shares its mainnet's CCTP domain. `maxFeeBps` still requires ECO_IE to settle every `to` leg.

A `to.minAmount` is checked against the caps that fund it: every capped `from` leg a one-token route (OFT, LZ, or ECO_IE between two of one stablecoin) carries to it must hold it within half of to all of its cap, and at least one capped leg any route carries must. Each layer also leaves out a floored leg that the cap funding its own call cannot fund, so ECO_IE never pins a floor far under its reward. A USDC leg floored at 95 beside a USDT0 leg floored at 900 builds with USDC capped at 100 and USDT0 at 1000; a floor above its own token's cap is still refused with `MIN_AMOUNT_OUTSIDE_CAP`.
