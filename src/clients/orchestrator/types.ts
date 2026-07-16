import type { Address, Hex, TypedDataDefinition } from 'viem'
import type { Call, SourceFund } from '../../calls/types'
import type { ChainReference, EvmChainReference } from '../../chains/types'

export interface OrchestratorIntentRequest {
  readonly account: Address
  readonly destination: ChainReference
  readonly calls: readonly Call[]
  readonly sourceFunds: readonly SourceFund[]
  readonly signatureMode: string
}

export interface OrchestratorQuote {
  readonly intentId: string
  readonly origins: readonly {
    readonly chain: EvmChainReference
    readonly payload: TypedDataDefinition
  }[]
  readonly destination?: {
    readonly chain: EvmChainReference
    readonly payload: TypedDataDefinition
  }
  readonly target?: {
    readonly chain: EvmChainReference
    readonly payload: TypedDataDefinition
  }
}

export interface OrchestratorQuoteResponse {
  readonly traceId: string
  readonly best: OrchestratorQuote
  readonly all: readonly OrchestratorQuote[]
}

export interface OrchestratorSignedIntent {
  readonly intentId: string
  readonly originSignatures: readonly Hex[]
  readonly destinationSignature?: Hex
  readonly targetSignature?: Hex
  readonly authorizations: readonly unknown[]
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
  readonly tokens: readonly unknown[]
}

export interface OrchestratorAppFeeBalances {
  readonly withdrawableUsd: number
  readonly pendingUsd: number
}

export interface OrchestratorSplitRequest {
  readonly chain: EvmChainReference
  readonly tokens: Readonly<Record<Address, bigint>>
  readonly settlementLayers?: readonly string[]
}

export interface OrchestratorSplitResult {
  readonly traceId: string
  readonly intents: readonly Readonly<Record<Address, bigint>>[]
}
