import type {
  SettlementLayer as CrossChainSettlementLayer,
  SupportedChain,
  SupportedMainnet,
  SupportedOPStackMainnet,
  SupportedOPStackTestnet,
  SupportedTestnet,
} from '@rhinestone/shared-configs'
import type { Address, Chain, Hex, TypedDataDefinition } from 'viem'
import type { NonEvmAddress } from './destinations'

type SupportedTokenSymbol = 'ETH' | 'WETH' | 'USDC' | 'USDT' | 'USDT0'
type SupportedToken = SupportedTokenSymbol | Address

type AccountType = 'GENERIC' | 'ERC7579' | 'EOA'

const INTENT_STATUS_PENDING = 'PENDING'
const INTENT_STATUS_FAILED = 'FAILED'
const INTENT_STATUS_COMPLETED = 'COMPLETED'

/**
 * High-level intent status.
 *
 * - `PENDING`   – the intent has been accepted and is being processed
 * - `COMPLETED` – all operations finished successfully
 * - `FAILED`    – the intent failed (inspect `operations` for details)
 */
type IntentStatus =
  | typeof INTENT_STATUS_PENDING
  | typeof INTENT_STATUS_COMPLETED
  | typeof INTENT_STATUS_FAILED

type MappedChainTokenAccessList = {
  chainTokens?: {
    [chainId in SupportedChain]?: SupportedToken[]
  }
  chainTokenAmounts?: {
    [chainId in SupportedChain]?: Partial<Record<SupportedToken, bigint>>
  }
}

type UnmappedChainTokenAccessList = {
  chainIds?: SupportedChain[]
  tokens?: SupportedToken[]
}

type AccountAccessList =
  | MappedChainTokenAccessList
  | UnmappedChainTokenAccessList

/** Per-operation status. */
type OperationStatus = 'PENDING' | 'COMPLETED' | 'FAILED'

/**
 * Why an operation failed. Only meaningful when `status` is `FAILED`.
 *
 * - `EXPIRED`          – the operation deadline passed without completion
 * - `REVERTED`         – the on-chain transaction reverted
 * - `RELAYER_FAILURE`  – the relayer could not submit the transaction
 */
type FailureReason = 'EXPIRED' | 'REVERTED' | 'RELAYER_FAILURE'

/**
 * One operation per chain involved in the intent.
 *
 * The orchestrator returns `items[]` per chain for future extensibility;
 * the SDK flattens to one entry per chain for simpler DX.
 */
