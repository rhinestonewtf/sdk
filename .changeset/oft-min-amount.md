---
'@rhinestone/sdk': minor
---

Support `to.minAmount` on an `OFT` settlement-scoped permit. It floors the `send`'s `minAmountLD`, so the session key cannot accept a smaller delivery; it must be positive and at most uint64, both tokens need equal decimals served by the orchestrator, and it also refuses any send smaller than it. The orchestrator sends at 1% slippage, so set `to.minAmount` at most 99% of the amount you expect to send. Beside `ECO_IE` both layers enforce the floor.

`to.minAmount` binds every layer in the permit. A layer that cannot enforce it is refused when named and dropped under `'all'`: `CCTP` never can, so `['ECO_IE', 'CCTP']` with a floor throws and `'all'` drops `CCTP`; an `OFT` floor it cannot meet (not positive, above uint64, unequal or unserved decimals, two legs admitting one send with different floors) drops `OFT`. `ECO_IE` without `maxFeeBps` drops the same way when `from` legs give different `maxAmount`s. A floor needs no particular layer: the permit is refused only when no layer is left.

Where both tokens' decimals are served, a `to.minAmount` outside half of to all of any `from` leg's `maxAmount` throws as a units mistake, whatever the layers, `'all'` included.
