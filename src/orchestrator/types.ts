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
type SupportedChain = SupportedMainnet | SupportedTestnet

type BundleStatus =
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

interface Execution {
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

type PostOrderBundleResult = (
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

interface BundleResult {
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

type MetaIntentEmpty = MetaIntentBase & WithoutOperation
type MetaIntentWithUserOp = MetaIntentBase & WithUserOp
type MetaIntentWithExecutions = MetaIntentBase & WithExecutions

type MetaIntent =
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

interface BundleEvent {
  bundleId: bigint
  type: string
  targetFillPayload: ChainExecution
  acrossDepositEvents: DepositEvent[]
}

interface Witness {
  recipient: Address
  tokenOut: [bigint, bigint][]
  depositId: bigint
  targetChain: bigint
  fillDeadline: number
  execs: Execution[]
  userOpHash: Hex
  maxFeeBps: number
}

interface Segment {
  arbiter: Address
  chainId: bigint
  idsAndAmounts: [bigint, bigint][]
  witness: Witness
}

interface MultiChainCompact {
  sponsor: Address
  nonce: bigint
  expires: bigint
  segments: Segment[]
}

interface SignedMultiChainCompact extends MultiChainCompact {
  originSignatures: Hex[]
  targetSignature: Hex
}

interface UserTokenBalance {
  tokenName: string
  tokenDecimals: number
  balance: bigint
  tokenChainBalance: {
    chainId: number
    tokenAddress: Address
    balance: bigint
  }[]
}

type TokenArrays6909 = readonly (readonly [bigint, bigint])[]

const BUNDLE_STATUS_PENDING = 'PENDING'
const BUNDLE_STATUS_FAILED = 'FAILED'
const BUNDLE_STATUS_EXPIRED = 'EXPIRED'
const BUNDLE_STATUS_PARTIALLY_COMPLETED = 'PARTIALLY_COMPLETED'
const BUNDLE_STATUS_COMPLETED = 'COMPLETED'
const BUNDLE_STATUS_UNKNOWN = 'UNKNOWN'

export type {
  SupportedChain,
  BundleStatus,
  PostOrderBundleResult,
  MetaIntentEmpty,
  MetaIntentWithUserOp,
  MetaIntentWithExecutions,
  MetaIntent,
  TokenArrays6909,
  Execution,
  BundleResult,
  BundleEvent,
  Witness,
  Segment,
  MultiChainCompact,
  SignedMultiChainCompact,
  UserTokenBalance,
}
export {
  BUNDLE_STATUS_PENDING,
  BUNDLE_STATUS_FAILED,
  BUNDLE_STATUS_EXPIRED,
  BUNDLE_STATUS_PARTIALLY_COMPLETED,
  BUNDLE_STATUS_COMPLETED,
  BUNDLE_STATUS_UNKNOWN,
}
