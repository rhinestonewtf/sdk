---
'@rhinestone/sdk': patch
---

Shrink an `LZ` permit's ArgPolicy when it carries both a Stargate leg and a feeless CCTP leg (RHI-8045): the two four-call batches share their call count, offsets and pull, so those pins are checked once ahead of the route OR instead of once per route. Base to Arbitrum plus Plasma drops from 127 to 111 rules (32.7 KB to 28.6 KB of initData), with no change to which calldata the policy accepts; permits with one route shape compile unchanged. An `LZ` permit no longer admits the Stargate BUS route, which the orchestrator does not plan: Stargate is TAXI only, which takes Base to Arbitrum from 92 to 86 rules (23.8 KB to 22.2 KB) and Base to Arbitrum plus Plasma to 105 rules (27.1 KB).
