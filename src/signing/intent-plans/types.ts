import type { Hex, TypedDataDefinition } from 'viem'
import type { EvmChainReference } from '../../chains/types'
import type {
  ConfiguredValidatorTopology,
  EffectiveSignerSelection,
  SignatureUsage,
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
