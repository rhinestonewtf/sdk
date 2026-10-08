---
'@rhinestone/sdk': minor
---

A settlement-scoped cross-chain permit may now name several IntentExecutor layers (RHI-7826), or `settlementLayers: 'all'`:

- `settlementLayers: ['CCTP', 'LZ']` (any of `CCTP`, `OFT`, `ECO_IE`, `LZ`) allows each layer's scoped settlement call, plus one approve of the `from` token whose spender may be any of those layers' contracts. `maxAmount` is one cumulative budget across those approves, not one per layer. Each layer's own call keeps its own `maxAmount` cap, so an allowance the account already gave one of those contracts can move more than `maxAmount` in total.
- A named list is strict: every layer must be able to settle the permit on the session's chain (routes there, moves the `from` token, has the fields it needs), or the session is refused with that layer's reason.
- `'all'` keeps every one of `CCTP`, `OFT`, `ECO_IE` and `LZ` that can settle the permit and drops the rest, listing each with its reason in the session's `settlementCoverage.dropped`; it is refused, with each layer's reason, when none can. It never includes `SAME_CHAIN_IE`. The session's `settlementLayers`, and so the intent's settlement-layer filter, list only the layers it kept.
- `SAME_CHAIN_IE` still stands alone: combining it with another layer is refused. `OFT` and `LZ` cannot be combined either, since each pays a native LayerZero fee no pin bounds. `maxFeeBps` requires `ECO_IE` among the session's layers; with `'all'`, setting it asks for `ECO_IE`, so a dropped `ECO_IE` is refused with its reason.
- Layers compile in a fixed order, so `['LZ', 'CCTP']` and `['CCTP', 'LZ']` give the same session.
- `'all'` resolves against `GET /chains` and the clock when the session is created: store the created session and reuse it rather than rebuilding it from `'all'`.
- With `ECO_IE` among several layers, Eco's delivery floor (`maxAmount × (1 − maxFeeBps / 10000)`) means an intent settles over Eco only when it moves close to `maxAmount`.
- `allowFees` adds the paymaster as another branch of the same approve, with its own 5 USD budget.
- A single-layer permit compiles to the same session as before.
