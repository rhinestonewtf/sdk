import { type Hex, keccak256, stringToHex } from 'viem'
import type {
  SigningProof,
  SigningRequest,
} from '../../clients/orchestrator/public'
import {
  IncompleteIntentProofsError,
  MismatchedIntentProofError,
} from '../../errors/execution'
import type { IntentSigningRequest } from '../../signing/intent-plans/types'
import type { IndexedProofContribution } from './types'

function canonical(value: unknown): unknown {
  if (typeof value === 'bigint') return { $bigint: value.toString() }
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    )
  }
  return value
}

/**
 * A fingerprint of the whole ordered request set.
 *
 * Binds an externally collected contribution to the exact quote it was made
 * against: a re-quote of the same intent produces different requests, and a
 * proof for slot 2 of the old set is not a proof for slot 2 of the new one.
 * Internal only — it is not a wire id, and it is not evidence the server
 * produced the requests.
 */
export function requestSetId(requests: readonly SigningRequest[]): Hex {
  return keccak256(stringToHex(JSON.stringify(canonical(requests))))
}

/**
 * Merges locally produced proofs with externally collected contributions into
 * the ordered vector the orchestrator expects.
 *
 * Every slot must be filled exactly once. A sparse vector is never returned as
 * a signed transaction.
 */
export function assembleProofVector(input: {
  readonly intentId: string
  readonly requestSetId: Hex
  readonly requests: readonly IntentSigningRequest[]
  /** Proofs the SDK produced itself, keyed by request index. */
  readonly local: ReadonlyMap<number, SigningProof>
  readonly contributions?: readonly IndexedProofContribution[]
}): readonly SigningProof[] {
  const slots = new Map<number, SigningProof>(input.local)
  for (const contribution of input.contributions ?? []) {
    if (contribution.intentId !== input.intentId) {
      throw new MismatchedIntentProofError({
        context: {
          intentIds: [input.intentId, contribution.intentId],
          requestIndex: contribution.requestIndex,
        },
      })
    }
    if (contribution.requestSetId !== input.requestSetId) {
      throw new MismatchedIntentProofError({
        context: {
          intentId: input.intentId,
          requestIndex: contribution.requestIndex,
          reason: 'request-set',
        },
      })
    }
    const request = input.requests[contribution.requestIndex]
    if (!request) {
      throw new MismatchedIntentProofError({
        context: {
          intentId: input.intentId,
          requestIndex: contribution.requestIndex,
          reason: 'out-of-range',
        },
      })
    }
    if (!matchesRequestKind(request, contribution.proof)) {
      throw new MismatchedIntentProofError({
        context: {
          intentId: input.intentId,
          requestIndex: contribution.requestIndex,
          reason: 'kind',
        },
      })
    }
    if (slots.has(contribution.requestIndex)) {
      throw new MismatchedIntentProofError({
        context: {
          intentId: input.intentId,
          requestIndex: contribution.requestIndex,
          reason: 'duplicate',
        },
      })
    }
    slots.set(contribution.requestIndex, contribution.proof)
  }
  const missing = input.requests
    .map(({ index }) => index)
    .filter((index) => !slots.has(index))
  if (missing.length > 0) {
    throw new IncompleteIntentProofsError({
      intentId: input.intentId,
      missing,
    })
  }
  return input.requests.map(({ index }) => slots.get(index)!)
}

function matchesRequestKind(
  request: IntentSigningRequest,
  proof: SigningProof,
): boolean {
  switch (request.kind) {
    case 'eip712':
      return proof.kind === 'eip712'
    case 'eip7702':
      return proof.kind === 'eip7702'
    case 'personalSign':
      return proof.kind === 'personalSign'
    default:
      return false
  }
}
