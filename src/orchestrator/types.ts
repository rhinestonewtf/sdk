import { Address, Hex } from 'viem'
import type { UserOperation } from 'viem/account-abstraction'
import {
  sepolia,
  baseSepolia,
  arbitrumSepolia,
  optimismSepolia,
  polygonAmoy,
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
} from 'viem/chains'

type SupportedTestnet =
  | typeof sepolia.id
  | typeof baseSepolia.id
  | typeof arbitrumSepolia.id
  | typeof optimismSepolia.id
  | typeof polygonAmoy.id
type SupportedMainnet =
  | typeof mainnet.id
  | typeof base.id
  | typeof arbitrum.id
  | typeof optimism.id
  | typeof polygon.id
export type SupportedChain = SupportedMainnet | SupportedTestnet

export const BUNDLE_STATUS_PENDING = 'PENDING'
export const BUNDLE_STATUS_FAILED = 'FAILED'
export const BUNDLE_STATUS_EXPIRED = 'EXPIRED'
export const BUNDLE_STATUS_PARTIALLY_COMPLETED = 'PARTIALLY_COMPLETED'
export const BUNDLE_STATUS_COMPLETED = 'COMPLETED'
export const BUNDLE_STATUS_UNKNOWN = 'UNKNOWN'

export type BundleStatus =
  | typeof BUNDLE_STATUS_PENDING
  | typeof BUNDLE_STATUS_EXPIRED
  | typeof BUNDLE_STATUS_PARTIALLY_COMPLETED
  | typeof BUNDLE_STATUS_COMPLETED
  | typeof BUNDLE_STATUS_FAILED
  | typeof BUNDLE_STATUS_UNKNOWN

type ClaimStatus = 'PENDING' | 'EXPIRED' | 'CLAIMED'

interface Claim {
  depositId: bigint
  chainId: number
  status: ClaimStatus
  claimTimestamp?: number
  claimTransactionHash?: Hex
}

export interface Execution {
  to: Address
  value: bigint
  data: Hex
}

type SimulationResult =
  | { success: true }
  | {
      success: false
      call: Execution
      details: {
        message: string
        contractAddress: Address
        args: any[]
        functionName: string
      }
    }

export type PostOrderBundleResult = (
  | {
      bundleId: bigint
      status: typeof BUNDLE_STATUS_PENDING
    }
  | {
      bundleId: bigint
      status: typeof BUNDLE_STATUS_FAILED
      error: SimulationResult
    }
)[]

export interface BundleResult {
  status: BundleStatus
  fillTimestamp?: number
  fillTransactionHash?: Hex
  claims: Claim[]
}

interface TokenTransfer {
  tokenAddress: Address
  amount: bigint
}

interface WithUserOp {
  userOp: UserOperation
  targetExecutions?: never
}

interface WithExecutions {
  userOp?: never
  targetExecutions: Execution[]
}

interface WithoutOperation {
  userOp?: never
  targetExecutions?: never
}

interface MetaIntentBase {
  targetChainId: number
  tokenTransfers: TokenTransfer[]
  targetAccount: Address
  accountAccessList?: {
    chainId: number
    tokenAddress: Address
  }[]
  omniLock?: boolean
}

export type MetaIntentEmpty = MetaIntentBase & WithoutOperation
export type MetaIntentWithUserOp = MetaIntentBase & WithUserOp
export type MetaIntentWithExecutions = MetaIntentBase & WithExecutions

export type MetaIntent =
  | MetaIntentEmpty
  | MetaIntentWithUserOp
  | MetaIntentWithExecutions

type ChainExecution = Execution & { chainId: number }

interface DepositEvent {
  originClaimPayload: ChainExecution
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  destinationChainId: number
  originChainId: number
  depositId: bigint
  quoteTimestamp: number
  fillDeadline: number
  exclusivityDeadline: number
  depositor: Address
  recipient: Address
  exclusiveRelayer: Address
  message: Hex
}

export interface BundleEvent {
  bundleId: bigint
  type: string
  targetFillPayload: ChainExecution
  acrossDepositEvents: DepositEvent[]
}

export interface Witness {
  recipient: Address
  tokenOut: [bigint, bigint][]
  depositId: bigint
  targetChain: bigint
  fillDeadline: number
  execs: Execution[]
  userOpHash: Hex
  maxFeeBps: number
}

export interface Segment {
  arbiter: Address
  chainId: bigint
  idsAndAmounts: [bigint, bigint][]
  witness: Witness
}

export interface MultiChainCompact {
  sponsor: Address
  nonce: bigint
  expires: bigint
  segments: Segment[]
}

export interface SignedMultiChainCompact extends MultiChainCompact {
  originSignatures: Hex[]
  targetSignature: Hex
}

export interface UserTokenBalance {
  tokenName: string
  tokenDecimals: number
  balance: bigint
  tokenChainBalance: {
    chainId: number
    tokenAddress: Address
    balance: bigint
  }[]
}

export type TokenArrays6909 = readonly (readonly [bigint, bigint])[]
