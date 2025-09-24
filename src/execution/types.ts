import type { Account, Address, Chain, Hex } from 'viem'
import type { IntentOp } from '../orchestrator/types'

interface TokenPermissions {
  token: Address
  amount: bigint
}

/**
 * Multi-chain permit2 signing configuration
 */
interface MultiChainPermit2Config {
  chain: Chain
  intentOp: IntentOp
  eoaAccount: Account
}

/**
 * Result of a multi-chain permit2 signing operation
 */
interface MultiChainPermit2Result {
  chainId: number
  signature: Hex
  success: boolean
  error?: Error
}

/**
 * Batch permit2 signing result
 */
interface BatchPermit2Result {
  results: MultiChainPermit2Result[]
  totalChains: number
  successfulSignatures: number
  failedSignatures: number
  allSuccessful: boolean
}

export type {
  TokenPermissions,
  MultiChainPermit2Config,
  MultiChainPermit2Result,
  BatchPermit2Result,
}
