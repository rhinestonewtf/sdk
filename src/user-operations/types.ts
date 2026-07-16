import type { Address, Hex } from 'viem'
import type { Call } from '../calls/types'
import type { EvmChainReference } from '../chains/types'
import type { SigningPlan } from '../signing/types'

export interface UserOperationInput {
  readonly chain: EvmChainReference
  readonly sender: Address
  readonly calls: readonly Call[]
  readonly nonceKey?: bigint
}

export interface PreparedUserOperation {
  readonly input: UserOperationInput
  readonly nonce: bigint
  readonly fields: Readonly<Record<string, unknown>>
  readonly signingPlan: SigningPlan
}

export interface SignedUserOperation extends PreparedUserOperation {
  readonly signature: Hex
}

export interface SubmittedUserOperation {
  readonly chain: EvmChainReference
  readonly hash: Hex
}

export interface UserOperationStatus {
  readonly hash: Hex
  readonly receipt?: unknown
  readonly terminal: boolean
}
