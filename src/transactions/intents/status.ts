import { IntentFailedError } from '../../errors/execution'
import { classifyIntentStatus, getIntentRetryDelay } from './status-policy'
import type { IntentStatus, IntentWorkflowContext } from './types'

const initialDelayMs = 500
const slowAfterMs = 15_000
const slowDelayMs = 2_000
const initialErrorBackoffMs = 1_000
const maximumErrorBackoffMs = 10_000

export async function getIntentStatus<CompatibilityConfig>(
  context: Pick<IntentWorkflowContext<CompatibilityConfig>, 'statusClient'>,
  intentId: string,
  options?: { readonly full?: boolean },
): Promise<IntentStatus> {
  return classifyIntentStatus(
    await context.statusClient.getIntentStatus(
      intentId,
      options?.full ? { full: true } : undefined,
    ),
  )
}

export async function waitForIntentStatus<CompatibilityConfig>(
  context: Pick<
    IntentWorkflowContext<CompatibilityConfig>,
    'statusClient' | 'clock'
  >,
  intentId: string,
): Promise<IntentStatus> {
  const startedAt = context.clock.now()
  let nextDelay = initialDelayMs
  let errorBackoff = initialErrorBackoffMs
  for (;;) {
    let status: IntentStatus
    try {
      status = await getIntentStatus(context, intentId)
      errorBackoff = initialErrorBackoffMs
      nextDelay =
        context.clock.now() - startedAt >= slowAfterMs
          ? slowDelayMs
          : initialDelayMs
      await context.clock.sleep(nextDelay)
    } catch (error) {
      const retryDelay = getIntentRetryDelay({
        error,
        now: context.clock.now(),
        minimum: nextDelay,
        fallback: errorBackoff,
      })
      if (retryDelay === undefined) throw error
      await context.clock.sleep(retryDelay.delay)
      if (retryDelay.backoff) {
        errorBackoff = Math.min(errorBackoff * 2, maximumErrorBackoffMs)
      }
      continue
    }
    if (!status.terminal) continue
    if (status.status === 'FAILED') {
      // The refunds ride the ERROR, because this is the only path they can
      // take: a refunded intent, or one whose HyperCore action was refused, is
      // still `FAILED` — it did not do what was asked — so this throws and the
      // caller never sees a returned status. Omitting them would hide the
      // refund from `waitForExecution` for the exact case the field exists to
      // answer; a refused trade's onchain operations all read COMPLETED, and
      // the EXECUTION item in `operations` is what says whether a retry is safe.
      throw new IntentFailedError({
        context: {
          intentId,
          operations: status.operations,
          ...(status.refunds ? { refunds: status.refunds } : {}),
        },
      })
    }
    return status
  }
}
