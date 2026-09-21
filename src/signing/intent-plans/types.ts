import type { Hex, TypedDataDefinition } from 'viem'
import type { EvmChainReference } from '../../chains/types'
import type {
  ArtifactAssemblyPlan,
  ConfiguredValidatorTopology,
  EffectiveSignerSelection,
  SignatureUsage,
  SigningBatch,
  SigningPayloadRegistry,
  SigningReadCheckpoint,
  SigningTaskTemplate,
} from '../types'

export type PreparedIntentSignatureMode =
  | 'default'
  | 'session'
  | 'session-with-execution-verification'

export interface IntentSigningPayload {
  readonly id: Hex
  readonly chain: EvmChainReference
  readonly role: 'origin' | 'destination' | 'target'
  readonly typedData: TypedDataDefinition
  readonly usage: SignatureUsage
}

export type DestinationSigningRequirement =
  | {
      readonly mode: 'sign'
      readonly payload: IntentSigningPayload
      readonly artifactId: string
    }
  | {
      readonly mode: 'reuse-origin'
      readonly artifactId: string
      readonly originArtifactId: string
      readonly selection: 'whole' | 'pre-claim'
    }

export interface IntentArtifactRequirement {
  readonly id: string
  readonly usage: SignatureUsage
  readonly payloadId: Hex
  readonly cardinality: 'one' | 'per-origin'
  readonly shape: 'hex' | 'session-claims'
  readonly exposedForIndependentSigning: boolean
}

export interface IntentSigningInput {
  readonly id: Hex
  readonly preparedSignatureMode: PreparedIntentSignatureMode
  readonly configuredTopology: ConfiguredValidatorTopology
  readonly effectiveSelection: EffectiveSignerSelection
  readonly origins: readonly IntentSigningPayload[]
  readonly destination?: DestinationSigningRequirement
  readonly target?: IntentSigningPayload
  readonly artifacts: readonly IntentArtifactRequirement[]
}

export interface IndependentSigningProjection {
  readonly planKind: 'intent-independent'
  readonly sourceIntentId: Hex
  readonly exposedArtifactIds: readonly string[]
  readonly selectedSignerIds: readonly string[]
}

export interface IntentSigningStageInput {
  readonly id: string
  readonly checkpoint: SigningReadCheckpoint
  readonly priorOutputs: readonly {
    readonly stageId: string
    readonly outputId: string
    readonly selection: 'whole' | 'pre-claim'
  }[]
  readonly tasks: readonly SigningTaskTemplate[]
  readonly schedule: readonly SigningBatch[]
  readonly artifacts: readonly Omit<ArtifactAssemblyPlan, 'stageId'>[]
}

export interface IntentSigningPlanCreationInput {
  readonly intent: IntentSigningInput
  readonly stages: readonly IntentSigningStageInput[]
  readonly payloads: SigningPayloadRegistry
}
