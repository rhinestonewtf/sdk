import { type Address, encodeFunctionData, type Hex, pad, slice } from 'viem'
import { describe, expect, test } from 'vitest'
import type {
  ArgPolicyExpression,
  ScopedAction,
  UniversalActionPolicyParamRule,
} from '../types'
import {
  cctpTokenMessenger,
  DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR,
  scopeCctp,
  tokenMessengerAbi,
} from './cctp'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const FORWARD_HOOK =
  '0x636374702d666f72776172640000000000000000000000000000000000000000' as Hex

/** Evaluates a scoped action's rules the way the on-chain policy reads them. */
function holds(action: ScopedAction, calldata: Hex, observed = 0n): boolean {
  const word = (offset: bigint) =>
    BigInt(slice(calldata, 4 + Number(offset), 36 + Number(offset)))
  const rule = (r: UniversalActionPolicyParamRule) => {
    const ref = BigInt(r.referenceValue)
    const value = word(r.calldataOffset)
    if (r.condition === 'equal') return value === ref
    if (r.condition === 'lessThanOrEqual')
      return (
        value <= ref &&
        (r.usageLimit === undefined || observed + value <= r.usageLimit)
      )
    throw new Error(`unexpected condition ${r.condition}`)
  }
  const expr = (e: ArgPolicyExpression): boolean =>
    e.type === 'rule'
      ? rule(e.rule)
      : e.type === 'not'
        ? !expr(e.child)
        : e.type === 'and'
          ? expr(e.left) && expr(e.right)
          : expr(e.left) || expr(e.right)
  return (action.policies ?? []).every((policy) =>
    policy.type === 'universal-action'
      ? policy.rules.every(rule)
      : policy.type === 'arg-policy'
        ? expr(policy.expression)
        : true,
  )
}

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

const base = {
  chainId: 8453,
  target: cctpTokenMessenger(false),
  sourceTokens: [USDC],
  timeFrame: [],
} as const

describe('scopeCctp', () => {
  const action = scopeCctp({
    ...base,
    destinations: [{ chainId: 42161, recipient: ACCOUNT }],
    cap: 100n,
  })

  test('targets TokenMessengerV2 depositForBurnWithHook', () => {
    expect(action.target).toBe('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d')
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
        { chainId: 42161, recipient: ACCOUNT },
        { chainId: 10, recipient: OTHER },
      ],
    })
    expect(holds(twoLegs, burn({ domain: 3, recipient: ACCOUNT }))).toBe(true)
    expect(holds(twoLegs, burn({ domain: 2, recipient: OTHER }))).toBe(true)
    expect(holds(twoLegs, burn({ domain: 2, recipient: ACCOUNT }))).toBe(false)
  })

  test('refuses a destination CCTP does not route to', () => {
    expect(() =>
      scopeCctp({
        ...base,
        destinations: [{ chainId: 56, recipient: ACCOUNT }],
      }),
    ).toThrow('CCTP does not route to chain 56')
  })

  test('refuses more than one source token', () => {
    expect(() =>
      scopeCctp({
        ...base,
        sourceTokens: [USDC, OTHER],
        destinations: [{ chainId: 42161, recipient: ACCOUNT }],
      }),
    ).toThrow('exactly one `from` token')
  })
})
