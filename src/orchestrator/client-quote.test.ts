import { hashTypedData, type TypedDataDefinition } from 'viem'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createAuthProvider } from '../auth/provider'
import envelopes from './__fixtures__/error-envelopes.json'
import recorded from './__fixtures__/quote-responses.json'
import { Orchestrator } from './client'
import { OrchestratorError, UnsupportedChainIdError } from './error'
import type { IntentInput } from './types'
import { convertBigIntFields } from './utils'
import type { BlancRoute } from './wire-quote'

// First route of a recorded production pair, unchanged; local replay catalogs are omitted.
const fixture = recorded.cases[0]
const input = fixture.alps.request as unknown as IntentInput
const ENDPOINT = 'https://example.test'
const apiKeyAuth = createAuthProvider({ apiKey: 'test-key' })
const submit = { intentId: '1', signatures: { origin: [], destination: '0x' } }

function stubFetch(status = 200, body: unknown = fixture.blanc.body) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function headers(fetchMock: ReturnType<typeof stubFetch>, index = 0) {
  return fetchMock.mock.calls[index][1]?.headers as Record<string, string>
}

function jwt(
  getIntentExtensionToken?: (input: unknown) => Promise<string>,
  accessToken: string | (() => Promise<string>) = 'access',
) {
  return createAuthProvider({
    auth: { mode: 'experimental_jwt', accessToken, getIntentExtensionToken },
  })
}

function sponsoredInput(): IntentInput {
  const copy = structuredClone(input)
  copy.options.sponsorSettings = { gasSponsored: true }
  return copy
}

afterEach(() => vi.unstubAllGlobals())

