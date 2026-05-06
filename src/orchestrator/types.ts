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
  settlementLayers?: SettlementLayer[]
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
    tokenAddress: Address
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
  protocol: UsdAmount
  swap: UsdAmount
  settlement: UsdAmount
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
  address: Address
  accountType: AccountType
  setupOps: Pick<Execution, 'to' | 'data'>[]
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
  settlementLayers?: SettlementLayer[]
}

interface SplitIntentsResult {
  intents: Record<Address, bigint>[]
}

interface IntentOpStatus {
  status: IntentStatus
  claims: Claim[]
  destinationChainId: number
  accountAddress: Address
  fillTimestamp?: number
  fillTransactionHash?: Hex
}

export type {
  Account,
  AccountType,
  AccountWithContext,
  AuxiliaryFunds,
  TokenConfig,
  SupportedChain,
  SettlementLayer,
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
}
export {
  INTENT_STATUS_PENDING,
  INTENT_STATUS_FAILED,
  INTENT_STATUS_EXPIRED,
  INTENT_STATUS_CLAIMED,
  INTENT_STATUS_COMPLETED,
  INTENT_STATUS_FILLED,
  INTENT_STATUS_PRECONFIRMED,
  SIG_MODE_EMISSARY,
  SIG_MODE_ERC1271,
  SIG_MODE_EMISSARY_ERC1271,
  SIG_MODE_ERC1271_EMISSARY,
  SIG_MODE_EMISSARY_EXECUTION,
  SIG_MODE_EMISSARY_EXECUTION_ERC1271,
  SIG_MODE_ERC1271_EMISSARY_EXECUTION,
}
