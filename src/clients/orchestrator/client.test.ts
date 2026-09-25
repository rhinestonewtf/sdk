import { describe, expect, test, vi } from 'vitest'
import { UnsupportedSponsorshipApprovalError } from '../../errors/execution'
import { createOrchestratorAuth } from './auth'
import { createOrchestratorClient } from './client'
import type { RateLimitedError } from './errors'
import type { FetchPort } from './fetch'
import type { SerializedIntentInput } from './public'
import { projectSponsorshipApproval } from './sponsorship-approval'
import type { OrchestratorIntentRequest, OrchestratorQuote } from './types'

function bridgeFillOf(route: OrchestratorQuote | undefined) {
  return route?.purpose === 'execution' ? route.bridgeFill : undefined
}

const address = '0x0000000000000000000000000000000000000001' as const
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
const fees = {
  total: { usd: 0 },
  breakdown: {
    gas: { usd: 0, sponsored: false },
    bridge: { usd: 0, sponsored: false },
    swap: { usd: 0, sponsored: false },
    app: { usd: 0, sponsored: false },
    protocol: { usd: 0, sponsored: false },
    sponsorSurcharge: { usd: 0, sponsored: false },
  },
}

function route(overrides: Record<string, unknown> = {}) {
  return {
    intentId: 'intent-1',
    purpose: 'execution',
    expiresAt: 1,
    estimatedFillTime: { seconds: 2 },
    settlementLayer: 'SAME_CHAIN',
    plan: { source: [], destination: {}, deployments: [] },
    cost: { input: [], output: [], fees },
    requirements: [],
    signingRequests: [],
    ...overrides,
  }
}

function quoted(routes: unknown[], init?: ResponseInit) {
  return new Response(JSON.stringify({ status: 'quoted', routes }), init)
}

const request: OrchestratorIntentRequest = {
  account: { evm: { type: 'erc7579', address, signatureMode: 1 } },
  destination: {
    vm: 'evm',
    chainId: 'eip155:10',
    tokenRequests: [],
    execution: { calls: [{ to: address, value: 2n, data: '0x' }] },
  },
  source: {
    selection: {
      chains: { only: ['eip155:1'] },
      tokens: { only: [address] },
      perChain: { 'eip155:1': { tokens: { only: [address] } } },
    },
    limits: [{ chainId: 'eip155:1', tokenAddress: address, maxAmount: 4n }],
    auxiliaryFunds: { 'eip155:1': { [address]: 3n } },
  },
}

function client(fetch: FetchPort) {
  return createOrchestratorClient({
    url: 'https://orchestrator.example',
    auth: createOrchestratorAuth({ kind: 'api-key', apiKey: 'secret' }),
    headers: { 'x-custom': 'value' },
    fetch,
  })
}