describe('Blanc quote and submit boundary', () => {
  test('posts the recorded wire request, pins version and maps signing data and costs', async () => {
    const body = structuredClone(fixture.blanc.body)
    body.routes.push({ ...body.routes[0], intentId: 'second-route' })
    const fetchMock = stubFetch(200, body)
    const quotes = await new Orchestrator(ENDPOINT, apiKeyAuth, {
      'X-Api-Version': '2026-01.alps',
      'x-other': 'kept',
    }).createQuote(input)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${ENDPOINT}/quotes`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toStrictEqual(
      fixture.blanc.request,
    )
    expect(headers(fetchMock)).toMatchObject({
      'x-api-version': '2026-04.blanc',
      'x-api-key': 'test-key',
      'x-other': 'kept',
    })
    expect(
      Object.keys(headers(fetchMock)).filter((key) => /api-version/i.test(key)),
    ).toHaveLength(1)
    const route = fixture.blanc.body.routes[0]
    expect(quotes.map((quote) => quote.intentId)).toEqual(
      body.routes.map((route) => route.intentId),
    )
    expect(quotes[0]).toMatchObject({
      expiresAt: route.expiresAt,
      settlementLayer: route.settlementLayer,
      cost: { fees: route.cost.fees },
    })
    expect(hashTypedData(quotes[0].signData.origin[0])).toBe(
      hashTypedData(route.signData.origin[0] as unknown as TypedDataDefinition),
    )
    expect(quotes[0].signData.origin[0]).not.toHaveProperty('kind')
    expect(
      typeof (quotes[0].signData.origin[0].message as { nonce: unknown }).nonce,
    ).toBe('bigint')
    expect(quotes[0].cost.input[0]).toMatchObject({
      chainId: 84532,
      amount: BigInt(route.cost.input[0].amount),
    })
  })

  test('EOA approval requirements keep bigint amounts and the permit digest', async () => {
    // EIP-2612 permit shape, with uints serialized as Blanc decimal strings.
    const token = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
    const spender = '0x000000000022d473030f116ddee9f6b43ac78ba3'
    const permit = {
      domain: {
        name: 'USDC',
        version: '2',
        chainId: 84532,
        verifyingContract: token,
      },
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      message: {
        owner: input.account.address,
        spender,
        value: '9007199254740993',
        nonce: '0',
        deadline: '1794543125',
      },
    } as unknown as TypedDataDefinition
    const body: { routes: BlancRoute[] } = structuredClone(fixture.blanc.body)
    body.routes[0].tokenRequirements = {
      'eip155:84532': {
        [token]: {
          type: 'approval',
          amount: '9007199254740993',
          spender,
          permit,
        },
      },
    }
    stubFetch(200, body)
    const [quote] = await new Orchestrator(ENDPOINT, apiKeyAuth).createQuote(
      input,
    )
    const requirement = quote.tokenRequirements![84532][token]
    expect(requirement).toMatchObject({
      type: 'approval',
      amount: 9007199254740993n,
      spender,
    })
    const normalized = (requirement as { permit: TypedDataDefinition }).permit
    expect(normalized.message).toMatchObject({
      value: 9007199254740993n,
      nonce: 0n,
      deadline: 1794543125n,
    })
    expect(hashTypedData(normalized)).toBe(hashTypedData(permit))
  })

  test('unsupported signing data fails closed', async () => {
    const body = structuredClone(fixture.blanc.body)
    const route = body.routes[0]
    Object.assign(route.signData, {
      origin: [{ kind: 'personalSign', message: 'x' }],
    })
    stubFetch(200, body)
    await expect(
      new Orchestrator(ENDPOINT, apiKeyAuth).createQuote(input),
    ).rejects.toThrow(
      'non-EVM origin payloads are not supported by this SDK version',
    )
  })

  test('unknown quote chains keep their specialized error', async () => {
    const response = envelopes.find(
      (entry) => entry.id === 'quote-unsupported-chain',
    )!.blanc
    stubFetch(response.status, response.body)
    await expect(
      new Orchestrator(ENDPOINT, apiKeyAuth).createQuote(input),
    ).rejects.toBeInstanceOf(UnsupportedChainIdError)
  })

  test('balance and signature failures retain actionable context', async () => {
    for (const [id, call, context] of [
      [
        'quote-insufficient-balance-cross-chain',
        () => new Orchestrator(ENDPOINT, apiKeyAuth).createQuote(input),
        {
          remaining: '8087343',
          requestedAmount: '10000000',
          code: 'INSUFFICIENT_BALANCE',
        },
      ],
      [
        'submit-refused-signature',
        () => new Orchestrator(ENDPOINT, apiKeyAuth).createIntent(submit),
        {
          category: 'INVALID_SIGNATURE',
          errorSelector: '0x8baa579f',
          retryable: false,
        },
      ],
    ] as const) {
      const response = envelopes.find((entry) => entry.id === id)!.blanc
      stubFetch(response.status, response.body)
      const error = await call().catch((error) => error)
      expect(error).toBeInstanceOf(OrchestratorError)
      expect(error).toMatchObject({ statusCode: response.status, context })
    }
  })

  test('submits pin Blanc and use ordinary JWT auth even with sponsored context', async () => {
    const approve = vi.fn(async () => 'extension')
    const fetchMock = stubFetch(201, { intentId: '1' })
    const result = await new Orchestrator(ENDPOINT, jwt(approve), {
      'X-API-VERSION': '2026-01.alps',
    }).createIntent(submit, { intentInput: input, isSponsored: true })
    expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/intents`)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual(
      submit,
    )
    expect(headers(fetchMock)).toMatchObject({
      Authorization: 'Bearer access',
      'x-api-version': '2026-04.blanc',
    })
    expect(
      Object.keys(headers(fetchMock)).filter((key) => /api-version/i.test(key)),
    ).toHaveLength(1)
    expect(headers(fetchMock)).not.toHaveProperty('X-Intent-Extension')
    expect(approve).not.toHaveBeenCalled()
    expect(result).toEqual({ intentId: '1' })
  })
})

