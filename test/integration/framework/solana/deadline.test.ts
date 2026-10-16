import { afterEach, expect, test, vi } from 'vitest'
import { SolanaRequestScope } from './deadline'
import { type DeploymentEvidence, observeDeploymentFetch } from './evidence'

afterEach(() => vi.useRealTimers())

test('revocation aborts in-flight fetches and suppresses evidence from ignored cancellation', async () => {
  vi.useFakeTimers()
  const scope = new SolanaRequestScope()
  let respond!: (response: Response) => void
  let signal: AbortSignal | undefined
  const network = vi.fn((_input, init) => {
    signal = init.signal
    return new Promise<Response>((resolve) => {
      respond = resolve
    })
  })
  const evidence: DeploymentEvidence[] = []
  const record = vi.fn()
  const fetcher = observeDeploymentFetch(
    scope.fetch(network as unknown as typeof fetch),
    evidence,
    record,
    () => scope.assertActive(),
  )
  const run = scope.wait(() =>
    fetcher('https://example.test/quotes', { method: 'POST' }),
  )
  const rejected = expect(run).rejects.toThrow('RPC timeout')
  await vi.advanceTimersByTimeAsync(60_000)
  await rejected
  expect(signal?.aborted).toBe(true)
  respond(
    Response.json({
      routes: [
        {
          purpose: 'deployment',
          intentId: 'late',
          deploymentCosts: [{ rent: { amount: '200' } }],
        },
      ],
    }),
  )
  await vi.advanceTimersByTimeAsync(1)
  expect(evidence).toEqual([])
  expect(record).not.toHaveBeenCalled()
  await expect(
    fetcher('https://example.test/intents', {
      method: 'POST',
      body: '{"intentId":"late"}',
    }),
  ).rejects.toThrow('revoked')
  expect(network).toHaveBeenCalledTimes(1)
})

test('a quote body decoded after timeout cannot mutate evidence or record it', async () => {
  vi.useFakeTimers()
  const scope = new SolanaRequestScope()
  let decoded!: (body: unknown) => void
  const response = new Response('{}')
  vi.spyOn(response, 'clone').mockReturnValue({
    json: () =>
      new Promise((resolve) => {
        decoded = resolve
      }),
  } as Response)
  const network = vi.fn().mockResolvedValue(response)
  const evidence: DeploymentEvidence[] = []
  const record = vi.fn()
  const fetcher = observeDeploymentFetch(
    scope.fetch(network as unknown as typeof fetch),
    evidence,
    record,
    () => scope.assertActive(),
  )
  const run = scope.wait(() =>
    fetcher('https://example.test/quotes', { method: 'POST' }),
  )
  const rejected = expect(run).rejects.toThrow('RPC timeout')
  await vi.advanceTimersByTimeAsync(60_000)
  await rejected
  decoded({
    routes: [
      {
        purpose: 'deployment',
        intentId: 'late',
        deploymentCosts: [{ rent: { amount: '200' } }],
      },
    ],
  })
  await vi.advanceTimersByTimeAsync(1)
  expect(evidence).toEqual([])
  expect(record).not.toHaveBeenCalled()
})

test('a submission paused on evidence persistence cannot broadcast after timeout', async () => {
  vi.useFakeTimers()
  const scope = new SolanaRequestScope()
  const network = vi.fn().mockResolvedValue(Response.json({}))
  let persisted!: () => void
  const evidence = [
    { intentId: 'selected', quotedAmounts: ['200'], submissions: 0 },
  ]
  const fetcher = observeDeploymentFetch(
    scope.fetch(network as unknown as typeof fetch),
    evidence,
    () =>
      new Promise<void>((resolve) => {
        persisted = resolve
      }),
    () => scope.assertActive(),
  )
  const run = scope.wait(() =>
    fetcher('https://example.test/intents', {
      method: 'POST',
      body: '{"intentId":"selected"}',
    }),
  )
  const rejected = expect(run).rejects.toThrow('RPC timeout')
  await vi.advanceTimersByTimeAsync(60_000)
  await rejected
  persisted()
  await vi.advanceTimersByTimeAsync(1)
  expect(network).not.toHaveBeenCalled()
  expect(evidence[0].submissions).toBe(1)
})
