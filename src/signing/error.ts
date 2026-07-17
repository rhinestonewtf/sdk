import type { EvmChainReference } from '../chains/types'
import type {
  SignatureUsage,
  SigningPayloadKind,
  SigningPlan,
  SigningPlanKind,
  SigningTaskRole,
} from './types'

export type SigningFailureStage =
  | 'plan'
  | 'read'
  | 'invoke'
  | 'validator-encode'
  | 'account-envelope'
  | 'protocol-operation'
  | 'final-assembly'

export interface SigningErrorContext {
  readonly planKind: SigningPlanKind
  readonly payloadKind: SigningPayloadKind
  readonly failureStage: SigningFailureStage
  readonly stageId?: string
  readonly taskId?: string
  readonly artifactId?: string
  readonly usage?: SignatureUsage
  readonly signerRole?: SigningTaskRole
  readonly chain?: EvmChainReference
}

export class SigningPipelineError extends Error {
  readonly context: SigningErrorContext

  constructor(
    message: string,
    context: SigningErrorContext,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SigningPipelineError'
    this.context = context
  }
}

export class IndependentSigningNotSupportedError extends Error {
  constructor() {
    super(
      'Independent owner signing is only supported for smart accounts using ECDSA, passkey, or multi-factor owners. EOA accounts, smart sessions, and K1/ERC-7739 validators must use the standard `signTransaction` flow.',
    )
  }
}

export function runSigningStep<Result>(input: {
  readonly plan: SigningPlan
  readonly failureStage: SigningFailureStage
  readonly stageId: string
  readonly artifactId: string
  readonly usage: SignatureUsage
  readonly operation: () => Result
}): Result {
  try {
    return input.operation()
  } catch (cause) {
    if (cause instanceof SigningPipelineError) throw cause
    throw new SigningPipelineError(
      `Signing artifact ${input.artifactId} failed during ${input.failureStage}`,
      {
        planKind: input.plan.kind,
        payloadKind: input.plan.payload.kind,
        failureStage: input.failureStage,
        stageId: input.stageId,
        artifactId: input.artifactId,
        usage: input.usage,
      },
      { cause },
    )
  }
}
