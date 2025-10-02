import type {
  SettlementLayer as CrossChainSettlementLayer,
  SupportedChain,
  SupportedMainnet,
  SupportedOPStackMainnet,
  SupportedOPStackTestnet,
  SupportedTestnet,
} from '@rhinestone/shared-configs'
import type { Address, Hex } from 'viem'

type SupportedTokenSymbol = 'ETH' | 'WETH' | 'USDC' | 'USDT'
type SupportedToken = SupportedTokenSymbol | Address

type AccountType = 'GENERIC' | 'ERC7579' | 'EOA'

const INTENT_STATUS_PENDING = 'PENDING'
const INTENT_STATUS_FAILED = 'FAILED'
const INTENT_STATUS_EXPIRED = 'EXPIRED'
const INTENT_STATUS_PARTIALLY_COMPLETED = 'PARTIALLY_COMPLETED'
const INTENT_STATUS_COMPLETED = 'COMPLETED'
const INTENT_STATUS_FILLED = 'FILLED'
const INTENT_STATUS_PRECONFIRMED = 'PRECONFIRMED'
const INTENT_STATUS_UNKNOWN = 'UNKNOWN'

type IntentStatus =
  | typeof INTENT_STATUS_PENDING
  | typeof INTENT_STATUS_EXPIRED
  | typeof INTENT_STATUS_PARTIALLY_COMPLETED
  | typeof INTENT_STATUS_COMPLETED
  | typeof INTENT_STATUS_FILLED
  | typeof INTENT_STATUS_PRECONFIRMED
  | typeof INTENT_STATUS_FAILED
  | typeof INTENT_STATUS_UNKNOWN

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
  value: string
  data: Hex
}

type SettlementLayer = 'SAME_CHAIN' | CrossChainSettlementLayer

interface IntentOptions {
  topupCompact: boolean
  feeToken?: Address | SupportedTokenSymbol
  sponsorSettings?: SponsorSettings
  settlementLayers?: SettlementLayer[]
}

interface SponsorSettings {
  gasSponsored: boolean
  bridgeFeesSponsored: boolean
  swapFeesSponsored: boolean
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
  account: {
    address: Address
    accountType: AccountType
    setupOps: {
      to: Address
      data: Hex
    }[]
    delegations?: Record<
      number,
      {
        contract: Address
      }
    >
  }
  destinationChainId: number
  destinationExecutions: Execution[]
  destinationGasUnits?: bigint
  tokenTransfers: {
    tokenAddress: Address
    amount?: bigint
  }[]
  accountAccessList?: AccountAccessList
  options: IntentOptions
}

interface IntentCost {
  hasFulfilledAll: boolean
  tokensReceived: [
    {
      tokenAddress: Address
      hasFulfilled: boolean
      amountSpent: string
      destinationAmount: string
      fee: string
    },
  ]
  sponsorFee: {
    relayer: number
    protocol: number
  }
  tokensSpent: {
    [chainId: string]: {
      [tokenAddress: Address]: {
        locked: string
        unlocked: string
        version: number
      }
    }
  }
}

interface IntentOpElementMandate {
  recipient: Address
  tokenOut: [[string, string]]
  destinationChainId: string
  fillDeadline: string
  destinationOps: Execution[]
  preClaimOps: Execution[]
  qualifier: {
    settlementContext: {
      settlementLayer: SettlementLayer
      usingJIT: boolean
      using7579: boolean
    }
    encodedVal: Hex
  }
  v: number
  minGas: string
}

interface IntentOpElement {
  arbiter: Address
  chainId: string
  idsAndAmounts: [[string, string]]
  spendTokens: [[string, string]]
  beforeFill: boolean
  smartAccountStatus: AccountContext
  mandate: IntentOpElementMandate
}

interface IntentOp {
  sponsor: Address
  nonce: string
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
  }
}

interface AccountContext {
  accountType: 'smartAccount'
  isDeployed: boolean
  isERC7579: boolean
  erc7579AccountType: string
  erc7579AccountVersion: string
}

interface Account {
  address: Address
  accountType: AccountType
  setupOps: Pick<Execution, 'to' | 'data'>[]
  delegations?: Delegations
  emissaryConfig?: EmissarySetupConfig
}

type AccountWithContext = Omit<Account, 'delegations'> & {
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
interface IntentRoute {
  intentOp: IntentOp
  intentCost: IntentCost
}

interface IntentResult {
  result: {
    id: string
    status: IntentStatus
  }
}

type SignedIntentOp = IntentOp & {
  originSignatures: Hex[]
  destinationSignature: Hex
  signedAuthorizations?: readonly {
    chainId: number
    address: Address
    nonce: number
    yParity: number
    r: Hex
    s: Hex
  }[]
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

interface IntentOpStatus {
  status: IntentStatus
  claims: Claim[]
  destinationChainId: number
  userAddress: Address
  fillTimestamp?: number
  fillTransactionHash?: Hex
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
  TokenConfig,
  SupportedChain,
  SettlementLayer,
  IntentInput,
  IntentCost,
  IntentRoute,
  IntentOp,
  IntentOpElement,
  IntentOpElementMandate,
  SignedIntentOp,
  IntentOpStatus,
  IntentResult,
  PortfolioTokenResponse,
  PortfolioResponse,
  Portfolio,
  PortfolioToken,
  MappedChainTokenAccessList,
  UnmappedChainTokenAccessList,
}
export {
  INTENT_STATUS_PENDING,
  INTENT_STATUS_FAILED,
  INTENT_STATUS_EXPIRED,
  INTENT_STATUS_PARTIALLY_COMPLETED,
  INTENT_STATUS_COMPLETED,
  INTENT_STATUS_FILLED,
  INTENT_STATUS_PRECONFIRMED,
  INTENT_STATUS_UNKNOWN,
}
