---
'@rhinestone/sdk': minor
---

Support `to.minAmount` on an `OFT`-only settlement-scoped permit. It floors the `send`'s `minAmountLD`, so the session key cannot accept a smaller delivery; it must be positive and at most `maxAmount`, both tokens need equal decimals served by the orchestrator, and it also refuses any send smaller than it. The orchestrator sends at 1% slippage, so set `to.minAmount` at most 99% of the amount you expect to send. A permit that names `OFT` beside another layer, or `'all'`, still refuses `to.minAmount`, since the floor would bind only the `OFT` send.
