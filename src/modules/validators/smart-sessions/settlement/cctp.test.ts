import {
  type Address,
  encodeFunctionData,
  type Hex,
  isAddress,
  pad,
} from 'viem'
import { describe, expect, test } from 'vitest'
import { satisfiesRules as holds } from '../../../../../test/utils/policy-rules'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import {
  DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR,
  scopeCctp,
  tokenMessengerAbi,
} from './cctp'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const FORWARD_HOOK =
  '0x636374702d666f72776172640000000000000000000000000000000000000000' as Hex

function burn(
  overrides: Partial<{
    amount: bigint
    domain: number
    recipient: Address
    token: Address
    caller: Hex
  }> = {},
): Hex {
  return encodeFunctionData({
    abi: tokenMessengerAbi,
    functionName: 'depositForBurnWithHook',
    args: [
      overrides.amount ?? 100n,
      overrides.domain ?? 3,
      pad(overrides.recipient ?? ACCOUNT),
      overrides.token ?? USDC,
      overrides.caller ?? pad('0x'),
      1n,
      1000,
      FORWARD_HOOK,
    ],
  })
}

const USDC_ARB = SETTLEMENT_CATALOG[42161].cctp!.usdc
const USDC_OP = SETTLEMENT_CATALOG[10].cctp!.usdc

const base = {
  chainId: 8453,
  settlement: SETTLEMENT_CATALOG,
  target: SETTLEMENT_CATALOG[8453].cctp!.tokenMessenger,
  sourceTokens: [USDC],
} as const

describe('scopeCctp', () => {
  const action = scopeCctp({
    ...base,
    destinations: [{ chainId: 42161, token: USDC_ARB, recipient: ACCOUNT }],
    cap: 100n,
  })

  test('targets TokenMessengerV2 depositForBurnWithHook', () => {
    expect(action.target).toBe('0x28b5a0e9c621a5badaa536219b3a228c8168cf5d')
    expect(action.selector).toBe(DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR)
    expect(DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR).toBe('0x779b432d')
  })

  test('admits the burn the orchestrator builds', () => {
    expect(holds(action, burn())).toBe(true)
  })

  test.each([
    ['recipient', { recipient: OTHER }],
    ['destination domain', { domain: 6 }],
    ['burn token', { token: OTHER }],
    ['destination caller', { caller: pad(OTHER) }],
    ['amount over the cap', { amount: 101n }],
  ] as const)('refuses a burn with another %s', (_, overrides) => {
    expect(holds(action, burn(overrides))).toBe(false)
  })

  test('the cap is cumulative', () => {
    expect(holds(action, burn({ amount: 60n }), 50n)).toBe(false)
  })

  test('pairs each recipient with its own destination', () => {
    const twoLegs = scopeCctp({
      ...base,
      destinations: [
        { chainId: 42161, token: USDC_ARB, recipient: ACCOUNT },
        { chainId: 10, token: USDC_OP, recipient: OTHER },
      ],
    })
    expect(holds(twoLegs, burn({ domain: 3, recipient: ACCOUNT }))).toBe(true)
    expect(holds(twoLegs, burn({ domain: 2, recipient: OTHER }))).toBe(true)
    expect(holds(twoLegs, burn({ domain: 2, recipient: ACCOUNT }))).toBe(false)
  })

  test('an open recipient still pins the destination', () => {
    const open = scopeCctp({
      ...base,
      destinations: [{ chainId: 42161, token: USDC_ARB }],
    })
    expect(holds(open, burn({ recipient: OTHER }))).toBe(true)
    expect(holds(open, burn({ domain: 6 }))).toBe(false)
  })

  test('refuses a destination CCTP does not route to', () => {
    expect(() =>
      scopeCctp({
        ...base,
        destinations: [{ chainId: 56, token: USDC_ARB, recipient: ACCOUNT }],
      }),
    ).toThrow('CCTP does not route to chain 56')
  })

  test('refuses a chain the orchestrator serves no CCTP block for', () => {
    const { cctp: _, ...arbitrum } = SETTLEMENT_CATALOG[42161]
    const settlement = { ...SETTLEMENT_CATALOG, 42161: arbitrum }
    expect(() =>
      scopeCctp({
        ...base,
        settlement,
        destinations: [{ chainId: 42161, token: USDC_ARB, recipient: ACCOUNT }],
      }),
    ).toThrow('CCTP does not route to chain 42161')
    expect(() =>
      scopeCctp({
        ...base,
        settlement,
        chainId: 42161,
        sourceTokens: [USDC_ARB],
        destinations: [{ chainId: 10, token: USDC_OP, recipient: ACCOUNT }],
      }),
    ).toThrow('CCTP does not route to chain 42161')
  })

  test('refuses more than one source token', () => {
    expect(() =>
      scopeCctp({
        ...base,
        sourceTokens: [USDC, OTHER],
        destinations: [{ chainId: 42161, token: USDC_ARB, recipient: ACCOUNT }],
      }),
    ).toThrow('exactly one `from` token')
  })

  test.each([
    ['`from`', { sourceTokens: [OTHER] }, 'the `from` token on chain 8453'],
    [
      '`to`',
      { destinations: [{ chainId: 42161, token: OTHER, recipient: ACCOUNT }] },
      'the `to` token on chain 42161',
    ],
  ] as const)(
    'refuses a %s token that is not USDC',
    (_, overrides, message) => {
      expect(() =>
        scopeCctp({
          ...base,
          destinations: [
            { chainId: 42161, token: USDC_ARB, recipient: ACCOUNT },
          ],
          ...overrides,
        }),
      ).toThrow(message)
    },
  )

  test('every fixture USDC address is valid', () => {
    for (const { cctp } of Object.values(SETTLEMENT_CATALOG)) {
      if (cctp) expect(isAddress(cctp.usdc)).toBe(true)
    }
  })
})
