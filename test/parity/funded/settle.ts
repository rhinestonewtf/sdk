// Polls submitted intents until each reaches a terminal status, so the next
// build starts from settled on-chain state.

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'EXPIRED'])

interface SettleOutcome {
  intentId: string
  // A terminal status, or the last status seen when the timeout hit.
  status: string
  settled: boolean
  elapsedMs: number
}

interface SettleOptions {
  status(intentId: string): Promise<string>
  timeoutMs: number
  intervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const SETTLE_INTERVAL_MS = 3000

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function settleOne(
  intentId: string,
  options: SettleOptions,
): Promise<SettleOutcome> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep
  const interval = options.intervalMs ?? SETTLE_INTERVAL_MS
  const start = now()
  let status = 'UNKNOWN'
  for (;;) {
    try {
      status = await options.status(intentId)
    } catch {
      // Transient read failures are retried until the timeout.
    }
    const elapsedMs = now() - start
    if (TERMINAL.has(status)) {
      return { intentId, status, settled: true, elapsedMs }
    }
    if (elapsedMs >= options.timeoutMs) {
      return { intentId, status, settled: false, elapsedMs }
    }
    await sleep(interval)
  }
}

async function settle(
  intentIds: readonly string[],
  options: SettleOptions,
): Promise<SettleOutcome[]> {
  const outcomes: SettleOutcome[] = []
  for (const intentId of intentIds) {
    outcomes.push(await settleOne(intentId, options))
  }
  return outcomes
}

export type { SettleOptions, SettleOutcome }
export { SETTLE_INTERVAL_MS, settle }
