---
'@rhinestone/sdk': minor
---

Let a settlement-scoped permit settle through `ACROSS` beside its IntentExecutor layers, so a session without `fallback` pins its recipient on every route:

- A permit may name `ACROSS` beside `CCTP`, `OFT`, `ECO_IE` and `LZ`. The session holds both surfaces and no wildcard: the layers' calls, and the ACROSS claim policy on the ERC-1271 list, bound by `oneTimeUse` or, for a reusable session, by Permit2SenderPolicy or `preClaimOps: 'none'`. `approve(Permit2)` joins the layers' approve, so `maxAmount` stays one budget across every route, and `oneTimeUse` burns one id whichever route settles.
- Such a permit refuses `to.minAmount`, which `ACROSS` cannot enforce, and `fillDeadline`, which the IntentExecutor layers cannot. `maxFeeBps` still needs `ECO_IE` and prices it alone. `SAME_CHAIN_IE` still stands alone, and `fallback` still refuses an IntentExecutor layer.
- `settlementLayers: 'all'`, and so a permit without `fallback` that names no layer, now also includes `ACROSS` where it can settle the permit. Where it cannot (a `to.minAmount`, a native token, or a reusable session on a chain without Permit2SenderPolicy) it is listed in `settlementCoverage.dropped` with the reason naming it would be refused for. With a `fillDeadline`, `'all'` keeps `ACROSS` alone and drops the other layers.
- Intents signed with such a session are offered `ACROSS` beside the kept layers, and are funded only from the permit's `from` tokens within `maxAmount`.

Migration: a session built from `'all'` or an omitted `settlementLayers` changes its actions, ERC-1271 policies, permission id and enable digest wherever `ACROSS` is now included, so it must be enabled again. A permit naming only `ACROSS`, or only IntentExecutor layers, builds the same session as before. `DroppedSettlementLayer.layer` may now be `'ACROSS'`.
