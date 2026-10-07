import type { Address } from 'viem'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { frozenScopeEco } from '../../../../../test/utils/eco-frozen'
import {
  ECO_ACCOUNT as ACCOUNT,
  ECO_PORTAL,
} from '../../../../../test/utils/eco-publish'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { scopeEco } from './eco'
import type { SettlementContext } from './types'

const stablecoins = (chainId: number) =>
  SETTLEMENT_CATALOG[chainId].eco!.stablecoins
const USDC_BASE = stablecoins(8453)[0]
const USDC_ARB = stablecoins(42161)[0]
const USDT0_ARB = stablecoins(42161)[1]
const USDC_OP = stablecoins(10)[0]
const OTHER = '0x2222222222222222222222222222222222222222' as Address

const NOW = 1_800_000_000n

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Number(NOW * 1000n))
})
afterAll(() => {
  vi.useRealTimers()
})

const base: SettlementContext = {
  chainId: 8453,
  settlement: SETTLEMENT_CATALOG,
  target: ECO_PORTAL,
  account: ACCOUNT,
  sourceTokens: [USDC_BASE],
  destinations: [{ chainId: 42161, token: USDC_ARB, recipient: ACCOUNT }],
  cap: 100n,
  maxFeeBps: 100,
  validUntil: 1_900_000_000n,
  timeFrame: [],
}

describe('scopeEco against the frozen builder', () => {
  const caps = [1n, 99n, 100n, 999_999n, 10n ** 12n, 2n ** 128n - 1n]
  const fees = [0, 1, 50, 100, 2_500, 9_999]
  const legSets = {
    'Base to Arbitrum USDC': [
      { chainId: 42161, token: USDC_ARB, recipient: ACCOUNT },
    ],
    'Base to Arbitrum USDT0': [
      { chainId: 42161, token: USDT0_ARB, recipient: ACCOUNT },
    ],
    'two legs': [
      { chainId: 42161, token: USDC_ARB, recipient: ACCOUNT },
      { chainId: 10, token: USDC_OP, recipient: ACCOUNT },
    ],
    'seven legs': [1, 10, 130, 137, 999, 9745, 42161].map((chainId) => ({
      chainId,
      token: stablecoins(chainId)[0],
      recipient: ACCOUNT,
    })),
  }

  for (const [name, destinations] of Object.entries(legSets)) {
    test.each(
      caps.flatMap((cap) => fees.map((maxFeeBps) => [cap, maxFeeBps] as const)),
    )(`${name}: cap %s at %s bps emits the same policy`, (cap, maxFeeBps) => {
      const ctx = { ...base, destinations, cap, maxFeeBps }
      expect(scopeEco(ctx)).toEqual(frozenScopeEco(ctx))
    })
  }

  test('a Ronin source emits the same policy', () => {
    const ctx = {
      ...base,
      chainId: 2020,
      target: SETTLEMENT_CATALOG[2020].eco!.portal,
      sourceTokens: [stablecoins(2020)[0]],
      destinations: [{ chainId: 8453, token: USDC_BASE, recipient: ACCOUNT }],
    }
    expect(scopeEco(ctx)).toEqual(frozenScopeEco(ctx))
  })

  test('a time frame and validAfter emit the same policy', () => {
    const ctx = {
      ...base,
      validAfter: NOW + 86_400n,
      validUntil: NOW + 30n * 86_400n,
      timeFrame: [
        { type: 'time-frame', validAfter: 1, validUntil: 2 } as const,
      ],
    }
    expect(scopeEco(ctx)).toEqual(frozenScopeEco(ctx))
  })

  test.each([
    ['an unserved `from` token', { sourceTokens: [OTHER] }],
    [
      'an unserved `to` token',
      { destinations: [{ chainId: 42161, token: OTHER, recipient: ACCOUNT }] },
    ],
    [
      'a chain Eco does not route to',
      { destinations: [{ chainId: 56, token: USDC_ARB, recipient: ACCOUNT }] },
    ],
    [
      'an open recipient',
      { destinations: [{ chainId: 42161, token: USDC_ARB }] },
    ],
    ['no cap', { cap: undefined }],
    ['no maxFeeBps', { maxFeeBps: undefined }],
    ['a maxFeeBps of 10000', { maxFeeBps: 10_000 }],
    ['no validUntil', { validUntil: undefined }],
    ['a short validUntil', { validUntil: NOW + 86_400n }],
    ['no account', { account: undefined }],
    ['two source tokens', { sourceTokens: [USDC_BASE, OTHER] }],
  ] as const)('refuses %s with the same message', (_, overrides) => {
    const ctx = { ...base, ...overrides } as SettlementContext
    expect(() => frozenScopeEco(ctx)).toThrow()
    let frozen = ''
    try {
      frozenScopeEco(ctx)
    } catch (error) {
      frozen = (error as Error).message
    }
    expect(() => scopeEco(ctx)).toThrow(frozen)
  })
})
