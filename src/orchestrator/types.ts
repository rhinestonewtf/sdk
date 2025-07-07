import type { Address, Hex } from 'viem'
import { UserOperationReceipt } from 'viem/account-abstraction'
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
  zksync,
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
  | typeof zksync.id
type SupportedOPStackMainnet = typeof optimism.id | typeof base.id
type SupportedOPStackTestnet = typeof optimismSepolia.id | typeof baseSepolia.id
type SupportedChain = SupportedMainnet | SupportedTestnet
type SupportedTokenSymbol = 'ETH' | 'WETH' | 'USDC' | 'USDT'
type SupportedToken = SupportedTokenSymbol | Address

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
  value: bigint
  data: Hex
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

interface IntentInput {
  account: Address
  destinationChainId: number
  destinationExecutions: Execution[]
  destinationGasUnits?: bigint
  tokenTransfers: {
    tokenAddress: Address
    amount?: bigint
  }[]
  accountAccessList?: AccountAccessList
  smartAccount: {
    accountType: 'ERC7579'
  }
}

type SettlementSystem = 'SAME_CHAIN' | 'ACROSS'

interface IntentCost {
  hasFulfilledAll: boolean
  tokensReceived: [
    {
      tokenAddress: Address
      hasFulfilled: boolean
      amountSpent: bigint
      destinationAmount: bigint
      fee: bigint
    },
  ]
  tokensSpent: {
    [chainId: number]: {
      [tokenAddress: Address]: {
        locked: string
        unlocked: string
      }
    }
  }
}

interface IntentOp {
  sponsor: Address
  nonce: string
  expires: string
  elements: {
    arbiter: Address
    chainId: string
    idsAndAmounts: [[string, string]]
    beforeFill: boolean
    smartAccountStatus: 'ERC7579'
    mandate: {
      recipient: Address
      tokenOut: [[string, string]]
      destinationChainId: string
      fillDeadline: string
      destinationOps: {
        to: Address
        value: string
        data: Hex
      }[]
      preClaimOps: []
      qualifier: {
        settlementSystem: SettlementSystem
        encodedVal: Hex
      }
    }
  }[]
  serverSignature: string
  signedMetadata: {
    quotes: unknown
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
  }
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

interface ParsedIntentOp {
  sponsor: Address
  nonce: bigint
  expires: bigint
  elements: {
    arbiter: Address
    chainId: bigint
    idsAndAmounts: [[bigint, bigint]]
    beforeFill: boolean
    smartAccountStatus: unknown
    mandate: {
      recipient: Address
      tokenOut: [[bigint, bigint]]
      destinationChainId: bigint
      fillDeadline: string
      destinationOps: {
        to: Address
        value: bigint
        data: Hex
      }[]
      preClaimOps: []
      qualifier: {
        settlementSystem: SettlementSystem
        encodedVal: Hex
      }
    }
  }[]
  serverSignature: string
  signedMetadata: {
    quotes: unknown
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
  }
}

type SignedIntentOp = ParsedIntentOp & {
  originSignatures: Hex[]
  destinationSignature: Hex
}

interface TokenConfig {
  symbol: string
  address: Address
  decimals: number
  balanceSlot: (address: Address) => Hex
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
  type: 'intent'
  status: IntentStatus
  fillTimestamp?: number
  fillTransactionHash?: Hex
  claims: Claim[]
}

interface UserOpStatus {
  type: 'userop'
  receipt: UserOperationReceipt
}

export type {
  TokenConfig,
  SupportedChain,
  UserTokenBalance,
  SettlementSystem,
  IntentInput,
  IntentCost,
  IntentRoute,
  IntentOp,
  ParsedIntentOp,
  SignedIntentOp,
  IntentOpStatus,
  UserOpStatus,
  IntentResult,
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
