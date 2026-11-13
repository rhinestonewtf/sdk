import type {
  SettlementLayer as CrossChainSettlementLayer,
  SupportedChain,
  SupportedMainnet,
  SupportedOPStackMainnet,
  SupportedOPStackTestnet,
  SupportedTestnet,
} from '@rhinestone/shared-configs'
import type { Address, Chain, Hex, TypedDataDefinition } from 'viem'

type SupportedTokenSymbol = 'ETH' | 'WETH' | 'USDC' | 'USDT' | 'USDT0'
type SupportedToken = SupportedTokenSymbol | Address

type AccountType = 'GENERIC' | 'ERC7579' | 'EOA'

const INTENT_STATUS_PENDING = 'PENDING'
const INTENT_STATUS_FAILED = 'FAILED'
const INTENT_STATUS_EXPIRED = 'EXPIRED'
const INTENT_STATUS_COMPLETED = 'COMPLETED'
const INTENT_STATUS_FILLED = 'FILLED'
const INTENT_STATUS_PRECONFIRMED = 'PRECONFIRMED'
const INTENT_STATUS_CLAIMED = 'CLAIMED'

type IntentStatus =
  | typeof INTENT_STATUS_PENDING
  | typeof INTENT_STATUS_EXPIRED
  | typeof INTENT_STATUS_COMPLETED
  | typeof INTENT_STATUS_FILLED
  | typeof INTENT_STATUS_PRECONFIRMED
  | typeof INTENT_STATUS_FAILED
  | typeof INTENT_STATUS_CLAIMED

