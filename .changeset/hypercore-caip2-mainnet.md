---
"@rhinestone/sdk": minor
---

Use `hypercore:mainnet` as the canonical CAIP-2 id for the HyperCore destination instead of `eip155:1337` (RHI-4560), and source the CAIP-2 ↔ chain-id mapping from `@rhinestone/shared-configs`.

The orchestrator (shared-configs ≥ 1.6.14) now emits `hypercore:mainnet` for HyperCore — `eip155:1337` was semantically wrong (1337 is the Hardhat/Ganache local chain id). Changes:

- `hyperCoreMainnet.caip2` is `'hypercore:mainnet'`.
- `caip2.ts` now delegates `toCaip2` / `fromCaip2` / `isNonEvmChainId` to the shared-configs registry instead of maintaining its own hardcoded namespace tables. This removes the SDK↔orchestrator drift risk (both now read the same source) and means new chains are a shared-configs registry entry, not a hand-maintained table in each repo. `fromCaip2` still accepts legacy `eip155:1337` for back-compat.

HyperCore stays EVM-addressed: it's a `virtual` (`vmType: 'evm'`) registry entry, so `isNonEvmChainId(1337) === false` and its EVM token/recipient handling is unchanged. Bumps `@rhinestone/shared-configs` to 1.6.15.
