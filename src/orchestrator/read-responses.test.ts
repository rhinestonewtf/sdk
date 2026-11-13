import type { Address } from 'viem'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { getIntentStatus } from '../execution'
import recorded from './__fixtures__/read-responses.json'
import { Orchestrator } from './client'
import type { IntentOpStatus } from './types'

// Real alps and blanc read responses recorded from the prod orchestrator for
// the same requests (plus derived status bodies, one per lowering branch).
// Every read must give exactly what v1 1.22.0 gives for the alps response.

interface RecordedRequest {
  method: string
  path: string
  body?: Record<string, unknown>
}

interface RecordedResponse {
  request?: RecordedRequest
  status: number
  body: any
}

interface ReadCase {
  id: string
  operation: 'status' | 'portfolio' | 'splits' | 'appFees'
  source: string
  alps: RecordedResponse
  blanc: RecordedResponse
}

const CASES = recorded as ReadCase[]
const SUCCESSES = CASES.filter((c) => c.alps.status < 400)

const authProvider = {
  getHeaders: async () => ({}),
  getSubmitHeaders: async () => ({}),
}

const ENDPOINT = 'https://example.test'

// Frozen copy of v1 1.22.0's read mapping, applied to the alps body.
function expected122(operation: ReadCase['operation'], body: any): unknown {
  switch (operation) {
    case 'status':
      return body
    case 'portfolio':
      return body.portfolio.map((token: any) => ({
        symbol: token.tokenName,
        decimals: token.tokenDecimals,
        balances: {
          locked: BigInt(token.balance.locked),
          unlocked: BigInt(token.balance.unlocked),
        },
        chains: token.tokenChainBalance.map((chain: any) => ({
          chain: chain.chainId,
          address: chain.tokenAddress,
          locked: BigInt(chain.balance.locked),
          unlocked: BigInt(chain.balance.unlocked),
        })),
      }))
    case 'splits':
      return {
        intents: body.intents.map((intent: Record<string, string>) =>
          Object.fromEntries(
            Object.entries(intent).map(([token, amount]) => [
              token,
              BigInt(amount),
            ]),
          ),
        ),
      }
    case 'appFees':
      return {
        withdrawableUsd: body.withdrawableUsd,
        pendingUsd: body.pendingUsd,
      }
  }
}

// The call arguments, recovered from the recorded alps request. Derived cases
// carry no request.
function callArgs(c: ReadCase) {
  const request = c.alps.request
  const url = new URL(request?.path ?? '/', ENDPOINT)
  switch (c.operation) {
    case 'status':
      return { intentId: BigInt(url.pathname.split('/').pop() || '1') }
    case 'portfolio': {
      const address = (url.pathname.split('/')[2] ??
        '0x0000000000000000000000000000000000000001') as Address
      const chainIds = url.searchParams.get('chainIds')
      const tokens = url.searchParams.get('tokens')
      if (chainIds === null && tokens === null) return { address }
      const filter: {
        chainIds?: number[]
        tokens?: Record<number, Address[]>
      } = {}
      if (chainIds !== null) {
        filter.chainIds = chainIds ? chainIds.split(',').map(Number) : []
      }
      if (tokens !== null) {
        filter.tokens = {}
        for (const entry of tokens.split(',')) {
          const [chainId, token] = entry.split(':')
          const list = (filter.tokens[Number(chainId)] ??= [])
          list.push(token as Address)
        }
      }
      return { address, filter }
    }
    case 'splits': {
      const body = request?.body ?? { chainId: 421614, tokens: {} }
      return {
        splits: {
          chain: { id: body.chainId } as any,
          tokens: Object.fromEntries(
            Object.entries(body.tokens as Record<string, string>).map(
              ([token, amount]) => [token, BigInt(amount)],
            ),
          ),
          ...(body.settlementLayers
            ? { settlementLayers: body.settlementLayers as any }
            : {}),
        },
      }
    }
    case 'appFees':
      return {}
  }
}

function call(orchestrator: Orchestrator, c: ReadCase): Promise<unknown> {
  const args = callArgs(c) as any
  switch (c.operation) {
    case 'status':
      return orchestrator.getIntentOpStatus(args.intentId)
    case 'portfolio':
      return orchestrator.getPortfolio(args.address, args.filter)
    case 'splits':
      return orchestrator.splitIntents(args.splits)
    case 'appFees':
      return orchestrator.getAppFeeBalances()
  }
}

function stubFetch(response: RecordedResponse) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(response.body), { status: response.status }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('read responses', () => {
  test.each(SUCCESSES.map((c) => [c.id, c] as const))(
    '%s gives the 1.22.0 result',
    async (_id, c) => {
      stubFetch(c.alps)
      const orchestrator = new Orchestrator(ENDPOINT, authProvider)
      const actual = await call(orchestrator, c)
      expect(actual).toStrictEqual(expected122(c.operation, c.alps.body))
    },
  )

  test.each(
    SUCCESSES.filter((c) => c.operation === 'status').map(
      (c) => [c.id, c] as const,
    ),
  )('%s gives the 1.22.0 public status', async (_id, c) => {
    stubFetch(c.alps)
    const alps = c.alps.body as IntentOpStatus
    const actual = await getIntentStatus(authProvider, ENDPOINT, 1n)
    expect(actual).toStrictEqual({
      status: alps.status,
      fill: {
        hash: alps.fillTransactionHash,
        chainId: alps.destinationChainId,
      },
      claims: alps.claims.map((claim) => ({
        hash: claim.claimTransactionHash,
        chainId: claim.chainId,
      })),
    })
  })
})
