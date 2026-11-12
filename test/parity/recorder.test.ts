import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { orchestratorOrigins, PROD_ORCHESTRATOR_URL } from './config'
import { als, createRunContext, type RunContext } from './context'
import { getFault } from './faults'
import { createRecordingFetch } from './recorder'

const underlying = vi.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'x-trace-id': 'trace-1' },
    }),
)
const recordingFetch = createRecordingFetch(
  underlying as unknown as typeof fetch,
)

function context(overrides: Partial<RunContext> = {}): RunContext {
  return {
    ...createRunContext({
      buildId: 'published',
      role: 'baseline',
      scenarioId: 'test',
      submitMode: 'capture',
      fault: undefined,
      origins: orchestratorOrigins({ endpointUrl: undefined }),
    }),
    ...overrides,
  }
}

const apiHeaders = {
  'Content-Type': 'application/json',
  'x-api-key': 'secret-key',
  'x-api-version': '2026-01.alps',
  'x-sdk-version': '1.22.0',
}

beforeEach(() => underlying.mockClear())
afterEach(() => vi.restoreAllMocks())

describe('createRecordingFetch', () => {
  test('passes through outside a run context', async () => {
    await recordingFetch(`${PROD_ORCHESTRATOR_URL}/app-fees/balances`)
    expect(underlying).toHaveBeenCalledOnce()
  })

  test('passes non-orchestrator requests through unrecorded', async () => {
    const ctx = context()
    await als.run(ctx, () =>
      recordingFetch('https://sepolia.base.org', { method: 'POST' }),
    )
    expect(underlying).toHaveBeenCalledOnce()
    expect(ctx.records.http).toEqual([])
  })

  test('records a request and response without credential values', async () => {
    const ctx = context()
    ctx.step = 'read'
    await als.run(ctx, () =>
      recordingFetch(
        `${PROD_ORCHESTRATOR_URL}/accounts/0xAbC/portfolio?chainIds=1,2`,
        {
          headers: {
            ...apiHeaders,
            Authorization: 'Bearer token',
            'x-intent-extension': 'ext',
          },
        },
      ),
    )
    const [record] = ctx.records.http
    expect(record).toMatchObject({
      step: 'read',
      method: 'GET',
      path: '/accounts/0xAbC/portfolio',
      query: { chainIds: '1,2' },
      op: 'portfolio',
      apiVersion: 'alps',
      apiVersionHeader: '2026-01.alps',
      sdkVersionHeader: '1.22.0',
      authHeadersPresent: {
        'x-api-key': true,
        authorization: true,
        'x-intent-extension': true,
      },
      status: 200,
      responseHeaders: { 'x-trace-id': 'trace-1' },
      responseBody: { ok: true },
      captured: false,
    })
    const serialized = JSON.stringify(ctx.records)
    expect(serialized).not.toContain('secret-key')
    expect(serialized).not.toContain('Bearer token')
    expect(serialized).not.toContain('"ext"')
  })

  test('captures an alps submit with a stub and never forwards it', async () => {
    const ctx = context()
    const response = await als.run(ctx, () =>
      recordingFetch(`${PROD_ORCHESTRATOR_URL}/intent-operations`, {
        method: 'POST',
        headers: { 'x-api-key': 'k' },
        body: JSON.stringify({ signedIntentOp: { nonce: '42' } }),
      }),
    )
    expect(underlying).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      result: { id: '42', status: 'PENDING' },
    })
    expect(ctx.records.http[0]).toMatchObject({
      op: 'submit',
      captured: true,
      status: 200,
    })
  })

  test('captures a blanc submit with a stub and never forwards it', async () => {
    const ctx = context()
    const response = await als.run(ctx, () =>
      recordingFetch(`${PROD_ORCHESTRATOR_URL}/intents`, {
        method: 'POST',
        headers: { 'x-api-version': '2026-04.blanc' },
        body: JSON.stringify({ intentId: 'abc', signatures: { origin: [] } }),
      }),
    )
    expect(underlying).not.toHaveBeenCalled()
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ intentId: 'abc' })
  })

  test('forwards submits in live mode', async () => {
    const ctx = context({ submitMode: 'live' })
    await als.run(ctx, () =>
      recordingFetch(`${PROD_ORCHESTRATOR_URL}/intent-operations`, {
        method: 'POST',
        body: JSON.stringify({ signedIntentOp: { nonce: '1' } }),
      }),
    )
    expect(underlying).toHaveBeenCalledOnce()
    expect(ctx.records.http[0].captured).toBe(false)
  })

  test('applies a fault to the candidate only', async () => {
    const fault = getFault('quote.bump-token-amount')
    const body = JSON.stringify({
      tokenRequests: [{ tokenAddress: '0x1', amount: '100' }],
    })
    const send = (ctx: RunContext) =>
      als.run(ctx, () =>
        recordingFetch(`${PROD_ORCHESTRATOR_URL}/intents/route`, {
          method: 'POST',
          body,
        }),
      )

    const baseline = context({ fault })
    await send(baseline)
    expect(
      JSON.parse(underlying.mock.calls[0][1]?.body as string).tokenRequests[0]
        .amount,
    ).toBe('100')
    expect(baseline.records.http[0].faulted).toBe(false)

    const candidate = context({ fault, role: 'candidate' })
    await send(candidate)
    expect(
      JSON.parse(underlying.mock.calls[1][1]?.body as string).tokenRequests[0]
        .amount,
    ).toBe('101')
    expect(candidate.records.http[0]).toMatchObject({
      faulted: true,
      requestBody: { tokenRequests: [{ amount: '101' }] },
    })
  })

  test('attributes interleaved calls to their own run', async () => {
    const a = context({ buildId: 'published' })
    const b = context({ buildId: 'working-tree', role: 'candidate' })
    const slow = (path: string) =>
      new Promise<void>((resolve) => setTimeout(resolve, 5)).then(() =>
        recordingFetch(`${PROD_ORCHESTRATOR_URL}${path}`),
      )
    await Promise.all([
      als.run(a, async () => {
        await slow('/app-fees/balances')
        await slow('/chains')
      }),
      als.run(b, async () => {
        await slow('/intent-operation/1')
      }),
    ])
    expect(a.records.http.map((r) => r.op)).toEqual([
      'appFeeBalances',
      'chains',
    ])
    expect(b.records.http.map((r) => r.op)).toEqual(['status'])
  })
})

describe('getFault', () => {
  test('rejects an unknown id', () => {
    expect(() => getFault('nope')).toThrow(/Unknown PARITY_FAULT "nope"/)
  })

  test('drops auxiliary funds', () => {
    const body = { options: { auxiliaryFunds: { 1: {} }, topupCompact: false } }
    expect(
      getFault('quote.drop-auxiliary-funds').transform(body, 'alps'),
    ).toEqual({
      options: { topupCompact: false },
    })
  })
})
