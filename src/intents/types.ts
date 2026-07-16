import type { Address, Hex } from 'viem'
import type { Call, SourceFund } from '../calls/types'
import type { ChainReference } from '../chains/types'
import type { IntentSigningInput } from '../signing/intent-plans/types'

export interface IntentInput {
  readonly account: Address
  readonly destination: ChainReference
  readonly calls: readonly Call[]
  readonly sourceFunds: readonly SourceFund[]
}

export interface PreparedIntent {
  readonly traceId: string
  readonly intentId: string
  readonly input: IntentInput
  readonly signing: IntentSigningInput
}

export interface SignedIntent {
  readonly prepared: PreparedIntent
  readonly originSignatures: readonly Hex[]
  readonly destinationSignature?: Hex
  readonly targetSignature?: Hex
}

export interface SubmittedIntent {
  readonly traceId: string
  readonly intentId: string
}

export interface IntentStatus {
  readonly intentId: string
  readonly status: string
  readonly terminal: boolean
}
