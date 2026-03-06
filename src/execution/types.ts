import type { Account, Chain, Hex } from 'viem'
import type { IntentOp } from '../orchestrator/types'

interface MultiChainSigningConfig {
  chain: Chain
  intentOp: IntentOp
  eoaAccount: Account
  wasmUrl: string
}

interface MultiChainSigningResult {
  chainId: number
  originSignatures: Hex[]
  destinationSignature: Hex
  success: boolean
  error?: Error
}

interface BatchSigningResult {
  results: MultiChainSigningResult[]
  totalChains: number
  successfulSignatures: number
  failedSignatures: number
  allSuccessful: boolean
}

/** @deprecated Use MultiChainSigningConfig */
type MultiChainPermit2Config = MultiChainSigningConfig
/** @deprecated Use MultiChainSigningResult */
type MultiChainPermit2Result = MultiChainSigningResult
/** @deprecated Use BatchSigningResult */
type BatchPermit2Result = BatchSigningResult

export type {
  MultiChainSigningConfig,
  MultiChainSigningResult,
  BatchSigningResult,
  MultiChainPermit2Config,
  MultiChainPermit2Result,
  BatchPermit2Result,
}
