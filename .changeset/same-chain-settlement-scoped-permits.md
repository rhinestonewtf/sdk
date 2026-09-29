---
'@rhinestone/sdk': minor
---

Add `SAME_CHAIN_IE` as a settlement-scoped cross-chain permit layer (RHI-7826): a smart account settling on its own chain through the IntentExecutor. `'SAME_CHAIN'` keeps its meaning (the Permit2 samechain arbiter), so no existing permit changes. `settlementLayers: ['SAME_CHAIN_IE']` restricts the session to one of two shapes, and every `to` leg must be on the session's chain:

- **Same token in and out:** one `transfer` of the `from` token, with the recipients pinned (an OR across legs) and `maxAmount` as a cumulative cap. The recipient must be someone other than the account, so set `allowRecipientNotAccount`; an `'any'` recipient lifts the pin and then requires `maxAmount`, since it would otherwise authorise every transfer of the token.
- **A different token:** exactly one `to` leg with a concrete recipient and a new `to.minAmount`, compiled through the existing `swap` scope's Rhinestone Swapper venue (sell token with `maxAmount` as its `maxTotal`, buy token, recipient). The Swapper's output bound (`minAmountOut`, or `amountOut` for exact-out) is pinned at `to.minAmount` or above: the key passes that bound and the route, so without a floor it could route the pulled input anywhere and accept nothing back. `validAfter`/`validUntil` bound the swap actions and the approve.
- `maxAmount` requires `oneTimeUse`, as on every settlement-scoped layer. Only sponsored intents without an app fee can settle, and only ERC-20 `from` tokens. A mix of transfer and swap legs throws, as does `to.minAmount` on any other layer.
- Intents signed with the session carry no bridge filter; its session refuses cross-chain calls on-chain.
