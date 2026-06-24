import { afterEach, describe, expect, it, vi } from 'vitest'
import { Orchestrator } from './client'

const authProvider = {
  getHeaders: async () => ({ 'x-api-key': 'test-key' }),
  getSubmitHeaders: async () => ({ 'x-api-key': 'test-key' }),
}

function mockJsonResponse(body: unknown, traceId?: string, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(traceId ? { 'x-trace-id': traceId } : {}),
    },
  })
}

describe('Orchestrator trace IDs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves traceId on quote responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockJsonResponse(
          {
            routes: [
              {
                intentId: '1',
                expiresAt: 123,
                estimatedFillTime: { seconds: 3 },
                settlementLayer: 'ACROSS',
                signData: { origin: [], destination: null },
                cost: { input: [], output: [], fees: {} },
              },
            ],
          },
          'trace-quote',
        ),
      ),
    )
    const orchestrator = new Orchestrator(
      'https://orchestrator.test',
      authProvider,
    )

    const result = await orchestrator.createQuote({
      account: {
        address: '0x0000000000000000000000000000000000000001',
        type: 'smartAccount',
      },
      destinationChainId: 1,
      destinationExecutions: [],
      tokenRequests: [],
      options: {},
    } as any)

    expect(result.traceId).toBe('trace-quote')
  })

  it('encodes appFees in quote options', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        routes: [
          {
            intentId: '1',
            expiresAt: 123,
            estimatedFillTime: { seconds: 3 },
            settlementLayer: 'ACROSS',
            signData: { origin: [], destination: null },
            cost: { input: [], output: [], fees: {} },
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const orchestrator = new Orchestrator(
      'https://orchestrator.test',
      authProvider,
    )

    await orchestrator.createQuote({
      account: {
        address: '0x0000000000000000000000000000000000000001',
        type: 'smartAccount',
      },
      destinationChainId: 1,
      destinationExecutions: [],
      tokenRequests: [],
      options: { appFees: { feeBps: 100 } },
    } as any)

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      options: { appFees: { feeBps: 100 } },
    })
  })

  it('decodes app fee legs and app fee breakdown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          routes: [
            {
              intentId: '1',
              expiresAt: 123,
              estimatedFillTime: { seconds: 3 },
              settlementLayer: 'ACROSS',
              signData: { origin: [], destination: null },
              appFee: [
                {
                  feeBps: 100,
                  baseAmount: '1000000',
                  amount: '10000',
                  chainId: 'eip155:42161',
                  tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
                },
              ],
              cost: {
                input: [],
                output: [],
                fees: {
                  total: { usd: 1.01 },
                  breakdown: {
                    gas: { usd: 1 },
                    bridge: { usd: 0 },
                    swap: { usd: 0 },
                    app: { usd: 0.01 },
                  },
                },
              },
            },
          ],
        }),
      ),
    )
    const orchestrator = new Orchestrator(
      'https://orchestrator.test',
      authProvider,
    )

    const result = await orchestrator.createQuote({
      account: {
        address: '0x0000000000000000000000000000000000000001',
        type: 'smartAccount',
      },
      destinationChainId: 1,
      destinationExecutions: [],
      tokenRequests: [],
      options: {},
    } as any)

    expect(result.routes[0].appFee).toEqual([
      {
        feeBps: 100,
        baseAmount: 1000000n,
        amount: 10000n,
        chainId: 42161,
        tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      },
    ])
    expect(result.routes[0].cost.fees.breakdown.app).toEqual({ usd: 0.01 })
  })

  it('preserves traceId on split responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockJsonResponse(
          {
            intents: [{ '0x0000000000000000000000000000000000000001': '1' }],
          },
          'trace-split',
        ),
      ),
    )
    const orchestrator = new Orchestrator(
      'https://orchestrator.test',
      authProvider,
    )

    const result = await orchestrator.getSplit({
      chain: { id: 1 },
      tokens: { '0x0000000000000000000000000000000000000001': 1n },
    } as any)

    expect(result.traceId).toBe('trace-split')
  })

  it('preserves traceId on intent status responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockJsonResponse(
          {
            status: 'PENDING',
            accountAddress: '0x0000000000000000000000000000000000000001',
            operations: [],
          },
          'trace-status',
        ),
      ),
    )
    const orchestrator = new Orchestrator(
      'https://orchestrator.test',
      authProvider,
    )

    const result = await orchestrator.getIntent('1')

    expect(result.traceId).toBe('trace-status')
  })

  it('preserves traceId on submit responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockJsonResponse(
          {
            intentId: '1',
          },
          'trace-submit',
        ),
      ),
    )
    const orchestrator = new Orchestrator(
      'https://orchestrator.test',
      authProvider,
    )

    const result = await orchestrator.createIntent({ intentId: '1' } as any)

    expect(result.traceId).toBe('trace-submit')
  })

  it('prefers x-trace-id over error body traceId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockJsonResponse(
          {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            traceId: 'trace-body',
          },
          'trace-header',
          400,
        ),
      ),
    )
    const orchestrator = new Orchestrator(
      'https://orchestrator.test',
      authProvider,
    )

    await expect(orchestrator.getIntent('1')).rejects.toMatchObject({
      traceId: 'trace-header',
    })
  })
})
