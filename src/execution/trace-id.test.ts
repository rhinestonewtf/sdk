import { mainnet } from 'viem/chains'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INTENT_STATUS_COMPLETED } from '../orchestrator'
import { getIntentStatus, waitForExecution } from './index'
import { submitIntentInternal } from './utils'

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

describe('execution trace IDs', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('preserves traceId on submitted intent results without posting it', async () => {
    const fetch = vi.fn().mockResolvedValue(
      mockJsonResponse({
        traceId: 'trace-submit',
        intentId: '123',
      }),
    )
    vi.stubGlobal('fetch', fetch)

    const result = await submitIntentInternal(
      {
        _authProvider: authProvider,
        endpointUrl: 'https://orchestrator.test',
      } as any,
      undefined,
      mainnet,
      { intentId: '123', expiresAt: 9999999999 } as any,
      [],
      '0xdeadbeef',
      undefined,
      [],
      false,
    )

    expect(result.traceId).toBe('trace-submit')
    const [, init] = fetch.mock.calls[0]
    expect(JSON.parse(init.body)).not.toHaveProperty('traceId')
  })

  it('preserves traceId on public getIntentStatus', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          traceId: 'trace-status',
          status: INTENT_STATUS_COMPLETED,
          accountAddress: '0x0000000000000000000000000000000000000001',
          operations: [],
        }),
      ),
    )

    const status = await getIntentStatus(
      authProvider,
      'https://orchestrator.test',
      '123',
    )

    expect(status.traceId).toBe('trace-status')
  })

  it('preserves traceId on public waitForExecution intent status', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          traceId: 'trace-wait',
          status: INTENT_STATUS_COMPLETED,
          accountAddress: '0x0000000000000000000000000000000000000001',
          operations: [],
        }),
      ),
    )

    const promise = waitForExecution(
      {
        _authProvider: authProvider,
        endpointUrl: 'https://orchestrator.test',
      } as any,
      {
        type: 'intent',
        id: '123',
        traceId: 'trace-submit',
        targetChain: mainnet.id,
        expiresAt: 9999999999,
      },
    )

    await vi.advanceTimersByTimeAsync(500)

    await expect(promise).resolves.toMatchObject({ traceId: 'trace-wait' })
  })
})
