import type { Hex } from 'viem'
import type { AccountRuntimePort } from '../../accounts/adapter'
import type { UnresolvedCall } from '../../calls/types'
import type { EvmChainReference } from '../../chains/types'
import type {
  BundlerPort,
  BundlerUserOperation,
} from '../../clients/bundler/port'
import type { PaymasterPort } from '../../clients/paymaster/port'
import type { RpcPort } from '../../clients/rpc/port'
import type {
  SignerInvocationPort,
  SigningCheckpointPort,
  SigningTranscript,
} from '../../signing/types'
import type { UserOperationSigningPlanInput } from '../../signing/user-operation'

export interface UserOperationInput<CompatibilityConfig = unknown> {
  readonly chain: EvmChainReference
  readonly calls: readonly UnresolvedCall<CompatibilityConfig>[]
  readonly nonceKey?: bigint
  readonly gasLimit?: bigint
}

export interface PreparedUserOperation<CompatibilityConfig = unknown> {
  readonly input: UserOperationInput<CompatibilityConfig>
  readonly operation: BundlerUserOperation
  readonly hash: Hex
  readonly signing: UserOperationSigningPlanInput
}

export interface SignedUserOperation<CompatibilityConfig = unknown> {
  readonly prepared: PreparedUserOperation<CompatibilityConfig>
  readonly operation: BundlerUserOperation
  readonly signature: Hex
  readonly transcript: SigningTranscript
}

export interface SubmittedUserOperation {
  readonly type: 'userop'
  readonly chain: EvmChainReference
  readonly hash: Hex
}

export interface UserOperationStatus {
  readonly hash: Hex
  readonly receipt?: unknown
  readonly terminal: boolean
}

export interface UserOperationWorkflowContext<CompatibilityConfig = unknown> {
  readonly compatibilityConfig: CompatibilityConfig
  readonly account: AccountRuntimePort
  readonly rpc: RpcPort
  readonly bundler: BundlerPort
  readonly paymaster?: PaymasterPort
  readonly signerInvoker: SignerInvocationPort
  readonly checkpoints: SigningCheckpointPort
  readonly clock: {
    readonly sleep: (milliseconds: number) => Promise<void>
  }
}
