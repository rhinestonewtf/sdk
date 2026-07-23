---
"@rhinestone/sdk": minor
---

Use `hypercore:mainnet` as the canonical CAIP-2 id for the HyperCore destination instead of `eip155:1337` (RHI-4560). `eip155:1337` was semantically wrong — 1337 is the Hardhat/Ganache local chain id — and the orchestrator now emits `hypercore:mainnet`.

- `hyperCoreMainnet.caip2` is `'hypercore:mainnet'`. `fromCaip2` still accepts legacy `eip155:1337` for back-compat.
- HyperCore stays EVM-addressed: it's a `virtual` (`vmType: 'evm'`) entry, so `isNonEvmChainId(1337) === false` and its EVM token/recipient handling is unchanged.
