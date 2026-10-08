---
'@rhinestone/sdk': minor
---

Support `to.minAmount` on an `OFT` settlement-scoped permit. It floors the `send`'s `minAmountLD`, so the session key cannot accept a smaller delivery; it must be positive and at most `maxAmount`, both tokens need equal decimals served by the orchestrator, and it also refuses any send smaller than it. The orchestrator sends at 1% slippage, so set `to.minAmount` at most 99% of the amount you expect to send. Beside `ECO_IE` both layers enforce the floor.

`to.minAmount` now binds every layer in the permit. A layer that cannot enforce it is refused when named and dropped under `'all'`; `CCTP` never can, so `['ECO_IE', 'CCTP']` with a floor now throws, and `'all'` with a floor drops `CCTP`. An `OFT` floor it cannot meet (unequal decimals, above `maxAmount`, two legs with different floors) likewise drops `OFT` under `'all'` instead of failing the permit.
