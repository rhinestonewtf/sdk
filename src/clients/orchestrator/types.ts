import type {
  Address,
  Hex,
  SignedAuthorization,
  TypedDataDefinition,
} from 'viem'

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
  readonly sponsorSettings?: {
    readonly gas: boolean
    readonly bridgeFees: boolean
    readonly swapFees: boolean
  }
  readonly settlementLayers?:
    | { readonly include: readonly string[] }
    | { readonly exclude: readonly string[] }
  readonly signatureMode?: number
  readonly auxiliaryFunds?: Readonly<
    Record<number, Readonly<Record<Address, bigint>>>
  >
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
  readonly settlementLayer: string
  readonly signData: {
    readonly origin: readonly TypedDataDefinition[]
    readonly destination: TypedDataDefinition
    readonly targetExecution?: TypedDataDefinition
  }
  readonly cost: unknown
  readonly tokenRequirements?: unknown
  readonly bridgeFill?: unknown
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
    readonly destination: Hex
    readonly targetExecution?: Hex
  }
  readonly authorizations?: {
    readonly sponsor?: readonly SignedAuthorization[]
    readonly recipient?: readonly SignedAuthorization[]
  }
  readonly dryRun?: boolean
}

export interface OrchestratorIntentSubmissionContext {
  readonly intentInput: unknown
  readonly sponsored: boolean
}

export interface OrchestratorIntentSubmission {
  readonly traceId: string
  readonly intentId: string
}

export interface OrchestratorIntentStatus {
  readonly traceId: string
  readonly intentId: string
  readonly status: string
  readonly account: Address
  readonly operations: readonly unknown[]
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
