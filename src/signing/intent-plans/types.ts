import type { Address, Hex, TypedDataDefinition } from 'viem'
import type { EvmChainReference } from '../../chains/types'
import type { SigningRequestPurpose } from '../../clients/orchestrator/public'
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
  readonly typedData: TypedDataDefinition
  readonly usage: SignatureUsage
}

/**
 * Reuse of an earlier slot's signature.
 *
 * Permitted only where the payload, the account and the authority are
 * genuinely identical — a repeated destination payload is still its own
 * authorisation slot, it just happens to be satisfiable by the same bytes.
 * `pre-claim` picks that half out of a session claim pair.
 */
export interface IntentSignatureReuse {
  readonly artifactId: string
  readonly selection: 'whole' | 'pre-claim'
}

/**
 * One quote signing request, classified for local execution.
 *
 * `index` is the request's position in `quote.signingRequests` and is the
 * identity of the authorisation: proofs are submitted in exactly this order,
 * and two requests carrying byte-identical payloads are still two slots.
 */
export type IntentSigningRequest =
  | {
      readonly kind: 'eip712'
      readonly index: number
      readonly purpose: SigningRequestPurpose
      readonly artifactId: string
      readonly signatureFormat: 'secp256k1' | 'account'
      readonly payload: IntentSigningPayload
      readonly shape: 'hex' | 'session-claims'
      readonly reuse?: IntentSignatureReuse
      readonly exposedForIndependentSigning: boolean
    }
  | {
      readonly kind: 'eip7702'
      readonly index: number
      readonly purpose: SigningRequestPurpose
      /** The chain whose nonce and delegation this authorisation names. */
      readonly chainId: number
      readonly contract: Address
    }
  | {
      readonly kind: 'personalSign'
      readonly index: number
      readonly purpose: SigningRequestPurpose
      /** Sign these exact characters. */
      readonly message: string
    }
  | {
      readonly kind: 'unsupported'
      readonly index: number
      readonly purpose: SigningRequestPurpose
      readonly payloadKind: string
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
  /** One per quote signing request, in the quoted order. */
  readonly requests: readonly IntentSigningRequest[]
  readonly artifacts: readonly IntentArtifactRequirement[]
}

/** The EIP-712 requests the local signing plan actually executes. */
export function eip712Requests(
  input: IntentSigningInput,
): readonly Extract<IntentSigningRequest, { kind: 'eip712' }>[] {
  return input.requests.filter(
    (request): request is Extract<IntentSigningRequest, { kind: 'eip712' }> =>
      request.kind === 'eip712',
  )
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
