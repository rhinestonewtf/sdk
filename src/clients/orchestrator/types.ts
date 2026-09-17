import type {
  Address,
  Hex,
  SignedAuthorization,
  TypedDataDefinition,
} from 'viem'
import type {
  BridgeFill,
  ChainOperation,
  Cost,
  HyperCoreAction,
  IntentHyperCoreResult,
  IntentRefund,
  IntentStatus,
  OriginSignData,
  SerializedIntentInput,
  SettlementLayer,
  TokenRequirements,
} from './public'

export interface OrchestratorExecution {
  readonly to: Address
  readonly value: bigint
  readonly data: Hex
}

export interface OrchestratorAccount {
  readonly address: Address | string
  readonly accountType?: 'GENERIC' | 'ERC7579' | 'EOA'
  readonly setupOps?: readonly Pick<OrchestratorExecution, 'to' | 'data'>[]
  readonly delegations?: Readonly<
    Record<number, { readonly contract: Address }>
  >
  readonly mockSignatures?: Readonly<Record<`${number}`, Hex>>
}

export interface OrchestratorAccountAccessList {
  readonly chainIds?: readonly number[]
  readonly tokens?: readonly (Address | string)[]
  readonly chainTokens?: Readonly<Record<number, readonly (Address | string)[]>>
  readonly chainTokenAmounts?: Readonly<
    Record<number, Readonly<Record<Address, bigint>>>
  >
}

export interface OrchestratorIntentOptions {
  readonly appFees?: { readonly feeBps: number }
  readonly protocolFees?: { readonly feeBps: number }
  readonly customDeadline?: number
  readonly sponsorSettings?: {
    readonly gas: boolean
    readonly bridgeFees: boolean
    readonly swapFees: boolean
    readonly protocolFees?: boolean
    /**
     * Par same-chain swaps: the sponsor pays the market shortfall so the user
     * trades 1:1. Sent only when explicitly requested.
     */
    readonly swapValue?: boolean
  }
  readonly settlementLayers?:
    | { readonly include: readonly string[] }
    | { readonly exclude: readonly string[] }
  /** Restricts which swap venues may serve this intent's swaps. */
  readonly quoters?:
    | { readonly include: readonly string[] }
    | { readonly exclude: readonly string[] }
  readonly signatureMode?: number
  readonly auxiliaryFunds?: Readonly<
    Record<number, Readonly<Record<Address, bigint>>>
  >
  /** A Hyperliquid L1 action to authorise alongside this intent. */
  readonly hyperCore?: { readonly action: HyperCoreAction }
}

export interface OrchestratorSolanaInstruction {
  readonly programId: string
  readonly accounts: readonly {
    readonly pubkey: string
    readonly isSigner: boolean
    readonly isWritable: boolean
  }[]
  readonly data: string
}

export interface OrchestratorIntentRequest {
  readonly account: OrchestratorAccount
  readonly destinationChainId: number
  readonly destinationExecutions: readonly OrchestratorExecution[]
  readonly destinationGasUnits?: bigint
  readonly tokenRequests: readonly {
    readonly tokenAddress: Address | string
    readonly amount?: bigint
  }[]
  readonly recipient?: OrchestratorAccount
  /** Solana instructions run out of the account's own wallet on a Solana destination. */
  readonly destinationInstructions?: readonly OrchestratorSolanaInstruction[]
  /** Address lookup tables the `destinationInstructions` resolve accounts through, base58. */
  readonly addressLookupTableAddresses?: readonly string[]
  readonly accountAccessList?: OrchestratorAccountAccessList
  readonly options: OrchestratorIntentOptions
  readonly preClaimExecutions?: Readonly<
    Record<number, readonly OrchestratorExecution[]>
  >
}

export interface OrchestratorQuote {
  readonly intentId: string
  readonly expiresAt: number
  readonly estimatedFillTime: { readonly seconds: number }
  readonly settlementLayer: SettlementLayer
  readonly signData: {
    readonly origin: readonly OriginSignData[]
    readonly destination?: TypedDataDefinition
    readonly targetExecution?: TypedDataDefinition
  }
  readonly cost: Cost
  readonly tokenRequirements?: TokenRequirements
  readonly bridgeFill?: BridgeFill
}

export interface OrchestratorQuoteResponse {
  readonly traceId: string
  readonly routes: readonly OrchestratorQuote[]
}

export type OrchestratorOriginSignature =
  | Hex
  | { readonly preClaimSig: Hex; readonly notarizedClaimSig: Hex }

export interface OrchestratorSignedIntent {
  readonly intentId: string
  readonly signatures: {
    readonly origin: readonly OrchestratorOriginSignature[]
    readonly destination?: Hex
    readonly targetExecution?: Hex
  }
  readonly authorizations?: {
    readonly sponsor?: readonly SignedAuthorization[]
    readonly recipient?: readonly SignedAuthorization[]
  }
  readonly dryRun?: boolean
}

export interface OrchestratorIntentSubmissionContext {
  readonly intentInput: SerializedIntentInput
  readonly sponsored: boolean
}

export interface OrchestratorIntentSubmission {
  readonly traceId: string
  readonly intentId: string
}

export interface OrchestratorIntentStatus {
  readonly traceId: string
  readonly intentId: string
  readonly status: IntentStatus
  readonly account: Address
  readonly operations: readonly ChainOperation[]
  readonly refunds?: readonly IntentRefund[]
  readonly hyperCore?: IntentHyperCoreResult
}

export interface OrchestratorPortfolioRequest {
  readonly account: Address
  readonly chainIds?: readonly number[]
  readonly tokens?: Readonly<Record<number, readonly Address[]>>
}

export interface OrchestratorPortfolio {
  readonly tokens: readonly {
    readonly symbol: string
    readonly chains: readonly {
      readonly chain: number
      readonly address: Address
      readonly decimals: number
      readonly amount: bigint
    }[]
  }[]
}

export interface OrchestratorAppFeeBalances {
  readonly withdrawableUsd: number
  readonly pendingUsd: number
}

export interface OrchestratorSplitRequest {
  readonly chainId: number
  readonly tokens: Readonly<Record<Address, bigint>>
  readonly settlementLayers?:
    | { readonly include: readonly string[] }
    | { readonly exclude: readonly string[] }
}

export interface OrchestratorSplitResult {
  readonly traceId: string
  readonly intents: readonly Readonly<Record<Address, bigint>>[]
}
