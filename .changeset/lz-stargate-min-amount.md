---
'@rhinestone/sdk': minor
---

Accept `to.minAmount` on an `LZ`-only settlement-scoped permit. On a leg LZ reaches over Stargate, the session refuses a send whose `minAmountLD` is below it, which bounds the pool fee the send can accept; without it a Stargate send accepts whatever fee the pool charges. Set it to at most ~99% of the expected send, since the LZ API quotes `minAmountLD` with about 1% slippage. The floor is refused on a leg LZ reaches over CCTP, beside another layer or a second `to` leg on the same chain, and unless both tokens are served with equal decimals.
