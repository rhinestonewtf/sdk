import { afterEach, describe, expect, test, vi } from 'vitest'
import { createAuthProvider } from '../auth/provider'
import envelopes from './__fixtures__/error-envelopes.json'
import recorded from './__fixtures__/quote-responses.json'
import { Orchestrator } from './client'
import { OrchestratorError, UnsupportedChainIdError } from './error'
import type { IntentInput } from './types'

interface Recorded {
  status?: number
  body?: any
  request: Record<string, unknown>
}

const CASES = (
  recorded as unknown as {
    cases: { id: string; alps: Recorded; blanc: Recorded }[]
  }
).cases
const byId = (id: string) => CASES.find((c) => c.id === id)!
const envelope = (id: string) =>
  (
    envelopes as { id: string; blanc: { status: number; body: unknown } }[]
  ).find((e) => e.id === id)!.blanc

const ENDPOINT = 'https://example.test'
const apiKeyAuth = createAuthProvider({ apiKey: 'test-key' })

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function sentHeaders(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls[0][1]?.headers as Record<string, string>
}

async function rejection(promise: Promise<unknown>): Promise<any> {
  return promise.then(
    () => {
      throw new Error('expected the call to throw')
    },
    (error) => error,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createQuote', () => {
  const recordedCase = byId('planned/unfunded/nexus')
  const input = recordedCase.alps.request as unknown as IntentInput

  test('posts the blanc request to /quotes and decodes every route', async () => {
    const fetchMock = stubFetch(200, recordedCase.blanc.body)
    const quotes = await new Orchestrator(ENDPOINT, apiKeyAuth).createQuote(
      input,
    )
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${ENDPOINT}/quotes`)
    expect(init?.method).toBe('POST')
    expect(sentHeaders(fetchMock)['x-api-version']).toBe('2026-04.blanc')
    expect(sentHeaders(fetchMock)['x-api-key']).toBe('test-key')
    expect(JSON.parse(init?.body as string)).toStrictEqual(
      recordedCase.blanc.request,
    )
    expect(quotes.map((quote) => quote.intentId)).toEqual(
      recordedCase.blanc.body.routes.map(
        (route: { intentId: string }) => route.intentId,
      ),
    )
  })

  test.each(['x-api-version', 'X-Api-Version'])(
    'a custom %s header does not redirect the quote',
    async (name) => {
      const fetchMock = stubFetch(200, recordedCase.blanc.body)
      await new Orchestrator(ENDPOINT, apiKeyAuth, {
        [name]: '2026-01.alps',
        'x-other': 'kept',
      }).createQuote(input)
      const headers = sentHeaders(fetchMock)
      expect(headers['x-api-version']).toBe('2026-04.blanc')
      expect(
        Object.keys(headers).filter((key) => /api-version/i.test(key)),
      ).toHaveLength(1)
      expect(headers['x-other']).toBe('kept')
    },
  )

  test('an unknown destination chain is UnsupportedChainIdError', async () => {
    const { blanc } = byId('err/unsupported-chain')
    stubFetch(blanc.status!, blanc.body)
    const error = await rejection(
      new Orchestrator(ENDPOINT, apiKeyAuth).createQuote(
        byId('err/unsupported-chain').alps.request as unknown as IntentInput,
      ),
    )
    expect(error).toBeInstanceOf(UnsupportedChainIdError)
    expect(error.statusCode).toBe(400)
  })

  test('insufficient balance keeps its context', async () => {
    const { status, body } = envelope('quote-insufficient-balance-cross-chain')
    stubFetch(status, body)
    const error = await rejection(
      new Orchestrator(ENDPOINT, apiKeyAuth).createQuote(input),
    )
    expect(error).toBeInstanceOf(OrchestratorError)
    expect(error.message).toBe(
      'Insufficient balance after exhausting all candidates',
    )
    expect(error.statusCode).toBe(422)
    expect(error.context).toMatchObject({
      remaining: '8087343',
      requestedAmount: '10000000',
      code: 'INSUFFICIENT_BALANCE',
    })
  })
})

describe('createIntent', () => {
  const request = {
    intentId: '1',
    signatures: { origin: [], destination: '0x' },
  }

  test('posts to /intents with blanc headers', async () => {
    const fetchMock = stubFetch(201, { intentId: '1' })
    const result = await new Orchestrator(ENDPOINT, apiKeyAuth, {
      'X-API-VERSION': '2026-01.alps',
    }).createIntent(request, { intentInput: {}, isSponsored: false })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${ENDPOINT}/intents`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toStrictEqual(request)
    const headers = sentHeaders(fetchMock)
    expect(headers['x-api-version']).toBe('2026-04.blanc')
    expect(
      Object.keys(headers).filter((key) => /api-version/i.test(key)),
    ).toHaveLength(1)
    expect(headers['x-api-key']).toBe('test-key')
    expect(result).toEqual({ intentId: '1' })
  })

  test('JWT sponsored submits still carry the intent extension', async () => {
    const getIntentExtensionToken = vi.fn(async () => 'extension')
    const jwtAuth = createAuthProvider({
      auth: { mode: 'jwt', accessToken: 'access', getIntentExtensionToken },
    })
    const fetchMock = stubFetch(201, { intentId: '1' })
    const intentInput = { options: {} }
    await new Orchestrator(ENDPOINT, jwtAuth).createIntent(request, {
      intentInput,
      isSponsored: true,
    })
    const headers = sentHeaders(fetchMock)
    expect(getIntentExtensionToken).toHaveBeenCalledWith(intentInput)
    expect(headers['X-Intent-Extension']).toBe('Bearer extension')
    expect(headers.Authorization).toBe('Bearer access')
    expect(headers['x-api-version']).toBe('2026-04.blanc')
  })

  test('a refused signature keeps its simulation context', async () => {
    const { status, body } = envelope('submit-refused-signature')
    stubFetch(status, body)
    const error = await rejection(
      new Orchestrator(ENDPOINT, apiKeyAuth).createIntent(request),
    )
    expect(error).toBeInstanceOf(OrchestratorError)
    expect(error.statusCode).toBe(400)
    expect(error.context).toMatchObject({
      category: 'INVALID_SIGNATURE',
      errorName: 'InvalidSignature()',
      errorSelector: '0x8baa579f',
      retryable: false,
    })
  })
})

describe('legacy alps methods', () => {
  test('getIntentRoute still quotes on alps', async () => {
    const fetchMock = stubFetch(200, {})
    await new Orchestrator(ENDPOINT, apiKeyAuth).getIntentRoute(
      byId('planned/unfunded/nexus').alps.request as unknown as IntentInput,
    )
    expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/intents/route`)
    expect(sentHeaders(fetchMock)['x-api-version']).toBe('2026-01.alps')
  })

  test('submitIntent still sends no version', async () => {
    const fetchMock = stubFetch(200, { result: { id: '1' } })
    await new Orchestrator(ENDPOINT, apiKeyAuth).submitIntent(
      {} as any,
      false,
      { intentInput: {}, isSponsored: false },
    )
    expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/intent-operations`)
    expect(sentHeaders(fetchMock)).not.toHaveProperty('x-api-version')
  })
})
