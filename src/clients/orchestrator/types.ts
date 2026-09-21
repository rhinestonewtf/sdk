import type { Address, Hex } from 'viem'
import type {
  BridgeFill,
  Caip2ChainId,
  Cost,
  HyperCoreAction,
  IntentAccountSummary,
  IntentDetails,
  IntentOperationGroup,
  IntentRefund,
  IntentRequirement,
  IntentStatus,
  QuotePlan,
  SerializedIntentInput,
  SettlementLayer,
  SigningProof,
  SigningRequest,
  SwigAuthority,
} from './public'

export interface OrchestratorExecution {
  readonly to: Address
  readonly value: bigint
  readonly data: Hex
}

/** EIP-7702 delegations, either chain-agnostic or per CAIP-2 chain. */
export interface OrchestratorDelegations {
  readonly default?: { readonly contract: Address }
  readonly chains?: Readonly<
    Record<Caip2ChainId, { readonly contract: Address }>
  >
}

export interface OrchestratorAccountSimulation {
  readonly mockSignature?: Hex
  readonly mockSignaturesByChain?: Readonly<Record<Caip2ChainId, Hex>>
}

export interface OrchestratorEvmEoaAccount {
  readonly type: 'eoa'
  readonly address: Address
  readonly signatureMode?: number
  readonly delegations?: OrchestratorDelegations
}

export interface OrchestratorEvmSmartAccount {
  readonly type: 'erc7579'
  readonly address: Address
  readonly initData?: {
    readonly setupOps: readonly Pick<OrchestratorExecution, 'to' | 'data'>[]
  }
  readonly signatureMode?: number
  readonly delegations?: OrchestratorDelegations
  readonly simulation?: OrchestratorAccountSimulation
}

export type OrchestratorEvmAccount =
  | OrchestratorEvmEoaAccount
  | OrchestratorEvmSmartAccount

/**
 * A Swig the account already controls. Caucasus takes no Swig `initData`: an
 * account that has none is a refusal, not a deployment request (RHI-7360).
 */
export interface OrchestratorSvmAccount {
  readonly type: 'swig'
  /** The asset-holding Swig wallet, not the Swig state account. */
  readonly address: string
  readonly authorization: SwigAuthority
}

export interface OrchestratorIntentAccount {
  readonly evm?: OrchestratorEvmAccount
  readonly svm?: OrchestratorSvmAccount
}

/**
 * A destination recipient. A bare `{ address }` is a payee that cannot
 * authorize execution; the configured variants keep the capability the account
 * entry describes.
 */
export type OrchestratorEvmRecipient =
  | { readonly address: Address }
  | {
      readonly type: 'eoa'
      readonly address: Address
      readonly delegations?: OrchestratorDelegations
    }
  | {
      readonly type: 'erc7579'
      readonly address: Address
      readonly initData?: {
        readonly setupOps: readonly Pick<OrchestratorExecution, 'to' | 'data'>[]
      }
      readonly delegations?: OrchestratorDelegations
      readonly simulation?: OrchestratorAccountSimulation
    }

