import type { Address } from 'viem'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AuthProvider } from '../auth/provider'
import { fromCaip2, toCaip2 } from './caip2'
import { Orchestrator } from './client'
import { decodeChainIdRootMapFromWire, encodeChainIdsForWire } from './utils'

const USER_ADDRESS = '0x1111111111111111111111111111111111111111' as Address
const TOKEN_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address
const TOKEN_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address

const authProvider: AuthProvider = {
  getHeaders: async () => ({ Authorization: 'Bearer test' }),
  getSubmitHeaders: async () => ({ Authorization: 'Bearer test' }),
}

/**
 * Builds a fetch-like response object without depending on the runtime Response implementation.
 */
function jsonResponse(json: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: vi.fn(),
    },
    json: vi.fn().mockResolvedValue(json),
    text: vi.fn(),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CAIP-2 helpers', () => {
  test('encodes the affected chain-id fields for BLANC', () => {
    const encoded = encodeChainIdsForWire(
      {
        chainId: 1,
        sourceChainId: 137,
        destinationChainId: 8453,
        chainIds: [1, 137],
        allChainIds: ['1', '8453'],
        auxiliaryFunds: {
          1: {
            [TOKEN_A]: '10',
          },
        },
        preClaimExecutions: {
          137: [
            {
              to: TOKEN_A,
              value: '0',
              data: '0x',
            },
          ],
        },
        chainTokens: {
          8453: ['ETH', TOKEN_A],
        },
      },
      'blanc',
    )

    expect(encoded).toEqual({
      chainId: 'eip155:1',
      sourceChainId: 'eip155:137',
      destinationChainId: 'eip155:8453',
      chainIds: ['eip155:1', 'eip155:137'],
      allChainIds: ['eip155:1', 'eip155:8453'],
      auxiliaryFunds: {
        'eip155:1': {
          [TOKEN_A]: '10',
        },
      },
      preClaimExecutions: {
        'eip155:137': [
          {
            to: TOKEN_A,
            value: '0',
            data: '0x',
          },
        ],
      },
      chainTokens: {
        'eip155:8453': ['ETH', TOKEN_A],
      },
    })
  })

  test('decodes the /chains root map back to decimal keys', () => {
    const decoded = decodeChainIdRootMapFromWire(
      {
        'eip155:1': {
          chainId: 'eip155:1',
          chainIds: ['eip155:1', 'eip155:137'],
        },
        'eip155:8453': {
          destinationChainId: 'eip155:8453',
        },
      },
      'blanc',
    )

    expect(decoded).toEqual({
      '1': {
        chainId: '1',
        chainIds: ['1', '137'],
      },
      '8453': {
        destinationChainId: '8453',
      },
    })
  })

  test('rejects non-eip155 CAIP-2 inputs', () => {
    expect(() => fromCaip2('cosmos:1')).toThrow('Invalid CAIP-2 chain id')
    expect(() => fromCaip2('1')).toThrow('Invalid CAIP-2 chain id')
  })

  test('formats numeric chain ids as eip155 CAIP-2', () => {
    expect(toCaip2(8453)).toBe('eip155:8453')
  })
})

describe('Orchestrator BLANC client', () => {
  test('sends the BLANC version header and repeated portfolio params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        portfolio: [
          {
            tokenName: 'ETH',
            tokenDecimals: 18,
            balance: {
              locked: '0',
              unlocked: '5',
            },
            tokenChainBalance: [
              {
                chainId: 'eip155:1',
                tokenAddress: TOKEN_A,
                balance: {
                  locked: '0',
                  unlocked: '5',
                },
              },
            ],
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const orchestrator = new Orchestrator(
      'https://orchestrator.test',
      authProvider,
    )
    const portfolio = await orchestrator.getPortfolio(USER_ADDRESS, {
      chainIds: [1, 137],
      tokens: {
        1: [TOKEN_A],
        137: [TOKEN_B],
      },
    })

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `https://orchestrator.test/accounts/${USER_ADDRESS}/portfolio?chainIds=eip155%3A1&chainIds=eip155%3A137&tokens=eip155%3A1%3A${TOKEN_A}&tokens=eip155%3A137%3A${TOKEN_B}`,
    )
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer test',
      'x-api-version': '2026-04.blanc',
    })
    expect(portfolio[0].chains[0].chain).toBe(1)
  })

  test('encodes request bodies to CAIP-2 and decodes numeric response chain ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        intentOp: {
          elements: [
            {
              chainId: 'eip155:1',
              mandate: {
                destinationChainId: 'eip155:8453',
              },
            },
          ],
        },
        intentCost: {
          hasFulfilledAll: true,
          tokensReceived: [],
          sponsoredFee: {
            relayer: 0,
            protocol: 0,
          },
          tokensSpent: {
            'eip155:1': {
              [TOKEN_A]: {
                locked: '1',
                unlocked: '0',
                version: 1,
              },
            },
          },
          gasCost: {
            originChains: [{ chainId: 'eip155:1', gasUSD: 0.1 }],
            destination: { chainId: 'eip155:8453', gasUSD: 0.2 },
            totalUSD: 0.3,
          },
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const orchestrator = new Orchestrator(
      'https://orchestrator.test',
      authProvider,
    )
    const route = await orchestrator.getIntentRoute({
      destinationChainId: 8453,
      account: {
        address: USER_ADDRESS,
        accountType: 'EOA',
        setupOps: [],
        delegations: {
          1: { contract: TOKEN_A },
        },
      },
      destinationExecutions: [],
      tokenRequests: [],
      accountAccessList: {
        chainTokens: {
          1: ['ETH'],
        },
      },
      options: {
        topupCompact: false,
        auxiliaryFunds: {
          137: {
            [TOKEN_B]: 10n,
          },
        },
      },
      preClaimExecutions: {
        1: [
          {
            to: TOKEN_A,
            value: 0n,
            data: '0x',
          },
        ],
      },
    } as any)

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(options.body as string)).toMatchObject({
      destinationChainId: 'eip155:8453',
      account: {
        delegations: {
          'eip155:1': {
            contract: TOKEN_A,
          },
        },
      },
      accountAccessList: {
        chainTokens: {
          'eip155:1': ['ETH'],
        },
      },
      options: {
        auxiliaryFunds: {
          'eip155:137': {
            [TOKEN_B]: '10',
          },
        },
      },
      preClaimExecutions: {
        'eip155:1': [
          {
            to: TOKEN_A,
            value: '0',
            data: '0x',
          },
        ],
      },
    })
    expect(route.intentCost.gasCost?.originChains[0].chainId).toBe(1)
    expect(route.intentCost.gasCost?.destination.chainId).toBe(8453)
    expect(route.intentOp.elements[0].chainId).toBe('1')
    expect(route.intentOp.elements[0].mandate.destinationChainId).toBe('8453')
  })

  test('decodes intent-operation status chain ids back to numbers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'COMPLETED',
        destinationChainId: 'eip155:8453',
        userAddress: USER_ADDRESS,
        claims: [
          {
            depositId: '1',
            chainId: 'eip155:137',
            status: 'CLAIMED',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const orchestrator = new Orchestrator(
      'https://orchestrator.test',
      authProvider,
    )
    const status = await orchestrator.getIntentOpStatus(1n)

    expect(status.destinationChainId).toBe(8453)
    expect(status.claims[0].chainId).toBe(137)
  })
})
