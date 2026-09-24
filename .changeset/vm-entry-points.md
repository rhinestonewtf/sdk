---
'@rhinestone/sdk': major
---

Move VM-specific exports into dedicated `@rhinestone/sdk/solana` and `@rhinestone/sdk/evm` entry points. The package root keeps only VM-neutral surface, and the moved symbols have no root aliases.

- Import `solanaAddress`, `createSolanaSwigId`, `solanaMainnet`, `solanaDevnet` and every `Solana*`-named type (for example `SolanaAddress`, `SolanaChain`, `SolanaAccountConfig`, `SolanaStandaloneAccount`, `SolanaDeployOptions`, `SameChainSolanaTransaction`, `CrossChainSolanaOriginTransaction`, `SolanaExecutionMetadata`) from `@rhinestone/sdk/solana`.
- `@rhinestone/sdk/utils` is removed. Import its helpers (`experimental_getV0InitData`, `experimental_getRhinestoneInitData`, `experimental_getModuleSetup`, `toViewOnlyAccount`, `walletClientToAccount`, `wrapParaAccount`) from `@rhinestone/sdk/evm`.
- Import the validator address constants (`OWNABLE_VALIDATOR_ADDRESS`, `WEBAUTHN_VALIDATOR_ADDRESS`, `MULTI_FACTOR_VALIDATOR_ADDRESS`, `MULTI_FACTOR_VALIDATOR_V2_ADDRESS`, `SMART_SESSION_EMISSARY_ADDRESS`) and the `EvmAccountConfig`, `EvmAccountEntry`, `EvmReceiverAccountConfig` and `ManagedEvmAccount` types from `@rhinestone/sdk/evm`.
- Errors, including the Solana errors and guards, stay in `@rhinestone/sdk/errors`.
