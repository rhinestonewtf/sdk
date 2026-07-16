import type {
  Address,
  AuthorizationRequest,
  Hex,
  SignedAuthorization,
  TypedDataDefinition,
} from 'viem'
import type { AccountSignatureEnvelope } from '../accounts/types'
import type { EvmChainReference } from '../chains/types'
import type { ValidatorContributionCodec } from '../modules/validators/types'

export type SigningPlanKind =
  | 'account-message'
  | 'account-typed-data'
  | 'intent-full'
  | 'intent-independent'
  | 'user-operation'
  | 'session-enable'
  | 'nexus-eip7702-init'
  | 'eip7702-authorization-list'

export type SigningPayloadKind =
  | 'message'
  | 'typed-data'
  | 'intent'
  | 'user-operation'
  | 'session-enable'
  | 'authorization'

export interface SigningPayloadIdentity {
  readonly kind: SigningPayloadKind
  readonly id: Hex
}

export interface SignerReference {
  readonly id: string
  readonly kind: 'ecdsa' | 'webauthn' | 'wallet-authorization'
}

export type SignerInvocation =
  | {
      readonly kind: 'ecdsa-sign-message'
      readonly chain?: EvmChainReference
      readonly message: { readonly raw: Hex }
    }
  | {
      readonly kind: 'ecdsa-sign-typed-data'
      readonly chain?: EvmChainReference
      readonly typedData: TypedDataDefinition
    }
  | {
      readonly kind: 'webauthn-sign-hash'
      readonly hash: Hex
    }
  | {
      readonly kind: 'webauthn-sign-typed-data'
      readonly typedData: TypedDataDefinition
    }
  | {
      readonly kind: 'sign-authorization'
      readonly chain: EvmChainReference
      readonly authorization: AuthorizationRequest
    }

export type RawSignerResult =
  | {
      readonly kind: 'ecdsa-signature'
      readonly signature: Hex
    }
  | {
      readonly kind: 'webauthn-assertion'
      readonly signature: Hex
      readonly authenticatorData: Hex
      readonly clientDataJSON: string
      readonly challengeIndex: number
      readonly typeIndex: number
      readonly userVerificationRequired: boolean
    }
  | {
      readonly kind: 'signed-authorization'
      readonly authorization: SignedAuthorization
    }

export interface SignerInvocationPort {
  readonly invoke: (
    signer: SignerReference,
    invocation: SignerInvocation,
  ) => Promise<RawSignerResult>
}

export type SigningTaskRole =
  | 'owner'
  | 'factor'
  | 'session-notarized'
  | 'session-pre-claim'
  | 'session-target'
  | 'session-enable-owner'
  | 'authorization'

export type SigningPayloadReference =
  | { readonly source: 'plan-payload'; readonly payloadId: Hex }
  | {
      readonly source: 'prior-output'
      readonly stageId: string
      readonly outputId: string
      readonly selection: 'whole' | 'pre-claim'
    }
  | {
      readonly source: 'checkpoint-fact'
      readonly checkpointId: string
      readonly factId: string
    }

export interface SigningTaskTemplate {
  readonly id: string
  readonly signer: SignerReference
  readonly role: SigningTaskRole
  readonly chain?: EvmChainReference
  readonly invocationKind: SignerInvocation['kind']
  readonly payload: SigningPayloadReference
}

export interface SigningTask
  extends Omit<SigningTaskTemplate, 'invocationKind'> {
  readonly invocation: SignerInvocation
}

export interface SigningBatch {
  readonly id: string
  readonly execution: 'serial' | 'parallel'
  readonly taskIds: readonly string[]
}

export type SigningReadCheckpoint =
  | { readonly kind: 'none'; readonly id: string }
  | {
      readonly kind: 'session-enabled'
      readonly id: string
      readonly chain: EvmChainReference
      readonly account: Address
      readonly permissionId: Hex
    }
  | {
      readonly kind: 'account-deployment'
      readonly id: string
      readonly chain: EvmChainReference
      readonly account: Address
    }
  | {
      readonly kind: 'delegation-code'
      readonly id: string
      readonly chain: EvmChainReference
      readonly account: Address
    }

export type SigningRuntimeFact =
  | {
      readonly kind: 'session-enabled'
      readonly id: string
      readonly enabled: boolean
    }
  | {
      readonly kind: 'account-deployed'
      readonly id: string
      readonly deployed: boolean
    }
  | {
      readonly kind: 'delegation-code'
      readonly id: string
      readonly code?: Hex
    }

export interface ConfiguredValidatorTopology {
  readonly rootValidatorId: string
  readonly validators: readonly {
    readonly id: string
    readonly ownerIds: readonly string[]
    readonly threshold: number
  }[]
  readonly threshold: number
}

export interface EffectiveSignerSelection {
  readonly validatorIds: readonly string[]
  readonly signerIds: readonly string[]
  readonly threshold: number
}

export type SignatureUsage =
  | 'erc1271'
  | 'intent-origin'
  | 'intent-destination'
  | 'intent-pre-claim'
  | 'intent-notarized-claim'
  | 'intent-target'
  | 'user-operation'
  | 'session-enable'

export interface ArtifactAssemblyPlan {
  readonly id: string
  readonly stageId: string
  readonly usage: SignatureUsage
  readonly input:
    | { readonly kind: 'task-results'; readonly taskIds: readonly string[] }
    | {
        readonly kind: 'reuse-artifact'
        readonly stageId: string
        readonly artifactId: string
        readonly selection: 'whole' | 'pre-claim'
      }
  readonly validatorCodec:
    | ValidatorContributionCodec
    | { readonly kind: 'none' }
  readonly erc7739:
    | { readonly kind: 'none' }
    | { readonly kind: 'wrap'; readonly domainSeparator: Hex }
  readonly accountEnvelope: AccountSignatureEnvelope
  readonly erc6492:
    | { readonly kind: 'none' }
    | {
        readonly kind: 'wrap-deployless'
        readonly factory: Address
        readonly factoryData: Hex
      }
}

export interface SigningStagePlan {
  readonly id: string
  readonly checkpoint: SigningReadCheckpoint
  readonly priorOutputs: readonly {
    readonly stageId: string
    readonly outputId: string
    readonly selection: 'whole' | 'pre-claim'
  }[]
  readonly taskTemplates: readonly SigningTaskTemplate[]
  readonly schedule: readonly SigningBatch[]
  readonly artifacts: readonly ArtifactAssemblyPlan[]
}

export interface SigningPlan {
  readonly version: 1
  readonly kind: SigningPlanKind
  readonly payload: SigningPayloadIdentity
  readonly configuredTopology: ConfiguredValidatorTopology
  readonly effectiveSelection: EffectiveSignerSelection
  readonly stages: readonly SigningStagePlan[]
  readonly publicOutputs: readonly {
    readonly id: string
    readonly source:
      | { readonly kind: 'artifact'; readonly artifactId: string }
      | { readonly kind: 'task-result'; readonly taskId: string }
    readonly exposedForIndependentSigning: boolean
  }[]
}

export interface MaterializedSigningStage {
  readonly stageId: string
  readonly facts: readonly SigningRuntimeFact[]
  readonly tasks: readonly SigningTask[]
  readonly schedule: readonly SigningBatch[]
}

export interface SigningStageTranscript {
  readonly stage: MaterializedSigningStage
  readonly results: Readonly<Record<string, RawSignerResult>>
  readonly outputs: Readonly<Record<string, Hex>>
}

export interface SigningTranscript {
  readonly planKind: SigningPlanKind
  readonly payloadId: Hex
  readonly stages: readonly SigningStageTranscript[]
}
