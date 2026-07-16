import type { Address, Hex } from 'viem'
import type { EvmChainReference, TokenReference } from '../chains/types'

export interface Call {
  readonly target: Address
  readonly value: bigint
  readonly data: Hex
}

export interface SourceFund {
  readonly token: TokenReference
  readonly amount: bigint
}

export interface CallResolveContext<CompatibilityConfig> {
  readonly account: Address
  readonly chain: EvmChainReference
  readonly config: CompatibilityConfig
}

export interface LazyCallInput<CompatibilityConfig> {
  readonly resolve: (
    context: CallResolveContext<CompatibilityConfig>,
  ) => Promise<Call | readonly Call[]>
}

export type UnresolvedCall<CompatibilityConfig> =
  | Call
  | LazyCallInput<CompatibilityConfig>

export interface ResolvedCalls {
  readonly calls: readonly Call[]
  readonly sourceFunds: readonly SourceFund[]
}
