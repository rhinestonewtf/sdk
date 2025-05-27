import type { Address, Hex } from 'viem'
import type { UserOperation } from 'viem/account-abstraction'
import type {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
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
type SupportedTokenSymbol = 'ETH' | 'WETH' | 'USDC'
type SupportedToken = SupportedTokenSymbol | Address

type BundleStatus =
  | typeof BUNDLE_STATUS_PENDING
  | typeof BUNDLE_STATUS_EXPIRED
  | typeof BUNDLE_STATUS_PARTIALLY_COMPLETED
  | typeof BUNDLE_STATUS_COMPLETED
  | typeof BUNDLE_STATUS_FILLED
  | typeof BUNDLE_STATUS_PRECONFIRMED
  | typeof BUNDLE_STATUS_FAILED
  | typeof BUNDLE_STATUS_UNKNOWN

type AccountAccessListLegacy = {
  chainId: number
  tokenAddress: Address
}[]

type MappedChainTokenAccessList = {
  chainTokens?: {
    [chainId in SupportedChain]?: SupportedToken[]
  }
}

type UnmappedChainTokenAccessList = {
  chainIds?: SupportedChain[]
  tokens?: SupportedToken[]
}

type AccountAccessList =
  | AccountAccessListLegacy
  | MappedChainTokenAccessList
  | UnmappedChainTokenAccessList

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

type LockMode = 'HOOK' | 'COMPACT'

interface MetaIntentBase {
  targetAccount: Address
  targetChainId: number
  targetGasUnits?: bigint
  tokenTransfers: TokenTransfer[]
  accountAccessList?: AccountAccessList
  lockMode?: LockMode
  omniLock?: boolean
}

type OrderPath = {
  orderBundle: MultiChainCompact
  injectedExecutions: Execution[]
  intentCost: OrderCost
}[]

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

interface UserChainBalances {
  [chainId: number]: { [tokenAddress: Address]: bigint }
}

/// Subset of MetaIntent where up to one amount can be undefined
interface OrderFeeInput {
  targetChainId: number
  targetGasUnits?: bigint
  userOp?: {
    callGasLimit: bigint
    verificationGasLimit: bigint
    preVerificationGas: bigint
  }
  tokenTransfers: {
    tokenAddress: Address
    amount?: bigint // If no amount is set, max amount of inputs will be converted
    // NOTE: Only one token may have an unset amount
  }[]
  accountAccessList?: AccountAccessList
}

interface TokenFulfillmentStatus {
  hasFulfilled: boolean
  tokenAddress: Address
  amountSpent: bigint
  targetAmount: bigint
  fee: bigint
}

interface OrderCost {
  hasFulfilledAll: true
  tokensSpent: UserChainBalances
  tokensReceived: TokenFulfillmentStatus[]
}

interface InsufficientBalanceResult {
  hasFulfilledAll: false
  tokenShortfall: {
    tokenAddress: Address
    targetAmount: bigint
    amountSpent: bigint
    fee: bigint
    tokenSymbol: string
    tokenDecimals: number
  }[]
  totalTokenShortfallInUSD: bigint
}

type OrderCostResult = OrderCost | InsufficientBalanceResult

type TokenArrays6909 = readonly (readonly [bigint, bigint])[]

interface TokenConfig {
  symbol: string
  address: Address
  decimals: number
  balanceSlot: (address: Address) => Hex
}

const BUNDLE_STATUS_PENDING = 'PENDING'
const BUNDLE_STATUS_FAILED = 'FAILED'
const BUNDLE_STATUS_EXPIRED = 'EXPIRED'
const BUNDLE_STATUS_PARTIALLY_COMPLETED = 'PARTIALLY_COMPLETED'
const BUNDLE_STATUS_COMPLETED = 'COMPLETED'
const BUNDLE_STATUS_FILLED = 'FILLED'
const BUNDLE_STATUS_PRECONFIRMED = 'PRECONFIRMED'
const BUNDLE_STATUS_UNKNOWN = 'UNKNOWN'

export type {
  AccountAccessList,
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
  OrderPath,
  UserChainBalances,
  OrderFeeInput,
  TokenFulfillmentStatus,
  OrderCost,
  InsufficientBalanceResult,
  OrderCostResult,
  TokenConfig,
}
export {
  BUNDLE_STATUS_PENDING,
  BUNDLE_STATUS_FAILED,
  BUNDLE_STATUS_EXPIRED,
  BUNDLE_STATUS_PARTIALLY_COMPLETED,
  BUNDLE_STATUS_COMPLETED,
  BUNDLE_STATUS_FILLED,
  BUNDLE_STATUS_PRECONFIRMED,
  BUNDLE_STATUS_UNKNOWN,
}
