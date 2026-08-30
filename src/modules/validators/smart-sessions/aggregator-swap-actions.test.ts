import { type Address, toFunctionSelector } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../test/consts'
import { resolvePermission } from '../permissions'
import {
  ALLOWANCE_HOLDER_EXEC_SELECTOR,
  fyndAggregator,
  swapSessionActions,
  ZEROX_ALLOWANCE_HOLDER,
  zeroExAggregator,
  zeroExSwapActions,
} from './aggregator-swap-actions'
import { getSessionData } from './digest'
import { INTENT_EXECUTION_POLICY_ADDRESS } from './policies/addresses'
import { toSession } from './resolve'

const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const SETTLER: Address = '0x5555555555555555555555555555555555555555'
const APPROVE = toFunctionSelector('function approve(address,uint256)')

const scope = { sellToken: USDC, settler: SETTLER, maxSellAmount: 1_000_000n }

describe('zeroExSwapActions', () => {
  test('returns approve(→AllowanceHolder) + exec(AllowanceHolder)', () => {
    const [approve, swap] = zeroExSwapActions(scope)
    const [ra] = resolvePermission(approve)
    expect(ra.target.toLowerCase()).toBe(USDC.toLowerCase())
    expect(ra.selector).toBe(APPROVE)
    const [rs] = resolvePermission(swap)
    expect(rs.target.toLowerCase()).toBe(ZEROX_ALLOWANCE_HOLDER.toLowerCase())
    expect(rs.selector).toBe(ALLOWANCE_HOLDER_EXEC_SELECTOR)
  })

  test('approve pins spender=AllowanceHolder + amount cap', () => {
    const [approve] = zeroExSwapActions(scope)
    const policy = resolvePermission(approve)[0].policies?.[0]
    if (policy?.type !== 'universal-action')
      throw new Error('expected universal-action')
    const spender = policy.rules.find((r) => r.calldataOffset === 0n)
    expect((spender?.referenceValue as string).toLowerCase()).toBe(
      ZEROX_ALLOWANCE_HOLDER.toLowerCase(),
    )
    const amount = policy.rules.find((r) => r.calldataOffset === 32n)
    expect(amount?.condition).toBe('lessThan')
    expect(amount?.referenceValue).toBe(1_000_001n)
  })

  test('exec pins token(1)=USDC + amount(2) cap + target(3)=Settler', () => {
    const [, swap] = zeroExSwapActions(scope)
    const policy = resolvePermission(swap)[0].policies?.find(
      (p) => p.type === 'universal-action',
    )
    if (policy?.type !== 'universal-action')
      throw new Error('expected universal-action')
    const token = policy.rules.find((r) => r.calldataOffset === 32n)
    expect((token?.referenceValue as string).toLowerCase()).toBe(
      USDC.toLowerCase(),
    )
    expect(policy.rules.find((r) => r.calldataOffset === 64n)?.condition).toBe(
      'lessThan',
    ) // amount
    const target = policy.rules.find((r) => r.calldataOffset === 96n)
    expect((target?.referenceValue as string).toLowerCase()).toBe(
      SETTLER.toLowerCase(),
    )
  })

  test('omitting settler leaves the forward target unpinned', () => {
    const [, swap] = zeroExSwapActions({ sellToken: USDC })
    const policy = resolvePermission(swap)[0].policies?.find(
      (p) => p.type === 'universal-action',
    )
    if (policy?.type !== 'universal-action')
      throw new Error('expected universal-action')
    expect(policy.rules.some((r) => r.calldataOffset === 96n)).toBe(false)
  })
})

describe('restrictToActions (session is provably restricted)', () => {
  function hasFallback(session: ReturnType<typeof toSession>): boolean {
    return getSessionData(session).actions.some((a) =>
      a.actionPolicies.some(
        (p) =>
          p.policy.toLowerCase() ===
          INTENT_EXECUTION_POLICY_ADDRESS.toLowerCase(),
      ),
    )
  }

  test('a restricted swap session drops the intent-execution fallback', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      permissions: zeroExSwapActions(scope),
      restrictToActions: true,
    })
    expect(hasFallback(session)).toBe(false)
    const data = getSessionData(session)
    // approve on USDC + exec on AllowanceHolder both survive
    expect(
      data.actions.some(
        (a) => a.actionTarget.toLowerCase() === USDC.toLowerCase(),
      ),
    ).toBe(true)
    expect(
      data.actions.some(
        (a) =>
          a.actionTarget.toLowerCase() === ZEROX_ALLOWANCE_HOLDER.toLowerCase(),
      ),
    ).toBe(true)
  })

  test('the same session WITHOUT restrictToActions keeps the fallback', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      permissions: zeroExSwapActions(scope),
    })
    expect(hasFallback(session)).toBe(true)
  })

  test('restrictToActions with no permissions throws', () => {
    expect(() =>
      toSession({
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA] },
        restrictToActions: true,
      }),
    ).toThrow(/must supply at least one permission/)
  })
})

