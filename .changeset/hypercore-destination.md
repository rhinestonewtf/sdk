---
'@rhinestone/sdk': minor
---

Add HyperCore as a destination chain. `hyperCoreMainnet` (Hyperliquid's virtual trading L1, chain id 1337, settling on HyperEVM 999) can now be passed as `targetChain`, exactly like `solanaMainnet` / `tronMainnet`. HyperCore deposits are solver-mediated — the orchestrator builds the core-deposit executions and the user signs no destination session — so they prepare and sign without a destination-side smart session. Previously, expressing a HyperCore destination as a viem chain with id 1337 threw `UnsupportedChainError` at signing because 1337 is not a registered EVM chain.