type AccountAccessListLegacy = {
  chainId: number
  tokenAddress: Address
  amount?: bigint
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

type SettlementLayer =
  | 'SAME_CHAIN'
  | 'INTENT_EXECUTOR'
  | CrossChainSettlementLayer

type FundingMethod = 'COMPACT' | 'PERMIT2' | 'NO_FUNDING'

const SIG_MODE_EMISSARY = 0
const SIG_MODE_ERC1271 = 1
const SIG_MODE_EMISSARY_ERC1271 = 2
const SIG_MODE_ERC1271_EMISSARY = 3
const SIG_MODE_EMISSARY_EXECUTION = 4
const SIG_MODE_EMISSARY_EXECUTION_ERC1271 = 5
const SIG_MODE_ERC1271_EMISSARY_EXECUTION = 6

type SignatureMode =
  | typeof SIG_MODE_EMISSARY
  | typeof SIG_MODE_ERC1271
  | typeof SIG_MODE_EMISSARY_ERC1271
  | typeof SIG_MODE_ERC1271_EMISSARY
  | typeof SIG_MODE_EMISSARY_EXECUTION
  | typeof SIG_MODE_EMISSARY_EXECUTION_ERC1271
  | typeof SIG_MODE_ERC1271_EMISSARY_EXECUTION

type AuxiliaryFunds = {
  [chainId: number]: Record<Address, bigint>
}

type SwapQuoter =
  | '1inch'
  | '0x'
  | 'velora'
  | 'kyberswap'
  | 'fynd'
  | 'fynd-hosted'
  | 'bebop'
  | 'relay'

type SwapQuoterFilter = { include: SwapQuoter[] } | { exclude: SwapQuoter[] }

interface IntentOptions {
  topupCompact: boolean
  feeToken?: Address | SupportedTokenSymbol
  appFees?: AppFeeRate
  protocolFees?: ProtocolFeeRate
  sponsorSettings?: SponsorSettings
  settlementLayers?: SettlementLayer[]
  /**
   * Restrict swap routing to specific quoters. An empty include list means no
   * quoter is allowed and intentionally fails the request closed.
   */
  quoters?: SwapQuoterFilter
  signatureMode?: SignatureMode
  auxiliaryFunds?: AuxiliaryFunds
  /**
   * Absolute unix timestamp (seconds) overriding the on-chain fill deadline.
   * Tokenless route only; ignored elsewhere. Bounds (`now + 120s` ..
   * `now + 86400s`) are enforced by the orchestrator.
   */
  customDeadline?: number
}

interface AppFeeRate {
  feeBps: number
}

/**
 * Rate for the Rhinestone protocol fee (RHI-4904) — a clone of the app fee
 * that always accrues to Rhinestone regardless of the caller's API key, and
 * (unlike the app fee) can be sponsored via `sponsorSettings.protocolFees`.
 */
interface ProtocolFeeRate {
  feeBps: number
}

/** An integrator's accrued app-fee balance, as USD totals. */
interface AppFeeBalances {
  /** Collected (accrued) app fees available to withdraw, valued in USD at collection. */
  withdrawableUsd: number
  /** Value reserved by an in-flight withdrawal; `0` until withdrawals are enabled. */
  pendingUsd: number
}

interface AppFee extends AppFeeRate {
  baseAmount: string
  amount: string
  chainId: number
  tokenAddress: Address
}

interface SponsorSettings {
  gasSponsored: boolean
  bridgeFeesSponsored: boolean
  swapFeesSponsored: boolean
  protocolFeesSponsored?: boolean
}

interface PortfolioToken {
  symbol: string
  decimals: number
  balances: {
    locked: bigint
    unlocked: bigint
  }
  chains: [
    {
      chain: number
      address: Address
      locked: bigint
      unlocked: bigint
    },
  ]
}

type Portfolio = PortfolioToken[]

interface IntentInput {
  account: Account
  destinationChainId: number
  destinationExecutions: Execution[]
  destinationGasUnits?: bigint
  tokenRequests: {
    tokenAddress: Address
    amount?: bigint
  }[]
  recipient?: Account
  accountAccessList?: AccountAccessList
  options: IntentOptions
  preClaimExecutions?: Record<number, Execution[]>
}

interface ChainGasCost {
  chainId: number
  gasUSD: number
}

interface GasCostBreakdown {
  originChains: ChainGasCost[]
  destination: ChainGasCost
  totalUSD: number
}

/** @deprecated Alps cost representation retained for compatibility; use QuoteCost for Blanc. */
interface FeeBreakdown {
  gasFee: string
  bridgeFee: string
  protocolFee: string
  swapFee: string
  settlementFee: string
  appFee: string
}

/** @deprecated Alps cost representation retained for compatibility; use QuoteCost for Blanc. */
interface FeesByTokenEntry {
  amount: string
  breakdown: FeeBreakdown
}

/** @deprecated Alps cost representation retained for compatibility; use QuoteCost for Blanc. */
interface FeeBreakdownUSD {
  gasFeeUSD: number
  bridgeFeeUSD: number
  protocolFeeUSD: number
  swapFeeUSD: number
  settlementFeeUSD: number
  appFeeUSD: number
  totalFeeUSD: number
}

/** @deprecated Alps cost representation retained for compatibility; use QuoteCost for Blanc. */
interface IntentCost {
  hasFulfilledAll: boolean
  tokensReceived: [
    {
      tokenAddress: Address
      hasFulfilled: boolean
      amountSpent: string
      destinationAmount: string
      fee: string
      feeBreakdown?: FeeBreakdown
      feesByToken?: Record<Address, FeesByTokenEntry>
    },
  ]
  sponsoredFee: {
    relayer: number
    protocol: number
  }
  appFee?: AppFee[]
  tokensSpent: {
    [chainId: string]: {
      [tokenAddress: Address]: {
        locked: string
        unlocked: string
        version: number
      }
    }
  }
  gasCost?: GasCostBreakdown
  feeBreakdownUSD?: FeeBreakdownUSD
}

/** @deprecated Alps bundle representation retained for compatibility; use quote.signData for Blanc signing. */
export interface Op {
  vt: Hex
  ops: Execution[]
}

/** @deprecated Alps bundle representation retained for compatibility; use quote.signData for Blanc signing. */
export interface ExecutionWithPlaceholders extends Execution {
  senderAddressPlaceholder?: Address
  recipientAddressPlaceholder?: Address
}

/** @deprecated Alps bundle representation retained for compatibility; use Quote for Blanc flows. */
export interface ElementSwapDestination {
  tokenIn: Address
  amountIn: string
  amountOut: string
  slippage: number
  quoter: string
  executions: ExecutionWithPlaceholders[]
  outputDecimals: number
  outputSymbol: string
}

/** @deprecated Alps bundle representation retained for compatibility; use Quote for Blanc flows. */
export interface ElementSwapOrigin {
  tokenIn: Address
  tokenOut: Address
  amountIn: string
  amountOut: string
  executions: ExecutionWithPlaceholders[]
  inputDecimals: number
  inputSymbol: string
  price: number
}

/** @deprecated Alps bundle representation retained for compatibility; use quote.signData for Blanc signing. */
interface IntentOpElementMandate {
  recipient: Address
  tokenOut: [[string, string]]
  swapDestinations?: (ElementSwapDestination | null)[]
  destinationChainId: string
  fillDeadline: string
  destinationOps: Op
  preClaimOps: Op
  qualifier: {
    settlementContext: {
      settlementLayer: SettlementLayer
      fundingMethod: FundingMethod
      using7579: boolean
      requestId?: Hex
      subsidizedAmount?: string
      gasRefund?: {
        token: Address
        exchangeRate: bigint
        overhead: bigint
      }
    }
    encodedVal: Hex
  }
  minGas: string
}

/** @deprecated Alps bundle representation retained for compatibility; use quote.signData for Blanc signing. */
interface IntentOpElement {
  arbiter: Address
  chainId: string
  idsAndAmounts: [[string, string]]
  spendTokens: [[string, string]]
  swapOrigins?: Record<string, ElementSwapOrigin>
  beforeFill: boolean
  smartAccountStatus?: AccountContext
  mandate: IntentOpElementMandate
}

/** @deprecated Alps bundle representation retained for compatibility; use Quote for Blanc flows. */
interface IntentOp {
  sponsor: Address
  nonce: string
  targetExecutionNonce: string
  expires: string
  elements: IntentOpElement[]
  serverSignature: string
  signedMetadata: {
    fees: unknown
    quotes: Record<Address, unknown[]>
    tokenPrices: Record<string, number>
    opGasParams: Record<
      string,
      {
        l1BaseFee: string
        l1BlobBaseFee: string
        baseFeeScalar: string
        blobFeeScalar: string
      }
    > & {
      estimatedCalldataSize: number
    }
    gasPrices: Record<string, string>
    account: AccountWithContext
    recipient?: AccountWithContext
  }
}

type AccountContext =
  | {
      accountType: 'smartAccount'
      isDeployed: boolean
      isERC7579: boolean
      erc7579AccountType: string
      erc7579AccountVersion: string
    }
  | {
      accountType: 'EOA'
    }

interface Account {
  address: Address
  accountType: AccountType
  setupOps: Pick<Execution, 'to' | 'data'>[]
  delegations?: Delegations
  emissaryConfig?: EmissarySetupConfig
  /** @deprecated Use mockSignatures for per-chain accuracy. Kept as global fallback for backward-compat. */
  mockSignature?: Hex
  /** Per-chain SSX mock signatures keyed by decimal chainId string.
   *  Takes precedence over mockSignature for each chain present. */
  mockSignatures?: Record<`${number}`, Hex>
}

type AccountWithContext = Omit<
  Account,
  'delegations' | 'mockSignature' | 'mockSignatures'
> & {
  accountContext: { [chainId: number]: AccountContext }
  requiredDelegations?: Delegations
}

interface Delegation {
  contract: Address
}

type Delegations = Record<number, Delegation>

interface EmissarySetupConfig {
  configId: number
  validatorAddress: Address
  emissaryAddress: Address
  emissaryConfig: EmissaryConfig
  emissaryEnable: EmissaryEnable
}

interface EmissaryConfig {
  configId: number
  allocator: Address
  scope: number
  resetPeriod: number
  validator: Address
  validatorConfig: Hex
}

interface EmissaryEnable {
  allocatorSig: Hex
  userSig: Hex
  expires: bigint
  nonce: bigint
  allChainIds: bigint[]
  chainIndex: bigint
}

interface WrapRequired {
  type: 'wrap'
  amount: bigint
}

interface ApprovalRequired {
  type: 'approval'
  amount: bigint
  spender: Address
  /** ERC-2612 permit for `spender`; an EOA signs it instead of sending the approve. Present only where the token supports it. */
  permit?: TypedDataDefinition
}

type TokenRequirements = {
  [chainId: number]: {
    [tokenAddress: Address]: ApprovalRequired | WrapRequired
  }
}

/** @deprecated Alps route retained for compatibility; use Quote for Blanc flows. */
interface IntentRoute {
  intentOp: IntentOp
  intentCost: IntentCost
  tokenRequirements?: TokenRequirements
}

/** A token amount debited or delivered by a quoted route. */
interface QuoteCostToken {
  chainId: number
  tokenAddress: Address
  symbol: string | null
  decimals: number | null
  price: { usd: number } | null
  amount: bigint
}

type QuoteFeeCategory =
  | 'gas'
  | 'bridge'
  | 'swap'
  | 'app'
  | 'protocol'
  | 'sponsorSurcharge'

/** What a quoted route costs. */
interface QuoteCost {
  /** Tokens debited from the account, coalesced per chain and token. */
  input: QuoteCostToken[]
  /** Tokens delivered on the destination. */
  output: QuoteCostToken[]
  fees: {
    total: { usd: number }
    /**
     * Per category: `usd` is the full cost whoever pays it; `sponsored` is
     * whether a sponsor covers it.
     */
    breakdown: Record<QuoteFeeCategory, { usd: number; sponsored: boolean }>
  }
}

/** A route the orchestrator quoted for the intent; v1 uses the recommended one. */
interface Quote {
  /** Identifies the quote at submit; equals the submitted intent's id. */
  intentId: string
  /** Unix seconds; a submit after this is refused. */
  expiresAt: number
  estimatedFillTime: { seconds: number }
  settlementLayer: SettlementLayer
  /** The payloads to sign, with uint fields as bigints. */
  signData: {
    origin: TypedDataDefinition[]
    destination: TypedDataDefinition
    targetExecution?: TypedDataDefinition
  }
  cost: QuoteCost
  /** Approvals, wraps and permits the account needs first. EOA accounts only. */
  tokenRequirements?: TokenRequirements
}

/** @deprecated Alps submit result retained for compatibility; use Blanc transaction results for new flows. */
interface IntentResult {
  result: {
    id: string
    status: IntentStatus
  }
}

type OriginSignature = Hex | { notarizedClaimSig: Hex; preClaimSig: Hex }

/** @deprecated Signed Alps bundle retained for compatibility; use Blanc transaction results for new flows. */
type SignedIntentOp = IntentOp & {
  originSignatures: OriginSignature[]
  destinationSignature: Hex
  targetExecutionSignature?: Hex
  signedAuthorizations?: readonly {
    chainId: number
    address: Address
    nonce: number
    yParity: number
    r: Hex
    s: Hex
  }[]
  permitSignatures?: Record<number, Record<Address, Hex>>
}

interface TokenConfig {
  symbol: string
  address: Address
  decimals: number
}

export type TokenPrices = {
  [key in SupportedTokenSymbol]?: number
}

export type GasPrices = {
  [key in SupportedMainnet | SupportedTestnet]?: bigint
}

export type OPNetworkParams =
  | {
      [key in SupportedOPStackMainnet | SupportedOPStackTestnet]?: {
        l1BaseFee: bigint
        l1BlobBaseFee: bigint
        baseFeeScalar: bigint
        blobFeeScalar: bigint
      }
    }
  | {
      estimatedCalldataSize: number
    }

interface SplitIntentsInput {
  chain: Chain
  tokens: Record<Address, bigint>
  settlementLayers?: SettlementLayer[]
}

interface SplitIntentsResult {
  intents: Record<Address, bigint>[]
}

/**
 * A settlement layer returned the intent's funds to the account instead of
 * delivering them.
 *
 * Not a claim: Rhinestone neither built nor broadcast this transaction, and a
 * refund never makes the intent succeed — a refunded intent stays `FAILED`,
 * because it did not do what was asked.
 *
 * `chain` rather than the `chainId` its neighbours here use, because the field
 * is served verbatim on both orchestrator API versions and a second spelling
 * would be a second shape to keep in step.
 */
interface IntentRefund {
  /** Chain the refund landed on. */
  chain: number
  /**
   * The refund transaction, in the chain's native form (EVM hex, Solana
   * base58, Tron hex). Interpret it against `chain`.
   */
  txHash: string
}

interface IntentOpStatus {
  status: IntentStatus
  claims: Claim[]
  destinationChainId: number
  userAddress: Address
  fillTimestamp?: number
  fillTransactionHash?: Hex
  /**
   * Bridge refunds observed for this intent.
   *
   * Undefined means no refund is KNOWN — never that the funds were kept. A
   * refund is recorded only where a settlement layer evidences it with a
   * transaction, so presence is a fact and absence is not a claim.
   *
   * `getIntentOpStatus` passes the orchestrator's refunds through verbatim
   * and omits the field when the orchestrator does.
   */
  refunds?: IntentRefund[]
}

interface PortfolioTokenChainResponse {
  chainId: number
  tokenAddress: Address
  balance: {
    locked: string
    unlocked: string
  }
}

interface PortfolioTokenResponse {
  tokenName: string
  tokenDecimals: number
  balance: {
    locked: string
    unlocked: string
  }
  tokenChainBalance: PortfolioTokenChainResponse[]
}

type PortfolioResponse = PortfolioTokenResponse[]

export type {
  Account,
  AccountAccessList,
  AccountType,
  AppFee,
  AppFeeBalances,
  AppFeeRate,
  ProtocolFeeRate,
  ApprovalRequired,
  AuxiliaryFunds,
  Execution,
  FeeBreakdown,
  FeeBreakdownUSD,
  FeesByTokenEntry,
  IntentCost,
  IntentInput,
  IntentOp,
  IntentOpElement,
  IntentOpElementMandate,
  IntentOpStatus,
  IntentRefund,
  IntentResult,
  IntentRoute,
  MappedChainTokenAccessList,
  OriginSignature,
  Portfolio,
  PortfolioResponse,
  PortfolioToken,
  PortfolioTokenResponse,
  Quote,
  QuoteCost,
  SettlementLayer,
  SignatureMode,
  SignedIntentOp,
  SplitIntentsInput,
  SplitIntentsResult,
  SwapQuoter,
  SwapQuoterFilter,
  SupportedChain,
  TokenConfig,
  TokenRequirements,
  UnmappedChainTokenAccessList,
  WrapRequired,
}
export {
  INTENT_STATUS_CLAIMED,
  INTENT_STATUS_COMPLETED,
  INTENT_STATUS_EXPIRED,
  INTENT_STATUS_FAILED,
  INTENT_STATUS_FILLED,
  INTENT_STATUS_PENDING,
  INTENT_STATUS_PRECONFIRMED,
  SIG_MODE_EMISSARY,
  SIG_MODE_EMISSARY_ERC1271,
  SIG_MODE_EMISSARY_EXECUTION,
  SIG_MODE_EMISSARY_EXECUTION_ERC1271,
  SIG_MODE_ERC1271,
  SIG_MODE_ERC1271_EMISSARY,
  SIG_MODE_ERC1271_EMISSARY_EXECUTION,
}
