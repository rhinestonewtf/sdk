import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSolanaRpcFetch, SolanaRpcError } from './transport'

const url = 'https://rpc.invalid'
const request = (method = 'getAccountInfo') => ({
  method: 'POST',
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
})
const success = () => new Response('{"result":1}')

async function settle<T>(promise: Promise<T>, ms = 0) {
  const result = promise.then(
    (value) => value,
    (error: unknown) => error,
  )
  await vi.advanceTimersByTimeAsync(ms)
  return result
}

describe('Solana RPC transport', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('paces queued requests and retries, respecting Retry-After: 10', async () => {
    const starts: number[] = []
    const mock = vi.fn(() => {
      starts.push(Date.now())
      return Promise.resolve(
        starts.length === 1
          ? new Response('private error body', {
              status: 429,
              headers: { 'Retry-After': '10' },
            })
          : success(),
      )
    })
    vi.stubGlobal('fetch', mock)
    const fetch = createSolanaRpcFetch()
    const first = fetch(url, request())
    const second = fetch(url, request('getBalance'))
    await vi.advanceTimersByTimeAsync(0)
    expect(mock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(299)
    expect(mock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(9_699)
    expect(mock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(mock).toHaveBeenCalledTimes(3)
    expect((await first).ok).toBe(true)
    expect((await second).ok).toBe(true)
    expect(starts[2] - starts[0]).toBe(10_000)
  })

  it('bounds persistent 429 to two retries', async () => {
    const mock = vi.fn(async () => new Response('secret', { status: 429 }))
    vi.stubGlobal('fetch', mock)
    const result = await settle(createSolanaRpcFetch()(url, request()), 2_000)
    expect(mock).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ category: 'http', httpStatus: 429 })
  })

  it('bounds excessive Retry-After to the invocation deadline without early retry', async () => {
    const mock = vi.fn(
      async () =>
        new Response('secret', {
          status: 429,
          headers: { 'Retry-After': '120' },
        }),
    )
    vi.stubGlobal('fetch', mock)
    const result = await settle(createSolanaRpcFetch()(url, request()), 30_000)
    expect(result).toMatchObject({ category: 'deadline', httpStatus: 429 })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it.each(['sendTransaction', 'requestAirdrop', 'unknownMethod'])(
    'does not retry %s, including 429',
    async (method) => {
      const mock = vi.fn(async () => new Response('secret', { status: 429 }))
      vi.stubGlobal('fetch', mock)
      const result = await settle(createSolanaRpcFetch()(url, request(method)))
      expect(result).toMatchObject({ category: 'http', httpStatus: 429 })
      expect((result as SolanaRpcError).rpcMethod).toBeUndefined()
      expect(mock).toHaveBeenCalledTimes(1)
    },
  )

  it('never retries a JSON batch containing writes', async () => {
    const mock = vi.fn(async () => new Response('secret', { status: 503 }))
    vi.stubGlobal('fetch', mock)
    const result = await settle(
      createSolanaRpcFetch()(url, {
        method: 'POST',
        body: JSON.stringify([
          { method: 'getBalance' },
          { method: 'sendTransaction' },
        ]),
      }),
    )
    expect(result).toBeInstanceOf(SolanaRpcError)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it.each([502, 503, 504])('retries explicit read HTTP %s', async (status) => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response('secret', { status }))
      .mockImplementation(async () => success())
    vi.stubGlobal('fetch', mock)
    expect(
      await settle(createSolanaRpcFetch()(url, request()), 1_000),
    ).toBeInstanceOf(Response)
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('does not retry JSON RPC errors or ambiguous network failures', async () => {
    const mock = vi.fn(
      async () => new Response('{"error":{"message":"secret"}}'),
    )
    vi.stubGlobal('fetch', mock)
    const fetch = createSolanaRpcFetch()
    const response = (await settle(fetch(url, request()))) as Response
    expect(await response.json()).toEqual({ error: { message: 'secret' } })
    mock.mockRejectedValueOnce(new Error('secret endpoint and transaction'))
    const result = await settle(fetch(url, request()), 300)
    expect(result).toBeInstanceOf(SolanaRpcError)
    expect(result).toMatchObject({
      category: 'network',
      rpcMethod: 'getAccountInfo',
    })
    expect(String(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('secret')
    expect((result as Error).cause).toBeUndefined()
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('sanitizes HTTP response bodies and unknown method names', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('secret response', {
            status: 401,
            statusText: 'secret status',
          }),
      ),
    )
    const error = await settle(
      createSolanaRpcFetch()(url, request('secret method')),
    )
    expect(error).toMatchObject({ category: 'http', httpStatus: 401 })
    expect(String(error)).toBe(
      'SolanaRpcError: Solana RPC transport failed (http)',
    )
    expect(JSON.stringify(error)).not.toContain('secret')
  })

  it('persists sanitized transport details before caller error wrapping', async () => {
    const onError = vi.fn(async (_error: SolanaRpcError) => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('secret-body', { status: 401 })),
    )
    const error = await settle(
      createSolanaRpcFetch({ onError })(
        'https://rpc.invalid/?key=secret-key',
        request(),
      ),
    )
    expect(onError).toHaveBeenCalledExactlyOnceWith(error)
    expect(error).toMatchObject({
      category: 'http',
      rpcMethod: 'getAccountInfo',
      httpStatus: 401,
    })
    expect(JSON.stringify(onError.mock.calls)).not.toContain('secret')
  })

  it.each(['input', 'init'])(
    'does not send queued writes after %s signal aborts',
    async (source) => {
      const mock = vi.fn(async () => success())
      vi.stubGlobal('fetch', mock)
      const fetch = createSolanaRpcFetch()
      await settle(fetch(url, request()))
      const controller = new AbortController()
      const queued = fetch(
        source === 'input'
          ? new Request(url, { signal: controller.signal })
          : url,
        {
          ...request('sendTransaction'),
          ...(source === 'init' ? { signal: controller.signal } : {}),
        },
      )
      controller.abort(new Error('secret abort reason'))
      expect(await settle(queued, 1_000)).toMatchObject({ category: 'aborted' })
      expect(mock).toHaveBeenCalledTimes(1)
    },
  )

  it('honors caller abort during fetch without retry or leaking the reason', async () => {
    const controller = new AbortController()
    const mock = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', mock)
    const pending = createSolanaRpcFetch()(url, {
      ...request(),
      signal: controller.signal,
    })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(new Error('secret reason'))
    const error = await settle(pending)
    expect(error).toMatchObject({ category: 'aborted' })
    expect(String(error)).not.toContain('secret')
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('never sends a write whose deadline expires in the queue', async () => {
    const mock = vi.fn(async () => success())
    vi.stubGlobal('fetch', mock)
    const fetch = createSolanaRpcFetch({ timeoutMs: 100 })
    await settle(fetch(url, request()))
    expect(
      await settle(fetch(url, request('sendTransaction')), 300),
    ).toMatchObject({ category: 'deadline' })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('captures scoped global fetch before queue wait and retains revocation', async () => {
    const restored = vi.fn(async () => success())
    vi.stubGlobal('fetch', restored)
    const fetch = createSolanaRpcFetch()
    await settle(fetch(url, request()))
    let revoked = false
    const scoped = vi.fn(async () => {
      if (revoked) throw new Error('fixture revoked secret')
      return success()
    })
    vi.stubGlobal('fetch', scoped)
    const queued = fetch(url, request('sendTransaction'))
    revoked = true
    vi.stubGlobal('fetch', restored)
    expect(await settle(queued, 300)).toMatchObject({ category: 'network' })
    expect(scoped).toHaveBeenCalledTimes(1)
    expect(restored).toHaveBeenCalledTimes(1)
  })

  it.each(['fetch', 'body'])(
    'bounds a hanging %s to the deadline',
    async (stage) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          stage === 'fetch'
            ? new Promise(() => {})
            : Promise.resolve(new Response(new ReadableStream({ start() {} }))),
        ),
      )
      expect(
        await settle(createSolanaRpcFetch()(url, request()), 30_000),
      ).toMatchObject({ category: 'deadline' })
    },
  )
})
