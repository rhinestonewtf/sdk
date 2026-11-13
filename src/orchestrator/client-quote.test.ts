import { decodeJwt, exportJWK, generateKeyPair } from 'jose'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createAuthProvider } from '../auth/provider'
import {
  computeBlancIntentInputDigest,
  computeIntentInputDigest,
  createJwtSigner,
} from '../jwt-server'
import envelopes from './__fixtures__/error-envelopes.json'
import recorded from './__fixtures__/quote-responses.json'
import { Orchestrator } from './client'
import { OrchestratorError, UnsupportedChainIdError } from './error'
import type { IntentInput } from './types'
import { convertBigIntFields } from './utils'

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

  test('JWT submits use ordinary auth even with a sponsored policy context', async () => {
    const getIntentExtensionToken = vi.fn(async () => 'extension')
    const jwtAuth = createAuthProvider({
      auth: {
        mode: 'experimental_jwt',
        accessToken: 'access',
        getIntentExtensionToken,
      },
    })
    const fetchMock = stubFetch(201, { intentId: '1' })
    const intentInput = { options: {} }
    await new Orchestrator(ENDPOINT, jwtAuth).createIntent(request, {
      intentInput,
      isSponsored: true,
    })
    const headers = sentHeaders(fetchMock)
    expect(getIntentExtensionToken).not.toHaveBeenCalled()
    expect(headers).not.toHaveProperty('X-Intent-Extension')
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

describe('quote authentication lifecycle', () => {
  const fixture = byId('planned/unfunded/nexus')
  const sponsoredInput = (settings: unknown = { gasSponsored: true }) => {
    const input = structuredClone(
      fixture.alps.request,
    ) as unknown as IntentInput
    input.options = { ...input.options, sponsorSettings: settings as never }
    return input
  }
  const jwt = (
    getIntentExtensionToken?: (input: unknown) => Promise<string>,
    accessToken: string | (() => Promise<string>) = 'access',
  ) =>
    createAuthProvider({
      auth: { mode: 'experimental_jwt', accessToken, getIntentExtensionToken },
    })
  const deferred = <T>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }

  test.each([
    ['omitted', undefined, false],
    ['false', false, false],
    ['empty', {}, false],
    [
      'all false',
      {
        gasSponsored: false,
        bridgeFeesSponsored: false,
        swapFeesSponsored: false,
        protocolFeesSponsored: false,
      },
      false,
    ],
    ['gas', { gasSponsored: true }, true],
    ['bridge', { bridgeFeesSponsored: true }, true],
    ['swap', { swapFeesSponsored: true }, true],
    ['protocol', { protocolFeesSponsored: true }, true],
    [
      'all true',
      {
        gasSponsored: true,
        bridgeFeesSponsored: true,
        swapFeesSponsored: true,
        protocolFeesSponsored: true,
      },
      true,
    ],
    [
      'truthy is not true',
      { gasSponsored: 1, bridgeFeesSponsored: 'true' },
      false,
    ],
  ])(
    '%s sponsorship requests approval only for explicit true',
    async (_name, settings, expected) => {
      const approve = vi.fn(async () => 'extension')
      const fetchMock = stubFetch(200, fixture.blanc.body)
      const input = sponsoredInput(settings)
      // Passing undefined must not activate the helper's default sponsorship.
      input.options.sponsorSettings = settings as never
      await new Orchestrator(ENDPOINT, jwt(approve)).createQuote(input)
      expect(approve).toHaveBeenCalledTimes(expected ? 1 : 0)
      expect(sentHeaders(fetchMock)).toMatchObject({
        Authorization: 'Bearer access',
        'x-api-key': 'jwt',
        'x-api-version': '2026-04.blanc',
      })
      if (expected)
        expect(sentHeaders(fetchMock)['X-Intent-Extension']).toBe(
          'Bearer extension',
        )
      else
        expect(sentHeaders(fetchMock)).not.toHaveProperty('X-Intent-Extension')
    },
  )

  test('API keys and JWT without a callback still send sponsored quotes', async () => {
    for (const auth of [apiKeyAuth, jwt()]) {
      const fetchMock = stubFetch(200, fixture.blanc.body)
      await new Orchestrator(ENDPOINT, auth).createQuote(sponsoredInput())
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(sentHeaders(fetchMock)).not.toHaveProperty('X-Intent-Extension')
    }
  })

  test('provides the exact detached legacy payload, not the lowered wire input', async () => {
    const input = sponsoredInput()
    input.destinationGasUnits = 9007199254740993n
    input.account.mockSignature = '0x1234'
    input.accountAccessList = [
      {
        chainId: 8453,
        tokenAddress: '0x0000000000000000000000000000000000000001',
        amount: 9007199254740995n,
      },
    ]
    input.options.topupCompact = true
    const expected = convertBigIntFields(input)
    const approve = vi.fn(async (legacy: unknown) => {
      expect(legacy).toStrictEqual(expected)
      expect(legacy).not.toBe(input)
      expect((legacy as IntentInput).options).not.toBe(input.options)
      return 'extension'
    })
    const fetchMock = stubFetch(200, fixture.blanc.body)
    await new Orchestrator(ENDPOINT, jwt(approve)).createQuote(input)
    expect(approve).toHaveBeenCalledTimes(1)
    expect(input.destinationGasUnits).toBe(9007199254740993n)
    const wire = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(wire.destinationChainId).toBe(`eip155:${input.destinationChainId}`)
    expect(wire.destinationGasLimit).toBe('9007199254740993')
    expect(wire.options).not.toHaveProperty('topupCompact')
    expect(wire.account).not.toHaveProperty('mockSignature')
    expect(wire.options.sponsorSettings).toEqual({ gas: true })
  })

  test.each(['access', 'approval'])(
    'freezes wire and legacy snapshot before the %s await',
    async (waitAt) => {
      const input = sponsoredInput()
      const baselineFetch = stubFetch(200, fixture.blanc.body)
      await new Orchestrator(ENDPOINT, apiKeyAuth).createQuote(input)
      const baselineBody = baselineFetch.mock.calls[0][1]?.body
      const expectedLegacy = convertBigIntFields(input)
      const gate = deferred<string>()
      const entered = deferred<void>()
      const approve = vi.fn(async (legacy: unknown) => {
        expect(legacy).toStrictEqual(expectedLegacy)
        const copy = legacy as IntentInput
        copy.destinationChainId = 1
        copy.options.sponsorSettings!.gasSponsored = false
        if (waitAt === 'approval') {
          entered.resolve()
          return gate.promise
        }
        return 'extension'
      })
      const access = vi.fn(async () => {
        if (waitAt === 'access') {
          entered.resolve()
          return gate.promise
        }
        return 'access'
      })
      const fetchMock = stubFetch(200, fixture.blanc.body)
      const pending = new Orchestrator(
        ENDPOINT,
        jwt(approve, access),
      ).createQuote(input)
      await entered.promise
      expect(fetchMock).not.toHaveBeenCalled()
      input.destinationChainId = 10
      input.options.sponsorSettings!.gasSponsored = false
      input.account.address = '0x0000000000000000000000000000000000000002'
      gate.resolve(waitAt === 'access' ? 'access' : 'extension')
      await pending
      expect(fetchMock.mock.calls[0][1]?.body).toBe(baselineBody)
      expect(approve).toHaveBeenCalledTimes(1)
      expect(access).toHaveBeenCalledTimes(1)
      expect(input.destinationChainId).toBe(10)
    },
  )

  test('each quote gets fresh approval; submission and reads do not', async () => {
    const approve = vi.fn(async () => `extension-${approve.mock.calls.length}`)
    const access = vi.fn(async () => `access-${access.mock.calls.length}`)
    const client = new Orchestrator(ENDPOINT, jwt(approve, access))
    const fetchMock = stubFetch(200, fixture.blanc.body)
    const input = sponsoredInput()
    await client.createQuote(input)
    await client.createQuote(input)
    expect(
      fetchMock.mock.calls.map(
        ([, init]) =>
          (init?.headers as Record<string, string>)['X-Intent-Extension'],
      ),
    ).toEqual(['Bearer extension-1', 'Bearer extension-2'])
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ intentId: '1' })),
    )
    await client.createIntent(
      { intentId: '1', signatures: { origin: [], destination: '0x' } },
      { intentInput: input, isSponsored: true },
    )
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ withdrawableUsd: '0', pendingUsd: '0' })),
    )
    await client.getAppFeeBalances()
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ status: 'PENDING', operations: [] })),
    )
    await client.getIntentOpStatus(1n)
    expect(approve).toHaveBeenCalledTimes(2)
    expect(access).toHaveBeenCalledTimes(5)
    for (const [, init] of fetchMock.mock.calls.slice(2))
      expect(init?.headers).not.toHaveProperty('X-Intent-Extension')
  })

  test.each(['access', 'approval'])(
    '%s denial prevents quote fetch',
    async (stage) => {
      const denied = new Error('denied')
      const approve = vi.fn(async () => {
        throw denied
      })
      const access = vi.fn(async () => {
        if (stage === 'access') throw denied
        return 'access'
      })
      const fetchMock = stubFetch(200, fixture.blanc.body)
      await expect(
        new Orchestrator(ENDPOINT, jwt(approve, access)).createQuote(
          sponsoredInput(),
        ),
      ).rejects.toBe(denied)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(approve).toHaveBeenCalledTimes(stage === 'access' ? 0 : 1)
    },
  )

  test('failed planning consumes no cached approval and never falls back', async () => {
    const approve = vi.fn(async () => `extension-${approve.mock.calls.length}`)
    const fetchMock = stubFetch(403, { message: 'binding mismatch' })
    const client = new Orchestrator(ENDPOINT, jwt(approve))
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(client.createQuote(sponsoredInput())).rejects.toMatchObject({
        statusCode: 403,
      })
      expect(fetchMock).toHaveBeenCalledTimes(attempt + 1)
    }
    expect(approve).toHaveBeenCalledTimes(2)
    expect(
      fetchMock.mock.calls.map(
        ([, init]) =>
          (init?.headers as Record<string, string>)['X-Intent-Extension'],
      ),
    ).toEqual(['Bearer extension-1', 'Bearer extension-2'])
  })
})

