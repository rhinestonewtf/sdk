import { mainnet } from 'viem/chains'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Orchestrator } from './client'
import type { SettlementLayerFilter } from './types'

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

describe('settlementLayers filter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function capturedSplitBody(
    settlementLayers: SettlementLayerFilter | undefined,
  ) {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ intents: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const orchestrator = new Orchestrator(
      'https://orchestrator.test',
      authProvider,
    )
    await orchestrator.getSplit({
      chain: mainnet,
      tokens: {},
      settlementLayers,
    })

    return JSON.parse(fetchMock.mock.calls[0][1].body)
  }

  it('sends an include filter on the wire unchanged', async () => {
    const body = await capturedSplitBody({ include: ['ACROSS', 'ECO'] })
    expect(body.settlementLayers).toEqual({ include: ['ACROSS', 'ECO'] })
  })

  it('sends an exclude filter on the wire unchanged', async () => {
    // The orchestrator inverts `exclude` against its own live layer set, so
    // the SDK forwards the filter verbatim instead of enumerating layers.
    const body = await capturedSplitBody({ exclude: ['RELAY'] })
    expect(body.settlementLayers).toEqual({ exclude: ['RELAY'] })
  })

  it('omits settlementLayers when unset', async () => {
    const body = await capturedSplitBody(undefined)
    expect(body.settlementLayers).toBeUndefined()
  })
})
