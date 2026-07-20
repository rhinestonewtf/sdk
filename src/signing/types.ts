import type {
  Account,
  Address,
  AuthorizationRequest,
  Hex,
  SignedAuthorization,
  TypedDataDefinition,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { AccountSignatureEnvelope } from '../accounts/types'
import type { EvmChainReference } from '../chains/types'
import type { ValidatorContributionCodec } from '../modules/validators/types'

export type PlannedValidatorContributionCodec =
  | ValidatorContributionCodec
  | {
      readonly kind: 'smart-session-state'
      readonly factId: string
      readonly whenEnabled: Extract<
        ValidatorContributionCodec,
        { readonly kind: 'smart-session' }
      >
      readonly whenDisabled: Extract<
        ValidatorContributionCodec,
        { readonly kind: 'smart-session' }
      >
    }

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

export type SigningArtifact =
  | Hex
  | SignedAuthorization
  | {
      readonly preClaimSig: Hex
      readonly notarizedClaimSig: Hex
    }

export type SigningPayloadMaterial =
  | {
      readonly kind: 'message'
      readonly message: { readonly raw: Hex }
    }
  | {
      readonly kind: 'typed-data'
      readonly typedData: TypedDataDefinition
    }
  | {
      readonly kind: 'authorization'
      readonly authorization: AuthorizationRequest
    }

export type SigningPayloadRegistry = Readonly<
  Record<Hex, SigningPayloadMaterial>
>

export interface SignerInvocationPort {
  readonly has?: (signer: SignerReference) => boolean
  readonly invoke: (
    signer: SignerReference,
    invocation: SignerInvocation,
  ) => Promise<RawSignerResult>
}

export interface SigningCheckpointPort {
  readonly read: (
    checkpoint: Exclude<SigningReadCheckpoint, { readonly kind: 'none' }>,
  ) => Promise<readonly SigningRuntimeFact[]>
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
  readonly when?: {
    readonly kind: 'delegation-required'
    readonly factId: string
    readonly contract: Address
  }
  readonly contribution?:
    | {
        readonly kind: 'ecdsa'
        readonly ownerId: string
        readonly encoding: 'raw-signer' | 'validator-contribution'
        readonly factorId?: string
      }
    | {
        readonly kind: 'webauthn'
        readonly ownerId: string
        readonly publicKey: Hex
        readonly factorId?: string
      }
    | {
        readonly kind: 'session'
        readonly recoveryEncoding: 'ethereum' | 'validator-offset-4'
      }
    | { readonly kind: 'authorization' }
}

export type PayloadSigningTask = Omit<SigningTaskTemplate, 'chain' | 'payload'>

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
    | {
        readonly kind: 'session-claim-pair'
        readonly preClaimArtifactId: string
        readonly notarizedClaimArtifactId: string
      }
  readonly validatorCodec:
    | PlannedValidatorContributionCodec
    | { readonly kind: 'none' }
  readonly validatorFactors?: readonly {
    readonly id: string
    readonly publicId: number | Hex
    readonly validator: Address
    readonly codec: Extract<
      ValidatorContributionCodec,
      { readonly kind: 'ordered-threshold' }
    >
  }[]
  readonly erc7739:
    | { readonly kind: 'none' }
    | {
        readonly kind: 'wrap-typed-data'
        readonly typedData: TypedDataDefinition
      }
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
  readonly preparedIntent?: {
    readonly signatureMode:
      | 'default'
      | 'session'
      | 'session-with-execution-verification'
    readonly artifacts: readonly {
      readonly id: string
      readonly usage: SignatureUsage
      readonly payloadId: Hex
      readonly cardinality: 'one' | 'per-origin'
      readonly shape: 'hex' | 'session-claims'
    }[]
    readonly destination?:
      | {
          readonly mode: 'sign'
          readonly artifactId: string
          readonly payloadId: Hex
        }
      | {
          readonly mode: 'reuse-origin'
          readonly artifactId: string
          readonly originArtifactId: string
          readonly selection: 'whole' | 'pre-claim'
        }
    readonly target?: {
      readonly artifactId: string
      readonly payloadId: Hex
    }
  }
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
  readonly outputs: Readonly<Record<string, SigningArtifact>>
}

export interface SigningTranscript {
  readonly planKind: SigningPlanKind
  readonly payloadId: Hex
  readonly stages: readonly SigningStageTranscript[]
}

// Public owner-signature types relocated verbatim from the legacy
// `src/execution/utils.ts` so the published surface owns them.
export interface OwnerPasskeySignature {
  webauthn: {
    authenticatorData: Hex
    challengeIndex?: number
    clientDataJSON: string
    typeIndex?: number
    userVerificationRequired?: boolean
  }
  signature: Hex
}

export type OwnerSignatureData =
  | {
      kind: 'ecdsa'
      signer: Address
      origin: Hex[]
    }
  | {
      kind: 'passkey'
      publicKey: Hex
      origin: OwnerPasskeySignature[]
    }

export type OwnerSignature =
  | ({ intentId: string } & OwnerSignatureData)
  | {
      intentId: string
      kind: 'multi-factor'
      validatorId: number | Hex
      signature: OwnerSignatureData
    }

export interface SignAsOwnerOptions {
  /** Account that contributes this signature. Must belong to the configured owner set. */
  owner: Account | WebAuthnAccount
  /** Multi-factor validator ID containing `owner`. Required only for multi-factor accounts. */
  validatorId?: number | Hex
  /** Quote to sign. Defaults to `preparedTransaction.quotes.best`. */
  intentId?: string
}
