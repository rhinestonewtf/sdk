import { afterEach, expect, test, vi } from 'vitest'
import { createAuthProvider } from '../auth/provider'
import { Orchestrator } from './client'
import type { IntentInput, SignedIntentOp } from './types'

afterEach(() => vi.unstubAllGlobals())

test('legacy routing and submission retain their endpoints and approval timing', async () => {
  const events: string[] = []
  const extension = vi.fn(async () => {
    events.push('approval')
    return 'extension'
  })
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    events.push('fetch')
    return new Response('{}', { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  const auth = createAuthProvider({
    auth: {
      mode: 'jwt',
      accessToken: 'access',
      getIntentExtensionToken: extension,
    },
  })
  const client = new Orchestrator('https://example.test', auth)
  const input = { amount: 12n } as unknown as IntentInput
  await client.getIntentRoute(input)
  expect(events).toEqual(['fetch'])
  expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/intents/route')
  expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
    'x-api-version': '2026-01.alps',
  })
  expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
    amount: '12',
  })

  const signed = { nonce: 4n } as unknown as SignedIntentOp
  await client.submitIntent(signed, true, {
    intentInput: input,
    isSponsored: true,
  })
  expect(events).toEqual(['fetch', 'approval', 'fetch'])
  expect(extension).toHaveBeenCalledWith(input)
  expect(fetchMock.mock.calls[1][0]).toBe(
    'https://example.test/intent-operations',
  )
  expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
    'X-Intent-Extension': 'Bearer extension',
  })
  expect(
    (fetchMock.mock.calls[1][1]?.headers as Record<string, string>)[
      'x-api-version'
    ],
  ).toBeUndefined()
  expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
    signedIntentOp: { nonce: '4', options: { dryRun: true } },
  })
})
