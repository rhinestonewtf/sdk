import {
  isConnectionError,
  isRateLimited,
  isRetryable,
  RateLimitedError,
} from '../../clients/orchestrator/errors'
import type { OrchestratorIntentStatus } from '../../clients/orchestrator/types'
import type { IntentStatus } from './types'

const slowDelayMs = 2_000

export function classifyIntentStatus(
  status: OrchestratorIntentStatus,
): IntentStatus {
  return {
    traceId: status.traceId,
    intentId: status.intentId,
    status: status.status,
    account: status.account,
    operations: status.operations,
    terminal: status.status === 'COMPLETED' || status.status === 'FAILED',
  }
}

export function getIntentRetryDelay(input: {
  readonly error: unknown
  readonly now: number
  readonly minimum: number
  readonly fallback: number
}): { readonly delay: number; readonly backoff: boolean } | undefined {
  if (
    !isRetryable(input.error) &&
    !isRateLimited(input.error) &&
    !isConnectionError(input.error)
  ) {
    return undefined
  }
  if (!(input.error instanceof RateLimitedError)) {
    return { delay: input.fallback, backoff: true }
  }
  if (!input.error.retryAfter) {
    return { delay: Math.max(slowDelayMs, input.minimum), backoff: false }
  }
  const seconds = Number(input.error.retryAfter)
  if (!Number.isNaN(seconds)) {
    return {
      delay: Math.max(seconds * 1_000, input.minimum),
      backoff: false,
    }
  }
  const date = Date.parse(input.error.retryAfter)
  return {
    delay: Number.isNaN(date)
      ? input.minimum
      : Math.max(date - input.now, input.minimum),
    backoff: false,
  }
}
