---
'@rhinestone/sdk': patch
---

Shrink an `LZ` permit's ArgPolicy when it carries both a Stargate leg and a feeless CCTP leg (RHI-8045): the two four-call batches share their call count, offsets and pull, so those pins are checked once ahead of the route OR instead of once per route. Base to Arbitrum plus Plasma drops from 127 to 111 rules (32.7 KB to 28.6 KB of initData). The policy accepts and refuses exactly the same calldata; permits with one route shape compile unchanged.
