---
'@rhinestone/sdk': minor
---

Add `LZ` as a settlement-scoped cross-chain permit layer (RHI-7826): USDC through the LayerZero Value Transfer API, which the orchestrator runs as `approve(TransferDelegate)` then `LZMultiCall.execute(calls, quoteId)`. `settlementLayers: ['LZ']` restricts the session to those two calls:

- The approve may only name the chain's TransferDelegate, capped at `maxAmount`.
- LZMultiCall runs any call it is handed, so every nested call is pinned: the call count, each element offset, target, data pointer, length and selector, and the arguments that route funds. The pull may only move the `from` token from the account to LZMultiCall, and the sweep must return the token and native value to the account.
- The session accepts only the API's three USDC routes: Stargate TAXI or BUS (pool send to the leg's eid and recipient, refund to LZMultiCall, no native drop or compose), and CCTP (`depositForBurn` to the leg's domain and recipient, no destination caller, with the relay fee paid to LayerZero's receiver; to Plasma without it). `maxAmount` caps the pull and the relay fee.
- Chains follow what the orchestrator quotes: USDC by its registry address, over Stargate on Ethereum, Optimism, Polygon, Sonic, Soneium, Base, Arbitrum and Avalanche, and over CCTP on those with native USDC plus Unichain, Monad, HyperEVM, Plasma and Ink.
- An `LZ` permit requires `oneTimeUse`, since each Stargate send costs a native messaging fee no pin can bound. A permit whose pins exceed the on-chain ArgPolicy's 128 rules throws; name fewer `to` legs.
