/**
 * Solana helpers, cluster descriptors, and Solana-specific types.
 * @module
 */
// biome-ignore lint/performance/noBarrelFile: published solana subpath
export { createSolanaSwigId } from '../accounts/solana/address'
export { addPasskey, removePasskey } from '../actions/solana'
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
export type { SolanaAuthorityDisclosure } from '../clients/orchestrator/public'
export type {
  CrossChainSolanaOriginTransaction,
  SameChainSolanaAuthorityTransaction,
  SameChainSolanaInstructionsTransaction,
  SameChainSolanaTransaction,
  SolanaAccountConfig,
  SolanaAuthorityChange,
  SolanaAuthorityKey,
  SolanaManagedAccountConfig,
  SolanaOwner,
  SolanaPasskeyPermission,
  SolanaReceiverAccountConfig,
  SolanaSourceAsset,
  SolanaStandaloneAccountConfig,
} from '../config/account'
export type {
  SolanaAuthorityExecutionMetadata,
  SolanaCrossChainExecutionMetadata,
  SolanaExecutionMetadata,
  SolanaInstructionsExecutionMetadata,
} from '../transactions/intents/types'