export interface OrchestratorTokenRequest {
  readonly tokenAddress: Address | string
  readonly amount?: bigint
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

export interface OrchestratorEvmDestinationExecution {
  readonly calls: readonly OrchestratorExecution[]
  readonly gasLimit?: bigint
  readonly executionTokensReceived?: readonly Address[]
}

export type OrchestratorDestination =
  | {
      readonly vm: 'evm'
      readonly chainId: Caip2ChainId
      readonly recipient?: OrchestratorEvmRecipient
      readonly tokenRequests: readonly OrchestratorTokenRequest[]
      readonly execution?: OrchestratorEvmDestinationExecution
    }
  | {
      readonly vm: 'svm'
      readonly chainId: Caip2ChainId
      readonly recipient?: { readonly address: string }
      readonly tokenRequests: readonly OrchestratorTokenRequest[]
      readonly execution?: {
        readonly instructions: readonly OrchestratorSolanaInstruction[]
        readonly addressLookupTables?: readonly string[]
      }
    }
  | {
      readonly vm: 'tvm' | 'stellar'
      readonly chainId: Caip2ChainId
      readonly recipient: { readonly address: string }
      readonly tokenRequests: readonly OrchestratorTokenRequest[]
    }
  | {
      readonly vm: 'hypercore'
      readonly chainId: Caip2ChainId
      readonly recipient?: OrchestratorEvmRecipient
      readonly tokenRequests: readonly OrchestratorTokenRequest[]
      readonly execution?: {
        readonly actions?: readonly HyperCoreAction[]
        readonly settlement?: OrchestratorEvmDestinationExecution
      }
    }

export type OrchestratorChainSelector =
  | 'all'
  | { readonly only: readonly Caip2ChainId[] }
  | { readonly except: readonly Caip2ChainId[] }

export type OrchestratorTokenSelector = 'all' | OrchestratorTokenRestriction

export type OrchestratorTokenRestriction =
  | { readonly only: readonly string[] }
  | { readonly except: readonly string[] }

export interface OrchestratorSourceSelection {
  readonly chains: OrchestratorChainSelector
  readonly tokens: OrchestratorTokenSelector
  /** Narrowing only: a per-chain entry always restricts, so it has no `'all'`. */
  readonly perChain?: Readonly<
    Record<Caip2ChainId, { readonly tokens: OrchestratorTokenRestriction }>
  >
}

export interface OrchestratorSourceLimit {
  readonly chainId: Caip2ChainId
  readonly tokenAddress: string
  readonly maxAmount: bigint
}

export interface OrchestratorSource {
  readonly selection?: OrchestratorSourceSelection
  readonly limits?: readonly OrchestratorSourceLimit[]
  readonly auxiliaryFunds?: Readonly<
    Record<Caip2ChainId, Readonly<Record<string, bigint>>>
  >
  readonly executions?: readonly {
    readonly vm: 'evm'
    readonly chainId: Caip2ChainId
    readonly calls: readonly OrchestratorExecution[]
  }[]
}

export interface OrchestratorSponsorship {
  readonly gas?: boolean
  readonly bridgeFees?: boolean
  readonly swapFees?: boolean
  readonly swapValue?: boolean
  readonly protocolFees?: boolean
}

export interface OrchestratorIntentOptions {
  readonly appFees?: { readonly feeBps: number }
  readonly protocolFees?: { readonly feeBps: number }
  readonly customDeadline?: number
  readonly sponsorship?: OrchestratorSponsorship
  readonly settlementLayers?:
    | { readonly include: readonly string[] }
    | { readonly exclude: readonly string[] }
  readonly quoters?:
    | { readonly include: readonly string[] }
    | { readonly exclude: readonly string[] }
  readonly selectionStrategy?: 'cheapest' | 'fastest' | 'best'
}

export interface OrchestratorIntentRequest {
  readonly account: OrchestratorIntentAccount
  readonly destination: OrchestratorDestination
  readonly source?: OrchestratorSource
  readonly options?: OrchestratorIntentOptions
}

export interface OrchestratorQuote {
  readonly intentId: string
  readonly purpose: 'execution'
  readonly expiresAt: number
  readonly estimatedFillTime: { readonly seconds: number }
  readonly settlementLayer: SettlementLayer
  readonly plan: QuotePlan
  readonly cost: Cost
  readonly requirements: readonly IntentRequirement[]
  readonly signingRequests: readonly SigningRequest[]
  readonly bridgeFill?: BridgeFill
}

export interface OrchestratorQuoteResponse {
  readonly traceId: string
  readonly routes: readonly OrchestratorQuote[]
}

export interface OrchestratorSignedIntent {
  readonly intentId: string
  /** One proof per signing request, in the quoted order. */
  readonly proofs: readonly SigningProof[]
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
  readonly purpose: 'execution'
  readonly status: IntentStatus
  readonly accounts?: readonly IntentAccountSummary[]
  readonly operations: readonly IntentOperationGroup[]
  readonly refunds?: readonly IntentRefund[]
  readonly details?: IntentDetails
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
