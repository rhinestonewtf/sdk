const READ_METHODS = new Set([
  'getGenesisHash',
  'getAccountInfo',
  'getBalance',
  'getMinimumBalanceForRentExemption',
  'getLatestBlockhash',
  'getFeeForMessage',
  'getTransaction',
  'getSignatureStatuses',
  'getBlockHeight',
])
const RETRY_STATUSES = new Set([429, 502, 503, 504])

type ErrorCategory = 'http' | 'network' | 'aborted' | 'deadline'

export class SolanaRpcError extends Error {
  constructor(
    readonly category: ErrorCategory,
    readonly rpcMethod?: string,
    readonly httpStatus?: number,
  ) {
    super(`Solana RPC transport failed (${category})`)
    this.name = 'SolanaRpcError'
  }
}

function readMethod(body: unknown): string | undefined {
  if (typeof body !== 'string') return undefined
  try {
    const value = JSON.parse(body)
    return !Array.isArray(value) && READ_METHODS.has(value?.method)
      ? value.method
      : undefined
  } catch {
    return undefined
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Aborted'))
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort)
    })
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
  })
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 && !signal.aborted) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(new Error('Aborted'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
  })
}

function retryDelay(response: Response): number {
  const header = response.headers.get('retry-after')
  if (!header) return 1_000
  const seconds = Number(header)
  const ms = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(header) - Date.now()
  // A server asking us to wait beyond the budget must not trigger an early retry.
  return Number.isFinite(ms) ? Math.max(0, ms) : 1_000
}

/** One instance shares pacing across all requests on a Connection. */
export function createSolanaRpcFetch(
  options: {
    intervalMs?: number
    timeoutMs?: number
    onError?: (error: SolanaRpcError) => void | Promise<void>
  } = {},
): typeof globalThis.fetch {
  const intervalMs = Math.max(300, options.intervalMs ?? 300)
  const timeoutMs = Math.min(30_000, Math.max(1, options.timeoutMs ?? 30_000))
  let nextStart = 0
  let queue = Promise.resolve()

  return (async (input, init) => {
    // Capture before queueing: fixture-scoped fetches remain revocable after restoration.
    const fetch = globalThis.fetch
    const rpcMethod = readMethod(init?.body)
    const controller = new AbortController()
    const signals = [controller.signal]
    if (init?.signal) signals.push(init.signal)
    if (input instanceof Request) signals.push(input.signal)
    const signal = AbortSignal.any(signals)
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let httpStatus: number | undefined

    const acquire = async () => {
      const slot = queue.then(async () => {
        if (signal.aborted) throw new Error('Aborted')
        await pause(Math.max(0, nextStart - Date.now()), signal)
        if (signal.aborted) throw new Error('Aborted')
        nextStart = Date.now() + intervalMs
      })
      queue = slot.catch(() => {})
      await abortable(slot, signal)
    }

    try {
      for (let attempt = 0; ; attempt++) {
        await acquire()
        if (signal.aborted) throw new Error('Aborted')
        const response = await abortable(
          fetch(input, { ...init, signal }),
          signal,
        )
        httpStatus = response.status
        if (response.ok) {
          // Include body consumption in the same deadline, not just response headers.
          const body = await abortable(response.text(), signal)
          return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          })
        }
        void response.body?.cancel().catch(() => {})
        if (
          !rpcMethod ||
          !RETRY_STATUSES.has(response.status) ||
          attempt >= 2
        ) {
          throw new SolanaRpcError('http', rpcMethod, response.status)
        }
        await pause(retryDelay(response), signal)
      }
    } catch (error) {
      const failure =
        error instanceof SolanaRpcError
          ? error
          : new SolanaRpcError(
              controller.signal.aborted
                ? 'deadline'
                : signal.aborted
                  ? 'aborted'
                  : 'network',
              rpcMethod,
              httpStatus,
            )
      await options.onError?.(failure)
      throw failure
    } finally {
      clearTimeout(timer)
    }
  }) as typeof globalThis.fetch
}
