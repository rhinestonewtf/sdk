---
'@rhinestone/sdk': minor
---

Accept `to.minAmount` on an `LZ` settlement-scoped permit, alone or beside `ECO_IE`. On a leg LZ reaches over Stargate, the session refuses a send whose `minAmountLD` is below it, which bounds the pool fee the send can accept; without it a Stargate send accepts whatever fee the pool charges. Set it to at most ~99% of the expected send, since the LZ API quotes `minAmountLD` with about 1% slippage. The floor is refused on a leg LZ reaches over CCTP, beside a second `to` leg on the same chain, above `maxAmount` or uint64, and unless both tokens are served with equal decimals; under `'all'` each of these drops `LZ` instead of failing the permit.
