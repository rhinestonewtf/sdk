import { afterEach, describe, expect, test, vi } from 'vitest'
import recorded from '../orchestrator/__fixtures__/read-responses.json'
import type { RhinestoneConfig } from '../types'
import { IntentFailedError, waitForExecution } from '.'

const CASES = recorded as { id: string; alps: any; blanc: any }[]

function blancBody(id: string) {
  const found = CASES.find((c) => c.id === id)
  if (!found) throw new Error(`missing case ${id}`)
  return found.blanc.body
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
      blancBody('synthetic.inflight-cross-chain-claim-pending'),
      blancBody('synthetic.inflight-cross-chain-claim-landed'),
      blancBody('synthetic.completed-cross-chain'),
    ])
    const pending = waitForExecution(config, result, false)
    await vi.runAllTimersAsync()
    expect(await pending).toStrictEqual({
      fill: {
        hash: '0xda47536f4cf256e50191b604727ee54fe0dbbdd8091c7bc47843495a0673a72b',
        chainId: 11155420,
      },
      claims: [
        {
          hash: '0x88cec4515a608259e8ddefb478ed9e15a672a4b91c1c57260aea5ef0be218e81',
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
    stubPolls([
      blancBody('synthetic.inflight-cross-chain-claim-pending'),
      blancBody('reads-intent-status.status-failed-cross-chain'),
    ])
    const pending = waitForExecution(config, result, false)
    const outcome = expect(pending).rejects.toBeInstanceOf(IntentFailedError)
    await vi.runAllTimersAsync()
    await outcome
  })
})