describe('quote approval lifecycle', () => {
  test.each([false, true])(
    'only explicit sponsorship (%s) requests approval',
    async (enabled) => {
      const approve = vi.fn(async () => 'extension')
      const fetchMock = stubFetch()
      const copy = sponsoredInput()
      copy.options.sponsorSettings = { gasSponsored: enabled }
      await new Orchestrator(ENDPOINT, jwt(approve)).createQuote(copy)
      expect(approve).toHaveBeenCalledTimes(enabled ? 1 : 0)
      expect(headers(fetchMock).Authorization).toBe('Bearer access')
      expect(headers(fetchMock)['X-Intent-Extension']).toBe(
        enabled ? 'Bearer extension' : undefined,
      )
    },
  )

  test('approval sees detached legacy input, not lowered CAIP-2/bigint wire input', async () => {
    const copy = sponsoredInput()
    copy.destinationGasUnits = 9007199254740993n
    copy.account.mockSignature = '0x1234'
    copy.options.topupCompact = true
    const expected = convertBigIntFields(copy)
    const approve = vi.fn(async (legacy: unknown) => {
      expect(legacy).toStrictEqual(expected)
      expect(legacy).not.toBe(copy)
      ;(legacy as IntentInput).destinationChainId = 1
      return 'extension'
    })
    const fetchMock = stubFetch()
    await new Orchestrator(ENDPOINT, jwt(approve)).createQuote(copy)
    const wire = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(wire.destinationChainId).toBe(`eip155:${copy.destinationChainId}`)
    expect(wire.destinationGasLimit).toBe('9007199254740993')
    expect(wire.options).not.toHaveProperty('topupCompact')
    expect(wire.account).not.toHaveProperty('mockSignature')
    expect(wire.options.sponsorSettings).toEqual({ gas: true })
    expect(copy.destinationGasUnits).toBe(9007199254740993n)
  })

  test('captures the wire and approval snapshots before awaiting access auth', async () => {
    const copy = sponsoredInput()
    const expectedLegacy = convertBigIntFields(copy)
    let release!: (token: string) => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const access = () => {
      entered()
      return new Promise<string>((resolve) => {
        release = resolve
      })
    }
    const approve = vi.fn(async (legacy: unknown) => {
      expect(legacy).toStrictEqual(expectedLegacy)
      ;(legacy as IntentInput).destinationChainId = 1
      return 'extension'
    })
    const fetchMock = stubFetch()
    const pending = new Orchestrator(
      ENDPOINT,
      jwt(approve, access),
    ).createQuote(copy)
    await started
    expect(fetchMock).not.toHaveBeenCalled()
    copy.destinationChainId = 10
    copy.options.sponsorSettings!.gasSponsored = false
    release('access')
    await pending
    const wire = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(wire.destinationChainId).toBe(`eip155:${input.destinationChainId}`)
    expect(wire.options.sponsorSettings).toEqual({ gas: true })
    expect(approve).toHaveBeenCalledTimes(1)
  })

  test('each quote gets fresh approval; submission and reads do not', async () => {
    const approve = vi.fn(async () => `extension-${approve.mock.calls.length}`)
    const access = vi.fn(async () => `access-${access.mock.calls.length}`)
    const client = new Orchestrator(ENDPOINT, jwt(approve, access))
    const fetchMock = stubFetch()
    await client.createQuote(sponsoredInput())
    await client.createQuote(sponsoredInput())
    expect([
      headers(fetchMock, 0)['X-Intent-Extension'],
      headers(fetchMock, 1)['X-Intent-Extension'],
    ]).toEqual(['Bearer extension-1', 'Bearer extension-2'])
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ intentId: '1' })),
    )
    await client.createIntent(submit, { intentInput: input, isSponsored: true })
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ withdrawableUsd: '0', pendingUsd: '0' })),
    )
    await client.getAppFeeBalances()
    expect(approve).toHaveBeenCalledTimes(2)
    expect(access).toHaveBeenCalledTimes(4)
    for (const [, init] of fetchMock.mock.calls.slice(2))
      expect(init?.headers).not.toHaveProperty('X-Intent-Extension')
  })

  test.each(['access', 'approval'])(
    '%s denial prevents fetch',
    async (stage) => {
      const denied = new Error('denied')
      const approve = vi.fn(async () => {
        throw denied
      })
      const access = vi.fn(async () => {
        if (stage === 'access') throw denied
        return 'access'
      })
      const fetchMock = stubFetch()
      await expect(
        new Orchestrator(ENDPOINT, jwt(approve, access)).createQuote(
          sponsoredInput(),
        ),
      ).rejects.toBe(denied)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(approve).toHaveBeenCalledTimes(stage === 'access' ? 0 : 1)
    },
  )

  test('failed planning never falls back or reuses approval', async () => {
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
    expect([
      headers(fetchMock, 0)['X-Intent-Extension'],
      headers(fetchMock, 1)['X-Intent-Extension'],
    ]).toEqual(['Bearer extension-1', 'Bearer extension-2'])
  })
})

describe('legacy Alps methods', () => {
  test('quotes stay ordinary Alps; legacy submits still request approval without a version', async () => {
    const approve = vi.fn(async () => 'legacy-extension')
    const client = new Orchestrator(ENDPOINT, jwt(approve))
    const fetchMock = stubFetch(200, {})
    await client.getIntentRoute(input)
    expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/intents/route`)
    expect(headers(fetchMock)['x-api-version']).toBe('2026-01.alps')
    expect(approve).not.toHaveBeenCalled()
    expect(headers(fetchMock)).not.toHaveProperty('X-Intent-Extension')
    await client.submitIntent({} as never, false, {
      intentInput: input,
      isSponsored: true,
    })
    expect(approve).toHaveBeenCalledExactlyOnceWith(input)
    expect(fetchMock.mock.calls[1][0]).toBe(`${ENDPOINT}/intent-operations`)
    expect(headers(fetchMock, 1)['X-Intent-Extension']).toBe(
      'Bearer legacy-extension',
    )
    expect(headers(fetchMock, 1)).not.toHaveProperty('x-api-version')
  })
})