describe('swapSessionActions (scope both 0x + fynd)', () => {
  const FYND_ROUTER: Address = '0x8f9b3b04b7f9b3b04b7f9b3b04b7f9b3b04b7f90'
  const FYND_SELECTOR = '0xabcdef01' as const
  const both = {
    sellToken: USDC,
    maxSellAmount: 1_000_000n,
    aggregators: [
      zeroExAggregator({
        sellToken: USDC,
        settler: SETTLER,
        maxSellAmount: 1_000_000n,
      }),
      fyndAggregator({ router: FYND_ROUTER, swapSelector: FYND_SELECTOR }),
    ] as [
      ReturnType<typeof zeroExAggregator>,
      ReturnType<typeof fyndAggregator>,
    ],
  }

  test('one merged approve with spender allowlist {AllowanceHolder, fynd}', () => {
    const { permissions } = swapSessionActions(both)
    expect(permissions).toHaveLength(1)
    const policy = resolvePermission(permissions[0])[0].policies?.[0]
    // two spenders → anyOf → arg-policy (not a single-condition universal-action)
    expect(policy?.type).toBe('arg-policy')
  })

  test('one scoped swap action per aggregator, right target+selector', () => {
    const { actions } = swapSessionActions(both)
    expect(actions).toHaveLength(2)
    const ox = actions.find(
      (a) => a.target.toLowerCase() === ZEROX_ALLOWANCE_HOLDER.toLowerCase(),
    )
    expect(ox?.selector).toBe(ALLOWANCE_HOLDER_EXEC_SELECTOR)
    expect(ox?.policies?.[0]?.type).toBe('universal-action') // 0x has arg pins
    const fynd = actions.find(
      (a) => a.target.toLowerCase() === FYND_ROUTER.toLowerCase(),
    )
    expect(fynd?.selector).toBe(FYND_SELECTOR)
    // fynd has no arg pins → bound by target+selector with a native-value cap
    // (not sudo, which would let the swap carry arbitrary value).
    expect(fynd?.policies?.[0]?.type).toBe('value-limit')
  })

  test('no-pin aggregator caps native value at 0 by default', () => {
    const { actions } = swapSessionActions({
      sellToken: USDC,
      aggregators: [
        fyndAggregator({ router: FYND_ROUTER, swapSelector: FYND_SELECTOR }),
      ],
    })
    const p = actions[0].policies?.[0]
    if (p?.type !== 'value-limit') throw new Error('expected value-limit')
    expect(p.limit).toBe(0n)
  })

  test('a raw action colliding with a permission action is rejected', () => {
    // fynd swap on USDC.transfer selector collides with a USDC permission below.
    expect(() =>
      toSession({
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA] },
        permissions: [zeroExSwapActions({ sellToken: USDC })[0]], // approve on USDC
        actions: [
          { target: USDC, selector: APPROVE, policies: [{ type: 'sudo' }] },
        ],
        restrictToActions: true,
      }),
    ).toThrow(/Duplicate scoped action/)
  })

  test('resolves into a restricted session with both swaps + no fallback', () => {
    const { permissions, actions } = swapSessionActions(both)
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      permissions,
      actions,
      restrictToActions: true,
    })
    const data = getSessionData(session)
    const hasFallback = data.actions.some((a) =>
      a.actionPolicies.some(
        (p) =>
          p.policy.toLowerCase() ===
          INTENT_EXECUTION_POLICY_ADDRESS.toLowerCase(),
      ),
    )
    expect(hasFallback).toBe(false)
    for (const target of [ZEROX_ALLOWANCE_HOLDER, FYND_ROUTER]) {
      expect(
        data.actions.some(
          (a) => a.actionTarget.toLowerCase() === target.toLowerCase(),
        ),
      ).toBe(true)
    }
  })
})
