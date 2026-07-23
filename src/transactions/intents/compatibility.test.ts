import { describe, expect, test } from 'vitest'
import type {
  OrchestratorIntentRequest,
  OrchestratorQuote,
} from '../../clients/orchestrator/types'
import {
  projectCompatibleIntentInput,
  projectCompatibleQuote,
} from './compatibility'

const address = '0x0000000000000000000000000000000000000001' as const

describe('intent compatibility projections', () => {
  test('projects request bigints as legacy decimal strings', () => {
    const request = {
      account: { address },
      destinationChainId: 1,
      destinationExecutions: [{ to: address, value: 2n, data: '0x' }],
      tokenRequests: [{ tokenAddress: address, amount: 3n }],
      options: { auxiliaryFunds: { 1: { [address]: 4n } } },
      preClaimExecutions: {
        1: [{ to: address, value: 5n, data: '0x12' }],
      },
    } satisfies OrchestratorIntentRequest

    expect(projectCompatibleIntentInput(request)).toEqual({
      account: { address },
      destinationChainId: 1,
      destinationExecutions: [{ to: address, value: '2', data: '0x' }],
      tokenRequests: [{ tokenAddress: address, amount: '3' }],
      options: { auxiliaryFunds: { 1: { [address]: '4' } } },
      preClaimExecutions: {
        1: [{ to: address, value: '5', data: '0x12' }],
      },
    })
    expect(request.destinationExecutions[0]?.value).toBe(2n)
  })

  test('projects only quote sign data back to its public wire shape', () => {
    const typedData = {
      domain: { chainId: 1, verifyingContract: address },
      types: {
        Root: [
          { name: 'count', type: 'uint256' },
          { name: 'items', type: 'Item[]' },
        ],
        Item: [{ name: 'delta', type: 'int32' }],
      },
      primaryType: 'Root',
      message: { count: 2n, items: [{ delta: -1n }] },
    } as const
    const quote = {
      intentId: 'intent',
      expiresAt: 1,
      estimatedFillTime: { seconds: 1 },
      settlementLayer: 'SAME_CHAIN',
      signData: { origin: [typedData], destination: typedData },
      cost: {
        input: [
          {
            chainId: 1,
            tokenAddress: address,
            symbol: 'ETH',
            decimals: 18,
            amount: 7n,
            price: { usd: 1 },
          },
        ],
        output: [],
        fees: {
          total: { usd: 0 },
          breakdown: {
            gas: { usd: 0 },
            bridge: { usd: 0 },
            swap: { usd: 0 },
            app: { usd: 0 },
            protocol: { usd: 0 },
          },
        },
      },
    } satisfies OrchestratorQuote

    const projected = projectCompatibleQuote(quote)

    expect(projected.signData.destination.message).toEqual({
      count: '2',
      items: [{ delta: '-1' }],
    })
    expect(projected.cost.input[0]?.amount).toBe(7n)
    expect(quote.signData.destination.message).toEqual({
      count: 2n,
      items: [{ delta: -1n }],
    })
  })
})
