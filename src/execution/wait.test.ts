import { afterEach, describe, expect, test, vi } from 'vitest'
import type { RhinestoneConfig } from '../types'
import { IntentFailedError, waitForExecution } from '.'

const fillHash = `0x${'11'.repeat(32)}`
const claimHash = `0x${'22'.repeat(32)}`

function statusBody(status: string, claimed = false) {
  return {
    status,
    accountAddress: `0x${'33'.repeat(20)}`,
    operations: [
      {
        chain: 84532,
        items: [
          {
            type: 'CLAIM',
            status: claimed ? 'COMPLETED' : 'PENDING',
            debitsAccount: true,
            ...(claimed ? { txHash: claimHash } : {}),
          },
        ],
      },
      {
        chain: 11155420,
        items: [
          {
            type: 'BRIDGE_FILL',
            status: 'COMPLETED',
            txHash: fillHash,
          },
        ],
      },
    ],
  }
}

const config = {
  endpointUrl: 'https://example.test',
  _authProvider: {
    getHeaders: async () => ({}),
    getSubmitHeaders: async () => ({}),
  },
} as unknown as RhinestoneConfig

const result = {
  type: 'intent' as const,
  id: 42n,
  targetChain: 11155420,
}

function stubPolls(bodies: unknown[]) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const body = bodies.shift()
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('waitForExecution', () => {
  test('polls blanc status until the intent completes', async () => {
    vi.useFakeTimers()
    const fetchMock = stubPolls([
      statusBody('PENDING'),
      statusBody('PENDING', true),
      statusBody('COMPLETED', true),
    ])
    const pending = waitForExecution(config, result, false)
    await vi.runAllTimersAsync()
    expect(await pending).toStrictEqual({
      fill: {
        hash: fillHash,
        chainId: 11155420,
      },
      claims: [
        {
          hash: claimHash,
          chainId: 84532,
        },
      ],
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe('https://example.test/intents/42')
      expect((init?.headers as Record<string, string>)['x-api-version']).toBe(
        '2026-04.blanc',
      )
    }
  })

  test('raises IntentFailedError when the intent fails', async () => {
    vi.useFakeTimers()
    stubPolls([statusBody('PENDING'), statusBody('FAILED')])
    const pending = waitForExecution(config, result, false)
    const outcome = expect(pending).rejects.toBeInstanceOf(IntentFailedError)
    await vi.runAllTimersAsync()
    await outcome
  })
})