describe('orchestrator client', () => {
  test('sends the Caucasus envelope, version header and auth, and folds the trace id', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          account: { evm: { type: 'erc7579', address, signatureMode: 1 } },
          destination: {
            vm: 'evm',
            chainId: 'eip155:10',
            tokenRequests: [],
            execution: { calls: [{ to: address, value: '2', data: '0x' }] },
          },
          source: {
            selection: {
              chains: { only: ['eip155:1'] },
              tokens: { only: [address] },
              perChain: { 'eip155:1': { tokens: { only: [address] } } },
            },
            limits: [
              { chainId: 'eip155:1', tokenAddress: address, maxAmount: '4' },
            ],
            auxiliaryFunds: { 'eip155:1': { [address]: '3' } },
          },
        })
        return quoted(
          [
            route({
              requirements: [
                {
                  kind: 'erc20Approval',
                  vm: 'evm',
                  chainId: 'eip155:1',
                  account: { address, type: 'erc7579' },
                  tokenAddress: address,
                  amount: '4',
                  spender: address,
                },
              ],
              cost: {
                input: [
                  {
                    chainId: 'eip155:1',
                    tokenAddress: address,
                    symbol: 'TEST',
                    decimals: 18,
                    price: { usd: 2 },
                    amount: '3',
                  },
                ],
                output: [],
                fees,
              },
            }),
          ],
          { headers: { 'x-trace-id': 'trace-1' } },
        )
      },
    )

    const result = await client(fetch).createQuote(request)

    expect(result.traceId).toBe('trace-1')
    expect(result.routes[0]?.cost.input).toEqual([
      {
        chainId: 'eip155:1',
        tokenAddress: address,
        symbol: 'TEST',
        decimals: 18,
        price: { usd: 2 },
        amount: 3n,
      },
    ])
    expect(result.routes[0]?.requirements[0]).toMatchObject({
      kind: 'erc20Approval',
      amount: 4n,
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://orchestrator.example/quotes',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'secret',
          'x-custom': 'value',
          'x-api-version': '2026-09.caucasus',
        }),
      }),
    )
  })

  test('submits the intent id and ordered proofs, and never the intent extension', async () => {
    const accessToken = vi.fn(async () => 'access')
    const extension = vi.fn(async () => 'extension')
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer access' })
        expect(init?.headers).not.toHaveProperty('X-Intent-Extension')
        expect(init?.headers).not.toHaveProperty('x-api-key')
        const body = JSON.parse(String(init?.body))
        expect(body).toEqual({
          intentId: 'intent-1',
          proofs: [
            { kind: 'eip712', signature: '0xaa' },
            {
              kind: 'eip7702',
              nonce: 3,
              signature: { r: '0x01', s: '0x02', yParity: 1 },
            },
          ],
        })
        // No legacy role-keyed signature or authorization bags.
        expect(body).not.toHaveProperty('signatures')
        expect(body).not.toHaveProperty('authorizations')
        return Response.json({ intentId: 'intent-1' })
      },
    )
    const jwtClient = createOrchestratorClient({
      url: 'https://orchestrator.example',
      auth: createOrchestratorAuth({
        kind: 'jwt',
        accessToken,
        getIntentExtensionToken: extension,
      }),
      fetch,
    })

    const submitted = await jwtClient.submitIntent({
      intentId: 'intent-1',
      proofs: [
        { kind: 'eip712', signature: '0xaa' },
        {
          kind: 'eip7702',
          nonce: 3,
          signature: { r: '0x01', s: '0x02', yParity: 1 },
        },
      ],
    })

    expect(submitted.intentId).toBe('intent-1')
    expect(fetch).toHaveBeenCalledOnce()
    expect(accessToken).toHaveBeenCalledOnce()
    expect(extension).not.toHaveBeenCalled()
  })

  describe('quote-time sponsorship approval', () => {
    // Exactly what `projectSponsorshipApproval` derives from `request`.
    const boundInput = {
      account: { address, accountType: 'ERC7579', setupOps: [] },
      destinationChainId: 10,
      destinationExecutions: [{ to: address, value: '2', data: '0x' }],
      tokenRequests: [],
      accountAccessList: { chainTokenAmounts: { 1: { [address]: '4' } } },
      options: { signatureMode: 1, auxiliaryFunds: { 1: { [address]: '3' } } },
    } satisfies SerializedIntentInput

    function jwtClient(getIntentExtensionToken?: () => Promise<string>) {
      const fetch = vi.fn(
        async (_url: string | URL | Request, _init?: RequestInit) =>
          quoted([route()]),
      )
      const client = createOrchestratorClient({
        url: 'https://orchestrator.example',
        auth: createOrchestratorAuth({
          kind: 'jwt',
          accessToken: 'access',
          ...(getIntentExtensionToken ? { getIntentExtensionToken } : {}),
        }),
        fetch,
      })
      return { client, fetch }
    }

    test('presents the grant with a sponsored quote, over the body it sends', async () => {
      const extension = vi.fn(async () => 'extension')
      const { client, fetch } = jwtClient(extension)

      await client.createQuote(request, {
        intentInput: boundInput,
        sponsored: true,
      })

      expect(extension).toHaveBeenCalledOnce()
      expect(extension).toHaveBeenCalledWith(boundInput)
      const [url, init] = fetch.mock.calls[0]!
      expect(url).toBe('https://orchestrator.example/quotes')
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer access',
        'X-Intent-Extension': 'Bearer extension',
      })
      expect(
        projectSponsorshipApproval(JSON.parse(String(init?.body))),
      ).toEqual(boundInput)
    })

    test('neither checks nor presents a grant for an unsponsored quote or without a getter', async () => {
      // A mismatching input proves the guard does not run on these paths.
      const unbound = { ...boundInput, destinationChainId: 1 }
      const extension = vi.fn(async () => 'extension')
      const unsponsored = jwtClient(extension)
      await unsponsored.client.createQuote(request, {
        intentInput: unbound,
        sponsored: false,
      })
      const withoutGetter = jwtClient()
      await withoutGetter.client.createQuote(request, {
        intentInput: unbound,
        sponsored: true,
      })
      const apiKey = vi.fn(async () => quoted([route()]))
      await client(apiKey).createQuote(request, {
        intentInput: unbound,
        sponsored: true,
      })

      expect(extension).not.toHaveBeenCalled()
      for (const fetch of [unsponsored.fetch, withoutGetter.fetch]) {
        expect(fetch).toHaveBeenCalledOnce()
        expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
          'X-Intent-Extension',
        )
      }
      expect(apiKey).toHaveBeenCalledOnce()
    })

    test.each([
      [
        'an approval input that differs from the body',
        request,
        { ...boundInput, destinationChainId: 1 },
        { reason: 'mismatch', field: 'destinationChainId' },
      ],
      [
        'a body the approval input cannot represent',
        { ...request, options: { selectionStrategy: 'cheapest' } },
        boundInput,
        { reason: 'unsupported', field: 'options.selectionStrategy' },
      ],
    ] as const)(
      'refuses %s before asking for a grant or quoting',
      async (_label, body, intentInput, context) => {
        const extension = vi.fn(async () => 'extension')
        const { client, fetch } = jwtClient(extension)

        const quote = client.createQuote(body as OrchestratorIntentRequest, {
          intentInput,
          sponsored: true,
        })

        await expect(quote).rejects.toBeInstanceOf(
          UnsupportedSponsorshipApprovalError,
        )
        await expect(quote).rejects.toMatchObject({ context })
        expect(extension).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
      },
    )

    test('stops on a denied grant without quoting', async () => {
      const denied = new Error('denied')
      const { client, fetch } = jwtClient(async () => {
        throw denied
      })

      await expect(
        client.createQuote(request, {
          intentInput: boundInput,
          sponsored: true,
        }),
      ).rejects.toBe(denied)
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  test('maps the LZ handle and keeps a route the SDK predates untracked', async () => {
    const result = await client(async () =>
      quoted([
        route({
          intentId: 'intent-lz',
          settlementLayer: 'LZ',
          bridgeFill: {
            type: 'LZ',
            destinationChainId: 'eip155:8453',
            quoteId: 'quote-1',
            dstChainKey: 'base',
            routeTypes: ['STARGATE_V2_TAXI', 'CCTP_V2'],
            fillExpirationPeriod: 60,
            fillStatusTimeout: 30,
          },
        }),
        route({
          intentId: 'intent-future',
          settlementLayer: 'FUTURE',
          bridgeFill: {
            type: 'FUTURE',
            destinationChainId: 'eip155:8453',
            someHandle: 'handle-1',
            fillStatusTimeout: 30,
          },
        }),
      ]),
    ).createQuote(request)

    expect(bridgeFillOf(result.routes[0])).toMatchObject({
      type: 'LZ',
      destinationChainId: 'eip155:8453',
      quoteId: 'quote-1',
      routeTypes: ['STARGATE_V2_TAXI', 'CCTP_V2'],
    })
    // An unknown layer costs the tracking handle, never the quote.
    expect(result.routes[1]?.intentId).toBe('intent-future')
    expect(result.routes[1]).not.toHaveProperty('bridgeFill')
  })

  test('keeps mixed-namespace cost legs and provider ids for a Solana route', async () => {
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const result = await client(async () =>
      quoted([
        route({
          settlementLayer: 'ECO',
          cost: {
            input: [
              {
                chainId: SOLANA,
                tokenAddress: mint,
                symbol: 'USDC',
                decimals: 6,
                price: { usd: 1 },
                amount: '101000',
              },
            ],
            output: [
              {
                chainId: 'eip155:8453',
                tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
                symbol: 'USDC',
                decimals: 6,
                price: { usd: 1 },
                amount: '100000',
              },
            ],
            fees,
          },
          bridgeFill: {
            type: 'ECO',
            destinationChainId: SOLANA,
            providerDestinationChainId: 1399811149,
            intentHash: `0x${'35'.repeat(32)}`,
            fillStatusTimeout: 14400,
          },
        }),
      ]),
    ).createQuote(request)

    // The provider's own id for the delivery chain is the only handle that
    // resolves a Solana fill with Eco, and it is opaque metadata — distinct
    // from the public CAIP-2 chain id beside it.
    expect(bridgeFillOf(result.routes[0])).toMatchObject({
      destinationChainId: SOLANA,
      providerDestinationChainId: 1399811149,
    })
    expect(result.routes[0]?.cost.input[0]).toMatchObject({
      chainId: SOLANA,
      tokenAddress: mint,
      amount: 101000n,
    })
  })

  test('asks for full status details only when requested', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        intentId: 'intent-1',
        purpose: 'execution',
        status: 'COMPLETED',
        operations: [],
        refunds: [],
      }),
    )
    const statusClient = client(fetch)

    await statusClient.getIntentStatus('intent-1')
    expect(fetch).toHaveBeenLastCalledWith(
      'https://orchestrator.example/intents/intent-1',
      expect.anything(),
    )

    await statusClient.getIntentStatus('intent-1', { full: true })
    expect(fetch).toHaveBeenLastCalledWith(
      'https://orchestrator.example/intents/intent-1?full=true',
      expect.anything(),
    )
  })

  test('maps error envelope metadata', async () => {
    const errorClient = client(
      async () =>
        new Response(
          JSON.stringify({ code: 'TOO_MANY_REQUESTS', message: 'slow' }),
          {
            status: 429,
            headers: { 'retry-after': '3', 'x-trace-id': 'trace-error' },
          },
        ),
    )

    await expect(errorClient.getIntentStatus('intent-1')).rejects.toMatchObject(
      {
        message: 'slow',
        statusCode: 429,
        code: 'TOO_MANY_REQUESTS',
        retryAfter: '3',
        traceId: 'trace-error',
      } satisfies Partial<RateLimitedError>,
    )
  })
})
