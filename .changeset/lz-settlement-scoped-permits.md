---
'@rhinestone/sdk': minor
---

Add `LZ` as a settlement-scoped cross-chain permit layer (RHI-7826): USDC through the LayerZero Value Transfer API, which the orchestrator runs as `approve(TransferDelegate)` then `LZMultiCall.execute(calls, quoteId)`. `settlementLayers: ['LZ']` restricts the session to those two calls:

- The approve may only name the chain's TransferDelegate.
- LZMultiCall runs any call it is handed, so every nested call is pinned: the call count, each element offset, target, data pointer, length and selector, and the arguments that route funds. The pull may only move the `from` token from the account to LZMultiCall, and the sweep must return the token and native value to the account.
- The session accepts only the API's three USDC routes: Stargate TAXI or BUS (pool send to the leg's eid and recipient, refund to LZMultiCall, no native drop or compose), and CCTP (`depositForBurn` to the leg's domain and recipient, no destination caller, with the relay fee paid to LayerZero's receiver, at most 1 USDC and `maxAmount`; to Plasma without it). The session runs one `execute`, whatever the route, and `maxAmount` caps its pull: the one-time-use burn admits every later op in its transaction, so this keeps a stale TransferDelegate allowance from funding a second route and a second Stargate send from paying another native fee.
- Chains follow what the orchestrator quotes: USDC by its registry address, over Stargate on Ethereum, Optimism, Polygon, Sonic, Soneium, Base, Arbitrum and Avalanche, and over CCTP on those with native USDC plus Unichain, Monad, HyperEVM, Plasma and Ink. A `to` leg no route from the session's chain reaches is left to the other chains' sessions; one it reaches with another token throws.
- An `LZ` permit requires `oneTimeUse`. A permit whose pins exceed the on-chain ArgPolicy's 128 rules fails to encode; name fewer `to` legs.

The approve of every IntentExecutor-layer permit now caps the total it grants at `maxAmount`, not each call: the one-time-use burn admits every later op in its transaction, so a per-call bound let repeated approves grant the cap several times.