describe('transport with actual JWT signer', () => {
  test.each([undefined, 'alps', 'blanc'] as const)(
    'binds apiVersion %s to the unchanged callback input',
    async (apiVersion) => {
      const fixture = byId('planned/unfunded/nexus')
      const input = structuredClone(
        fixture.alps.request,
      ) as unknown as IntentInput
      input.options = {
        ...input.options,
        sponsorSettings: { gasSponsored: true },
      }
      const original = structuredClone(input)
      const { privateKey } = await generateKeyPair('ES256', {
        extractable: true,
      })
      const signer = createJwtSigner({
        apiVersion,
        jwt: {
          privateKey: await exportJWK(privateKey),
          integratorId: 'integrator',
          projectId: 'project',
          appId: 'app',
          keyId: 'key',
        },
      })
      const approve = vi.fn(signer.getIntentExtensionToken)
      const client = new Orchestrator(
        ENDPOINT,
        createAuthProvider({
          auth: {
            mode: 'experimental_jwt',
            ...signer,
            getIntentExtensionToken: approve,
          },
        }),
      )
      const fetchMock = stubFetch(
        200,
        apiVersion === 'blanc' ? fixture.blanc.body : {},
      )
      if (apiVersion === 'blanc') {
        await client.createQuote(input)
      } else {
        await client.submitIntent({} as never, false, {
          intentInput: input,
          isSponsored: true,
        })
      }
      expect(approve).toHaveBeenCalledExactlyOnceWith(input)
      expect(input).toEqual(original)
      const rawDigest = await computeIntentInputDigest(input)
      const normalizedDigest = await computeBlancIntentInputDigest(input)
      expect(rawDigest).not.toBe(normalizedDigest)
      const token = sentHeaders(fetchMock)['X-Intent-Extension'].replace(
        'Bearer ',
        '',
      )
      expect(decodeJwt(token).policy).toEqual({
        sponsorship: {
          scope: 'intent',
          intent_input: {
            digest: apiVersion === 'blanc' ? normalizedDigest : rawDigest,
          },
        },
      })
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${ENDPOINT}/${apiVersion === 'blanc' ? 'quotes' : 'intent-operations'}`,
      )
    },
  )
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

  test('JWT Alps quotes remain ordinary and legacy submits still request approval', async () => {
    const approve = vi.fn(async () => 'legacy-extension')
    const auth = createAuthProvider({
      auth: {
        mode: 'experimental_jwt',
        accessToken: 'access',
        getIntentExtensionToken: approve,
      },
    })
    const client = new Orchestrator(ENDPOINT, auth)
    const fetchMock = stubFetch(200, {})
    const input = byId('planned/unfunded/nexus').alps
      .request as unknown as IntentInput
    await client.getIntentRoute(input)
    expect(approve).not.toHaveBeenCalled()
    expect(sentHeaders(fetchMock)).not.toHaveProperty('X-Intent-Extension')
    await client.submitIntent({} as never, false, {
      intentInput: input,
      isSponsored: true,
    })
    expect(approve).toHaveBeenCalledExactlyOnceWith(input)
    const headers = fetchMock.mock.calls[1][1]?.headers as Record<
      string,
      string
    >
    expect(headers['X-Intent-Extension']).toBe('Bearer legacy-extension')
    expect(headers).not.toHaveProperty('x-api-version')
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
