import type { Address } from 'viem'
import { describe, expect, test } from 'vitest'
import { buildIntentSource } from './source'

const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Address
const WETH = '0x4200000000000000000000000000000000000006' as Address
const BASE = 'eip155:8453'
const ARBITRUM = 'eip155:42161'

describe('buildIntentSource', () => {
  test('returns nothing when the intent restricts nothing', () => {
    expect(buildIntentSource({})).toBeUndefined()
  })

  test('maps explicit source chains to a chain allowlist, leaving tokens open', () => {
    expect(buildIntentSource({ policy: { chainIds: [8453, 42161] } })).toEqual({
      selection: {
        chains: { only: [BASE, ARBITRUM] },
        tokens: 'all',
      },
    })
  })

  test('maps a global asset list to a token allowlist', () => {
    expect(
      buildIntentSource({ policy: { chainIds: [8453], tokens: [USDC] } }),
    ).toEqual({
      selection: { chains: { only: [BASE] }, tokens: { only: [USDC] } },
    })
  })

  // A per-chain map IS the chain allowlist. Leaving `chains: 'all'` and relying
  // on `perChain` would make every other chain the account holds eligible.
  test('treats a per-chain map as the chain allowlist and narrows each chain', () => {
    expect(
      buildIntentSource({
        policy: { chainTokens: { 8453: [USDC], 42161: [WETH] } },
      }),
    ).toEqual({
      selection: {
        chains: { only: [BASE, ARBITRUM] },
        tokens: { only: [USDC, WETH] },
        perChain: {
          [BASE]: { tokens: { only: [USDC] } },
          [ARBITRUM]: { tokens: { only: [WETH] } },
        },
      },
    })
  })

  // The dangerous case: a limit caps a contribution, it does not make a pair
  // eligible. An amount-capped asset has to keep naming the chain and token.
  test('an amount-capped asset sets BOTH the eligibility and the limit', () => {
    const source = buildIntentSource({
      policy: { chainTokenAmounts: { 8453: { [USDC]: 250n } } },
    })

    expect(source?.selection).toEqual({
      chains: { only: [BASE] },
      tokens: { only: [USDC] },
      perChain: { [BASE]: { tokens: { only: [USDC] } } },
    })
    expect(source?.limits).toEqual([
      { chainId: BASE, tokenAddress: USDC, maxAmount: 250n },
    ])
  })

  test('a listed chain does not open to its other tokens because one is capped', () => {
    const source = buildIntentSource({
      policy: {
        chainTokens: { 8453: [USDC] },
        chainTokenAmounts: { 8453: { [WETH]: 1n } },
      },
    })

    expect(source?.selection?.perChain?.[BASE]).toEqual({
      tokens: { only: [USDC, WETH] },
    })
    expect(source?.limits).toEqual([
      { chainId: BASE, tokenAddress: WETH, maxAmount: 1n },
    ])
  })

  test('an unlisted chain stays ineligible when another chain is capped', () => {
    const source = buildIntentSource({
      policy: { chainTokenAmounts: { 8453: { [USDC]: 5n } } },
    })
    expect(source?.selection?.chains).toEqual({ only: [BASE] })
  })

  // An empty explicit selection means "nothing is eligible". Collapsing it to
  // `'all'` would fund the intent from everything the account holds.
  test('an empty explicit per-chain selection fails closed', () => {
    const source = buildIntentSource({ policy: { chainTokens: {} } })
    expect(source?.selection).toEqual({
      chains: { only: [] },
      tokens: { only: [] },
      perChain: {},
    })
  })

  test('a chain listed with no tokens is eligible for no token', () => {
    const source = buildIntentSource({ policy: { chainTokens: { 8453: [] } } })
    expect(source?.selection?.perChain?.[BASE]).toEqual({
      tokens: { only: [] },
    })
  })

  test('deduplicates a token named by both the plain and the capped map', () => {
    const source = buildIntentSource({
      policy: {
        chainTokens: { 8453: [USDC] },
        chainTokenAmounts: { 8453: { [USDC]: 9n } },
      },
    })
    expect(source?.selection?.perChain?.[BASE]).toEqual({
      tokens: { only: [USDC] },
    })
    expect(source?.limits).toHaveLength(1)
  })

  test('maps auxiliary funds under source, keyed by CAIP-2', () => {
    expect(
      buildIntentSource({ auxiliaryFunds: { 8453: { [USDC]: 100n } } }),
    ).toEqual({ auxiliaryFunds: { [BASE]: { [USDC]: 100n } } })
  })

  // Auxiliary funds are money the caller promises to produce, not a widening of
  // which chains may be spent from.
  test('auxiliary funds do not create source eligibility', () => {
    const source = buildIntentSource({
      policy: { chainIds: [8453] },
      auxiliaryFunds: { 42161: { [USDC]: 100n } },
    })
    expect(source?.selection?.chains).toEqual({ only: [BASE] })
  })

  test('maps source calls to tagged per-chain executions', () => {
    const calls = [{ to: USDC, value: 0n, data: '0xabcdef' as const }]
    expect(buildIntentSource({ executions: { 8453: calls } })).toEqual({
      executions: [{ vm: 'evm', chainId: BASE, calls }],
    })
  })

  test('source calls do not create source eligibility', () => {
    const source = buildIntentSource({
      policy: { chainIds: [8453] },
      executions: { 8453: [{ to: USDC, value: 0n, data: '0x' }] },
    })
    expect(source?.selection?.chains).toEqual({ only: [BASE] })
  })
})
