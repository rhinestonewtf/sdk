import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeSettlementLayers, Orchestrator } from './client'

const authProvider = {
  getHeaders: async () => ({ 'x-api-key': 'test-key' }),
  getSubmitHeaders: async () => ({ 'x-api-key': 'test-key' }),
}

function mockJsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
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
        mockJsonResponse({
          traceId: 'trace-quote',
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
        mockJsonResponse({
          traceId: 'trace-split',
          intents: [{ '0x0000000000000000000000000000000000000001': '1' }],
        }),
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
        mockJsonResponse({
          traceId: 'trace-status',
          status: 'PENDING',
          accountAddress: '0x0000000000000000000000000000000000000001',
          operations: [],
        }),
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
        mockJsonResponse({
          traceId: 'trace-submit',
          intentId: '1',
        }),
      ),
    )
    const orchestrator = new Orchestrator(
      'https://orchestrator.test',
      authProvider,
    )

    const result = await orchestrator.createIntent({ intentId: '1' } as any)

    expect(result.traceId).toBe('trace-submit')
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
