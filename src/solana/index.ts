/**
 * Solana helpers, cluster descriptors, and Solana-specific types.
 * @module
 */
// biome-ignore lint/performance/noBarrelFile: published solana subpath
export { createSolanaSwigId } from '../accounts/solana/address'
export type {
  SolanaDeployOptions,
  SolanaStandaloneAccount,
} from '../api/account'
export type {
  SolanaAccountMeta,
  SolanaAddress,
  SolanaChain,
  SolanaInstruction,
  SolanaInstructionInput,
  SolanaProgramInstruction,
} from '../chains/non-evm'
export { solanaAddress, solanaDevnet, solanaMainnet } from '../chains/non-evm'
export type {
  CrossChainSolanaOriginTransaction,
  SameChainSolanaInstructionsTransaction,
  SameChainSolanaTransaction,
  SolanaAccountConfig,
  SolanaManagedAccountConfig,
  SolanaOwner,
  SolanaReceiverAccountConfig,
  SolanaStandaloneAccountConfig,
} from '../config/account'
export type {
  SolanaCrossChainExecutionMetadata,
  SolanaExecutionMetadata,
  SolanaInstructionsExecutionMetadata,
} from '../transactions/intents/types'
