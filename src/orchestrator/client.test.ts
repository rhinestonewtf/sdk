import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeSettlementLayers, Orchestrator } from './client'

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

describe('encodeSettlementLayers', () => {
  it('include passes through unchanged', () => {
    expect(encodeSettlementLayers({ include: ['ACROSS', 'ECO'] })).toEqual([
      'ACROSS',
      'ECO',
    ])
  })

  it('exclude inverts against the known-layers universe', () => {
    expect(encodeSettlementLayers({ exclude: ['RELAY'] })).toEqual([
      'ACROSS',
      'ECO',
      'OFT',
      'NEAR',
      'RHINO',
      'CCTP',
    ])
  })

  it('exclude with unknown layer is a no-op against the universe', () => {
    // SAME_CHAIN isn't user-selectable on the orchestrator. Excluding it
    // should leave the universe intact rather than narrowing further.
    expect(encodeSettlementLayers({ exclude: ['SAME_CHAIN'] })).toEqual([
      'ACROSS',
      'ECO',
      'RELAY',
      'OFT',
      'NEAR',
      'RHINO',
      'CCTP',
    ])
  })
})
