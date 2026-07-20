import { describe, expect, test, vi } from 'vitest'
import { createOrchestratorAuth } from './auth'
import { createOrchestratorClient } from './client'
import type { RateLimitedError } from './errors'

const address = '0x0000000000000000000000000000000000000001' as const

describe('orchestrator client', () => {
  test('maps quote requests and preserves auth, custom headers, and trace ids', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          destinationChainId: 'eip155:10',
          destinationExecutions: [{ to: address, value: '2', data: '0x' }],
          options: { auxiliaryFunds: { 'eip155:1': { [address]: '3' } } },
        })
        return new Response(
          JSON.stringify({
            routes: [
              {
                intentId: 'intent-1',
                expiresAt: 1,
                estimatedFillTime: { seconds: 2 },
                settlementLayer: 'SAME_CHAIN',
                signData: {
                  origin: [],
                  destination: {
                    domain: {},
                    types: {},
                    primaryType: 'Test',
                    message: {},
                  },
                },
                cost: {},
              },
            ],
          }),
          { headers: { 'x-trace-id': 'trace-1' } },
        )
      },
    )
    const client = createOrchestratorClient({
      url: 'https://orchestrator.example',
      auth: createOrchestratorAuth({ kind: 'api-key', apiKey: 'secret' }),
      headers: { 'x-custom': 'value' },
      fetch,
    })

    const result = await client.createQuote({
      account: { address, accountType: 'ERC7579' },
      destinationChainId: 10,
      destinationExecutions: [{ to: address, value: 2n, data: '0x' }],
      tokenRequests: [],
      options: { auxiliaryFunds: { 1: { [address]: 3n } } },
    })

    expect(result.traceId).toBe('trace-1')
    expect(result.routes[0]?.intentId).toBe('intent-1')
    expect(fetch).toHaveBeenCalledWith(
      'https://orchestrator.example/quotes',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'secret',
          'x-custom': 'value',
          'x-api-version': '2026-04.blanc',
        }),
      }),
    )
  })

  test('refreshes JWT auth and adds the intent extension only for sponsored submissions', async () => {
    const accessToken = vi.fn(async () => 'access')
    const extension = vi.fn(async () => 'extension')
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer access',
          'X-Intent-Extension': 'Bearer extension',
        })
        return Response.json({ intentId: 'intent-1' })
      },
    )
    const client = createOrchestratorClient({
      url: 'https://orchestrator.example',
      auth: createOrchestratorAuth({
        kind: 'jwt',
        accessToken,
        getIntentExtensionToken: extension,
      }),
      fetch,
    })

    await client.submitIntent(
      {
        intentId: 'intent-1',
        signatures: { origin: [], destination: '0x' },
      },
      { intentInput: { request: true }, sponsored: true },
    )

    expect(accessToken).toHaveBeenCalledOnce()
    expect(extension).toHaveBeenCalledWith({ request: true })
  })

  test('maps error envelope metadata', async () => {
    const client = createOrchestratorClient({
      url: 'https://orchestrator.example',
      auth: createOrchestratorAuth({ kind: 'api-key', apiKey: 'secret' }),
      fetch: async () =>
        new Response(
          JSON.stringify({ code: 'TOO_MANY_REQUESTS', message: 'slow' }),
          {
            status: 429,
            headers: { 'retry-after': '3', 'x-trace-id': 'trace-error' },
          },
        ),
    })

    await expect(client.getIntentStatus('intent-1')).rejects.toMatchObject({
      message: 'slow',
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      retryAfter: '3',
      traceId: 'trace-error',
    } satisfies Partial<RateLimitedError>)
  })
})
