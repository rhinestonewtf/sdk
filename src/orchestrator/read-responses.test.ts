import type { Address } from 'viem'
import { afterEach, expect, test, vi } from 'vitest'
import recorded from './__fixtures__/read-responses.json'
import { Orchestrator } from './client'

const ENDPOINT = 'https://example.test'
const auth = {
  getHeaders: async () => ({}),
  getSubmitHeaders: async () => ({}),
}
const client = new Orchestrator(ENDPOINT, auth, {
  'X-Api-Version': '2026-01.alps',
})
const byOperation = (operation: string) =>
  recorded.find((entry) => entry.operation === operation)!

function respond(operation: string) {
  const fixture = byOperation(operation)
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(fixture.blanc.body), {
        status: fixture.blanc.status,
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return { fixture, fetchMock }
}

function sent(
  operation: string,
  fetchMock: ReturnType<typeof respond>['fetchMock'],
) {
  const [url, init] = fetchMock.mock.calls[0]
  const request = byOperation(operation).blanc.request
  expect(url).toBe(`${ENDPOINT}${request.path}`)
  expect(init?.method ?? 'GET').toBe(request.method)
  const headers = init?.headers as Record<string, string>
  expect(headers['x-api-version']).toBe('2026-04.blanc')
  expect(
    Object.keys(headers).filter((key) => /api-version/i.test(key)),
  ).toHaveLength(1)
  expect(fetchMock).toHaveBeenCalledTimes(1)
}

afterEach(() => vi.unstubAllGlobals())

test('status reads preserve the recorded Alps result, including absent fill fields', async () => {
  const { fixture, fetchMock } = respond('status')
  const id = BigInt(fixture.alps.request.path.split('/').pop()!)
  expect(await client.getIntentOpStatus(id)).toStrictEqual(fixture.alps.body)
  sent('status', fetchMock)
})

test('a claims-only status has no destination or undefined fill keys', async () => {
  const account = '0x0000000000000000000000000000000000000001'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        status: 'PENDING',
        accountAddress: account,
        operations: [
          {
            chain: 'eip155:84532',
            items: [{ type: 'CLAIM', status: 'PENDING' }],
          },
        ],
      }),
    ),
  )
  // Alps exposes claims before a fill exists, without placeholder fill fields.
  expect(await client.getIntentOpStatus(1n)).toStrictEqual({
    status: 'PENDING',
    userAddress: account,
    claims: [{ chainId: 84532, status: 'PENDING' }],
  })
})

test('portfolio sends repeated CAIP-2 filters and maps balances to bigint', async () => {
  const { fixture, fetchMock } = respond('portfolio')
  const url = new URL(fixture.alps.request.path, ENDPOINT)
  const tokens: Record<number, Address[]> = {}
  for (const entry of url.searchParams.get('tokens')!.split(',')) {
    const [chain, token] = entry.split(':')
    ;(tokens[Number(chain)] ??= []).push(token as Address)
  }
  const result = await client.getPortfolio(
    url.pathname.split('/')[2] as Address,
    {
      chainIds: [84532, 11155420],
      tokens,
    },
  )
  expect(result).toStrictEqual([
    {
      symbol: 'USDC',
      decimals: 6,
      balances: { locked: 0n, unlocked: 2289131n },
      chains: [
        {
          chain: 84532,
          address: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
          locked: 0n,
          unlocked: 1789130n,
        },
        {
          chain: 11155420,
          address: '0x5fd84259d66cd46123540766be93dfe6d43130d7',
          locked: 0n,
          unlocked: 500001n,
        },
      ],
    },
  ])
  sent('portfolio', fetchMock)
})

test('splits send CAIP-2 chain and decimal tokens, returning bigint amounts', async () => {
  const { fixture, fetchMock } = respond('splits')
  const body = fixture.alps.request.body!
  const tokens = Object.fromEntries(
    Object.entries(body.tokens!).map(([token, amount]) => [
      token,
      BigInt(amount),
    ]),
  )
  expect(
    await client.splitIntents({ chain: { id: body.chainId } as never, tokens }),
  ).toEqual({
    intents: [
      { '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d': 1000000n },
      { '0x980b62da83eff3d4576c647993b0c1d7faf17c73': 1000000000000n },
    ],
  })
  expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual(
    fixture.blanc.request.body,
  )
  sent('splits', fetchMock)
})

test('app fee reads keep USD values unchanged', async () => {
  const { fixture, fetchMock } = respond('appFees')
  expect(await client.getAppFeeBalances()).toStrictEqual(fixture.alps.body)
  sent('appFees', fetchMock)
})