type ChainOperation =
  | {
      /** Chain ID this operation belongs to. */
      chain: number
      status: 'PENDING'
    }
  | {
      chain: number
      status: 'COMPLETED'
      /** Transaction hash of the confirmed on-chain transaction. */
      txHash: Hex
      /** UNIX epoch seconds when the on-chain transaction was confirmed. */
      timestamp: number
    }
  | {
      chain: number
      status: 'FAILED'
      /** Why the operation failed. */
      failureReason: FailureReason
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

type SettlementLayerFilter =
  | { include: SettlementLayer[] }
  | { exclude: SettlementLayer[] }

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

interface IntentOptions {
  feeToken?: Address | SupportedTokenSymbol
  sponsorSettings?: SponsorSettings
  settlementLayers?: SettlementLayerFilter
  signatureMode?: SignatureMode
  auxiliaryFunds?: AuxiliaryFunds
}

interface SponsorSettings {
  gas: boolean
  bridgeFees: boolean
  swapFees: boolean
}

interface PortfolioToken {
  symbol: string
  chains: {
    chain: number
    address: Address
    decimals: number
    amount: bigint
  }[]
}

type Portfolio = PortfolioToken[]

interface IntentInput {
  account: Account
  destinationChainId: number
  destinationExecutions: Execution[]
  destinationGasUnits?: bigint
  tokenRequests: {
    tokenAddress: Address | NonEvmAddress
    amount?: bigint
  }[]
  recipient?: Account
  accountAccessList?: AccountAccessList
  options: IntentOptions
  preClaimExecutions?: Record<number, Execution[]>
}

interface UsdAmount {
  usd: number
}

type Price = { usd: number } | null

interface CostTokenEntry {
  chainId: number
  tokenAddress: Address
  symbol: string | null
  decimals: number | null
  price: Price
  amount: bigint
}

interface FeeBreakdown {
  gas: UsdAmount
  bridge: UsdAmount
  swap: UsdAmount
}

interface Fees {
  total: UsdAmount
  breakdown: FeeBreakdown
}

interface Cost {
  input: CostTokenEntry[]
  output: CostTokenEntry[]
  fees: Fees
}

interface EstimatedFillTime {
  seconds: number
}

interface SignData {
  origin: TypedDataDefinition[]
  destination: TypedDataDefinition
  targetExecution?: TypedDataDefinition
}

// Per-intent tracking handle for layers that hand off to a third-party bridge
type BridgeFill =
  | { type: 'OFT'; destinationChainId: number }
  | { type: 'RELAY'; destinationChainId: number; requestId: string }
  | { type: 'NEAR'; destinationChainId: number; depositAddress: Address }
  | { type: 'RHINO'; destinationChainId: number; commitmentId: string }
  | {
      type: 'CCTP'
      destinationChainId: number
      sourceDomainId: number
      destinationDomainId: number
    }

interface Quote {
  intentId: string
  expiresAt: number
  estimatedFillTime: EstimatedFillTime
  settlementLayer: SettlementLayer
  signData: SignData
  cost: Cost
  tokenRequirements?: TokenRequirements
  bridgeFill?: BridgeFill
}

interface QuoteResponse {
  routes: Quote[]
}

type OriginSignature = Hex | { notarizedClaimSig: Hex; preClaimSig: Hex }

interface SignedAuthorization {
  chainId: number
  address: Address
  nonce: number
  yParity: number
  r: Hex
  s: Hex
}

interface IntentSubmitRequest {
  intentId: string
  signatures: {
    origin: OriginSignature[]
    destination: Hex
    targetExecution?: Hex
  }
  authorizations?: {
    sponsor?: SignedAuthorization[]
    recipient?: SignedAuthorization[]
  }
}

/**
 * Internal augmentation of the submit request. Not part of the blanc public
 * schema, but the orchestrator still reads `options.dryRun` from the raw body.
 * Used by the SDK's `simulate` flag — never surfaced to consumers.
 */
interface IntentSubmitRequestInternal extends IntentSubmitRequest {
  options?: {
    dryRun?: boolean
  }
}

interface IntentSubmitResponse {
  intentId: string
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
  // EVM accounts use viem's `Address`; non-EVM recipients pass the raw
  // chain-namespace-specific string (Solana base58, Tron T-prefix). The
  // orchestrator validates the format against the destination's CAIP-2
  // namespace.
  address: Address | NonEvmAddress
  /**
   * Account type — required for EVM accounts. Omitted for non-EVM
   * recipients (Solana / Tron) where smart-account semantics don't apply
   * and the orchestrator schema requires it unset.
   */
  accountType?: AccountType
  /**
   * Per-chain account-setup operations — required for EVM accounts.
   * Omitted for non-EVM recipients for the same reason as `accountType`.
   */
  setupOps?: Pick<Execution, 'to' | 'data'>[]
  delegations?: Delegations
  /** Per-chain SSX mock signatures keyed by decimal chainId string. */
  mockSignatures?: Record<`${number}`, Hex>
}

type AccountWithContext = Omit<Account, 'delegations' | 'mockSignatures'> & {
  accountContext: { [chainId: number]: AccountContext }
  requiredDelegations?: Delegations
}

interface Delegation {
  contract: Address
}

type Delegations = Record<number, Delegation>

interface WrapRequired {
  type: 'wrap'
  amount: bigint
}

interface ApprovalRequired {
  type: 'approval'
  amount: bigint
  spender: Address
}

type TokenRequirements = {
  [chainId: number]: {
    [tokenAddress: Address]: ApprovalRequired | WrapRequired
  }
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
  settlementLayers?: SettlementLayerFilter
}

interface SplitIntentsResult {
  intents: Record<Address, bigint>[]
}

/**
 * Full intent status as returned by the orchestrator (blanc API version).
 *
 * One operation per chain involved in the intent. The SDK flattens the
 * orchestrator's per-chain `items[]` to a single entry per chain.
 */
interface IntentOpStatus {
  /** High-level intent status. */
  status: IntentStatus
  /** The smart-account address that owns this intent. */
  accountAddress: Address
  /** Per-chain operation status. One entry per chain. */
  operations: ChainOperation[]
}

export type {
  Account,
  AccountType,
  AccountWithContext,
  AuxiliaryFunds,
  TokenConfig,
  SupportedChain,
  SettlementLayer,
  SettlementLayerFilter,
  SignatureMode,
  IntentInput,
  BridgeFill,
  Quote,
  QuoteResponse,
  Cost,
  CostTokenEntry,
  FeeBreakdown,
  Fees,
  Price,
  UsdAmount,
  EstimatedFillTime,
  SignData,
  IntentSubmitRequest,
  IntentSubmitRequestInternal,
  IntentSubmitResponse,
  IntentOpStatus,
  IntentOptions,
  SponsorSettings,
  SignedAuthorization,
  SplitIntentsInput,
  SplitIntentsResult,
  Portfolio,
  PortfolioToken,
  Execution,
  AccountAccessList,
  MappedChainTokenAccessList,
  UnmappedChainTokenAccessList,
  OriginSignature,
  TokenRequirements,
  WrapRequired,
  ApprovalRequired,
  TypedDataDefinition,
  OperationStatus,
  FailureReason,
  ChainOperation,
}
export {
  INTENT_STATUS_PENDING,
  INTENT_STATUS_FAILED,
  INTENT_STATUS_COMPLETED,
  SIG_MODE_EMISSARY,
  SIG_MODE_ERC1271,
  SIG_MODE_EMISSARY_ERC1271,
  SIG_MODE_ERC1271_EMISSARY,
  SIG_MODE_EMISSARY_EXECUTION,
  SIG_MODE_EMISSARY_EXECUTION_ERC1271,
  SIG_MODE_ERC1271_EMISSARY_EXECUTION,
}
