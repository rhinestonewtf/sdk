import type { Address } from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { requireFloorsWithinCaps } from './floor'
import type { SettlementCatalog } from './types'

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address
const ARB_USD18 = '0x8181818181818181818181818181818181818181' as Address
const UNSERVED = '0x9999999999999999999999999999999999999999' as Address

const WITH_18: SettlementCatalog = {
  ...SETTLEMENT_CATALOG,
  [arbitrum.id]: {
    ...SETTLEMENT_CATALOG[arbitrum.id],
    usdStablecoins: [
      ...(SETTLEMENT_CATALOG[arbitrum.id].usdStablecoins ?? []),
      { address: ARB_USD18, symbol: 'USD18', decimals: 18 },
    ],
  },
}

const check = (
  maxAmount: bigint | undefined,
  minAmount: bigint | undefined,
  toToken: Address = ARB_USDC,
  settlement: SettlementCatalog = SETTLEMENT_CATALOG,
) =>
  requireFloorsWithinCaps(
    {
      from: [{ chain: base, token: BASE_USDC, maxAmount }],
      to: [{ chain: arbitrum, token: toToken, minAmount }],
    },
    settlement,
  )

describe('requireFloorsWithinCaps', () => {
  test('accepts a floor between half of and all of the cap', () => {
    expect(() => check(1_000_000n, 500_000n)).not.toThrow()
    expect(() => check(1_000_000n, 1_000_000n)).not.toThrow()
  })

  test('refuses a floor under half of the cap', () => {
    expect(() => check(1_000_000n, 499_999n)).toThrow(
      /between half of and all of the chain 8453 maxAmount/,
    )
  })

  test('refuses a floor above the cap', () => {
    expect(() => check(1_000_000n, 1_000_001n)).toThrow(
      /between half of and all of the chain 8453 maxAmount/,
    )
  })

  test('rescales the cap into the to token decimals', () => {
    expect(() =>
      check(1_000_000n, 990_000_000_000_000_000n, ARB_USD18, WITH_18),
    ).not.toThrow()
    expect(() => check(1_000_000n, 990_000n, ARB_USD18, WITH_18)).toThrow(
      /18 decimals/,
    )
  })

  test('skips a leg without a floor, a source without a cap, and unserved decimals', () => {
    expect(() => check(1_000_000n, undefined)).not.toThrow()
    expect(() => check(undefined, 1n)).not.toThrow()
    expect(() => check(1_000_000n, 1n, UNSERVED)).not.toThrow()
  })

  test('accepts a permit with no from or no to legs', () => {
    expect(() =>
      requireFloorsWithinCaps(
        { to: [{ chain: arbitrum, token: ARB_USDC, minAmount: 1n }] },
        SETTLEMENT_CATALOG,
      ),
    ).not.toThrow()
    expect(() =>
      requireFloorsWithinCaps(
        { from: [{ chain: base, token: BASE_USDC, maxAmount: 1n }] },
        SETTLEMENT_CATALOG,
      ),
    ).not.toThrow()
  })
})
