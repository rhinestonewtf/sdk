import type { OrchestratorIntentRequest } from '../../clients/orchestrator/types'
import { InvalidPreparedTransactionError } from '../../errors/execution'

/**
 * Serializes a quote's signing payloads for the public prepared data.
 *
 * Typed-data messages are normalized to bigints for hashing; the persisted form
 * has to survive `JSON.stringify`, so they go back to decimal strings here and
 * `normalizeIntentQuote` restores them on the way in. Cost and requirement
 * amounts stay bigint — that is their published type.
 */
export function projectCompatibleQuote<
  Quote extends { signingRequests: unknown },
>(quote: Quote): Quote {
  return {
    ...quote,
    signingRequests: serializeBigInts(quote.signingRequests),
  } as Quote
}

/** The wire generation a persisted request was built for. */
export const PREPARED_REQUEST_VERSION = 'caucasus-1' as const

/**
 * The prepared Caucasus request, persisted alongside the public transaction.
 *
 * Versioned so a prepared payload from an earlier wire generation fails
 * explicitly instead of being signed against a contract it was never quoted
 * under. The migration action is to reconcile the old submission and prepare
 * afresh, not to resubmit.
 */
export interface PreparedIntentBinding {
  readonly version: typeof PREPARED_REQUEST_VERSION
  readonly request: unknown
}

export function projectPreparedBinding(
  request: OrchestratorIntentRequest,
): PreparedIntentBinding {
  return {
    version: PREPARED_REQUEST_VERSION,
    request: serializeBigInts(request),
  }
}

/**
 * Refuses a prepared payload from an earlier wire generation.
 *
 * Called before anything reads the artifact's quotes, so an older shape fails
 * with this typed error rather than tripping over a missing field.
 */
export function assertPreparedBinding(
  binding: PreparedIntentBinding | undefined,
): asserts binding is PreparedIntentBinding {
  if (!binding || binding.version !== PREPARED_REQUEST_VERSION) {
    throw new InvalidPreparedTransactionError({
      context: { version: binding?.version ?? null },
    })
  }
}

export function restorePreparedBinding(
  binding: PreparedIntentBinding | undefined,
): OrchestratorIntentRequest {
  assertPreparedBinding(binding)
  return binding.request as OrchestratorIntentRequest
}

function serializeBigInts(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(serializeBigInts)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeBigInts(item)]),
    )
  }
  return value
}
