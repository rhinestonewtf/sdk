import { describe, expect, test, vi } from 'vitest'
import { createOrchestratorAuth } from './auth'
import type { SerializedIntentInput } from './public'

const address = '0x0000000000000000000000000000000000000001' as const
const intentInput = {
  account: { address, accountType: 'ERC7579' },
  destinationChainId: 1,
  destinationExecutions: [],
  tokenRequests: [],
  options: {},
} satisfies SerializedIntentInput

describe('orchestrator auth', () => {
  test('sends the configured api key on requests and quotes', async () => {
    const auth = createOrchestratorAuth({ kind: 'api-key', apiKey: 'secret' })

    expect(await auth.getHeaders()).toEqual({ 'x-api-key': 'secret' })
    expect(await auth.getQuoteHeaders(intentInput, true)).toEqual({
      'x-api-key': 'secret',
    })
    expect(auth.requestsIntentExtension(true)).toBe(false)
  })

  test('sends only the bearer credential in jwt mode', async () => {
    const auth = createOrchestratorAuth({
      kind: 'jwt',
      accessToken: 'access',
    })

    expect(await auth.getHeaders()).toEqual({ Authorization: 'Bearer access' })
    expect(await auth.getQuoteHeaders(intentInput, false)).toEqual({
      Authorization: 'Bearer access',
    })
  })

  test('adds the intent extension only for sponsored quotes', async () => {
    const getIntentExtensionToken = vi.fn(async () => 'extension')
    const auth = createOrchestratorAuth({
      kind: 'jwt',
      accessToken: async () => 'access',
      getIntentExtensionToken,
    })
    expect(auth.requestsIntentExtension(true)).toBe(true)
    expect(auth.requestsIntentExtension(false)).toBe(false)

    expect(await auth.getQuoteHeaders(intentInput, true)).toEqual({
      Authorization: 'Bearer access',
      'X-Intent-Extension': 'Bearer extension',
    })
    expect(getIntentExtensionToken).toHaveBeenCalledWith(intentInput)

    expect(await auth.getQuoteHeaders(intentInput, false)).toEqual({
      Authorization: 'Bearer access',
    })
    expect(getIntentExtensionToken).toHaveBeenCalledTimes(1)
  })

  test('omits the intent extension when no token getter is configured', async () => {
    const auth = createOrchestratorAuth({
      kind: 'jwt',
      accessToken: 'access',
    })

    expect(auth.requestsIntentExtension(true)).toBe(false)
    expect(await auth.getQuoteHeaders(intentInput, true)).toEqual({
      Authorization: 'Bearer access',
    })
  })

  test('resolves the access token on every request', async () => {
    const accessToken = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second')
    const auth = createOrchestratorAuth({ kind: 'jwt', accessToken })

    expect(await auth.getHeaders()).toEqual({ Authorization: 'Bearer first' })
    expect(await auth.getHeaders()).toEqual({ Authorization: 'Bearer second' })
    expect(accessToken).toHaveBeenCalledTimes(2)
  })
})
