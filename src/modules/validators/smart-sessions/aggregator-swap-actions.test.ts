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
import {
  INTENT_EXECUTION_POLICY_ADDRESS,
  SUDO_POLICY_ADDRESS,
  VALUE_LIMIT_POLICY_ADDRESS,
} from './policies/addresses'
import {
  DUMMY_PRECLAIMOP_TARGET,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  toSession,
} from './resolve'

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

  test('approve pins spender + a cumulative spending limit (not per-call)', () => {
    const [approve] = zeroExSwapActions(scope)
    const policies = resolvePermission(approve)[0].policies ?? []
    const ua = policies.find((p) => p.type === 'universal-action')
    if (ua?.type !== 'universal-action')
      throw new Error('expected universal-action')
    const spender = ua.rules.find((r) => r.calldataOffset === 0n)
    expect((spender?.referenceValue as string).toLowerCase()).toBe(
      ZEROX_ALLOWANCE_HOLDER.toLowerCase(),
    )
    // maxSellAmount is now a cumulative session cap via spending-limits, not a
    // per-call rule that repeated swaps could bypass.
    const sl = policies.find((p) => p.type === 'spending-limits')
    if (sl?.type !== 'spending-limits')
      throw new Error('expected spending-limits')
    expect(sl.limits[0].amount).toBe(1_000_000n)
    expect(sl.limits[0].token.toLowerCase()).toBe(USDC.toLowerCase())
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

  test('pins operator(0) and target(3) to the settler', () => {
    const [, swap] = zeroExSwapActions(scope)
    const policy = resolvePermission(swap)[0].policies?.find(
      (p) => p.type === 'universal-action',
    )
    if (policy?.type !== 'universal-action')
      throw new Error('expected universal-action')
    for (const off of [0n, 96n]) {
      const r = policy.rules.find((r) => r.calldataOffset === off)
      expect(r?.condition).toBe('equal')
      expect((r?.referenceValue as string).toLowerCase()).toBe(
        SETTLER.toLowerCase(),
      )
    }
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

  test('restricted session caps the dummy pre-claim action value (not sudo)', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      permissions: zeroExSwapActions(scope),
      restrictToActions: true,
    })
    const dummy = getSessionData(session).actions.find(
      (a) =>
        a.actionTarget.toLowerCase() === DUMMY_PRECLAIMOP_TARGET.toLowerCase(),
    )
    expect(dummy).toBeDefined()
    const has = (addr: string) =>
      dummy?.actionPolicies.some(
        (p) => p.policy.toLowerCase() === addr.toLowerCase(),
      )
    expect(has(SUDO_POLICY_ADDRESS)).toBe(false)
    expect(has(VALUE_LIMIT_POLICY_ADDRESS)).toBe(true)
  })

  test('restrictToActions + a permit is rejected (would lose permit guardrails)', () => {
    expect(() =>
      toSession({
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA] },
        permissions: zeroExSwapActions(scope),
        claimPolicies: [{ type: 'permit2' }],
        restrictToActions: true,
      }),
    ).toThrow(/incompatible with crossChainPermits\/claimPolicies/)
  })

  test('a fallback-shaped raw action is rejected under restrictToActions', () => {
    expect(() =>
      toSession({
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA] },
        // biome-ignore lint/suspicious/noExplicitAny: exercising the cast guard
        actions: [{ policies: [{ type: 'sudo' }] } as any],
        restrictToActions: true,
      }),
    ).toThrow(/must be scoped/)
  })

  test('a raw action targeting the fallback sentinel is rejected', () => {
    expect(() =>
      toSession({
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA] },
        actions: [
          {
            target: SMART_SESSIONS_FALLBACK_TARGET_FLAG,
            selector: '0x00000001',
            policies: [{ type: 'sudo' }],
          },
        ],
        restrictToActions: true,
      }),
    ).toThrow(/must not target the fallback sentinel/)
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
    const policies = resolvePermission(permissions[0])[0].policies ?? []
    // two spenders → anyOf → arg-policy (not a single-condition universal-action)
    expect(policies.some((p) => p.type === 'arg-policy')).toBe(true)
    // + the cumulative spending-limit on the merged approve
    expect(policies.some((p) => p.type === 'spending-limits')).toBe(true)
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

  test('fynd/Tycho pins BOTH src (32) and dest (64) tokens', () => {
    // Verified against live Tycho `swap` calldata: tokenIn @ 32, tokenOut @ 64.
    const WXPL = '0x6100E367285b01F48D07953803A2d8dCA5D19873' as Address
    const { actions } = swapSessionActions({
      sellToken: USDC,
      aggregators: [
        fyndAggregator({
          router: FYND_ROUTER,
          sellToken: USDC,
          buyToken: WXPL,
        }),
      ],
    })
    const p = actions[0].policies?.[0]
    if (p?.type !== 'universal-action')
      throw new Error('expected universal-action')
    const inRule = p.rules.find((r) => r.calldataOffset === 32n)
    const outRule = p.rules.find((r) => r.calldataOffset === 64n)
    expect((inRule?.referenceValue as string).toLowerCase()).toBe(
      USDC.toLowerCase(),
    )
    expect((outRule?.referenceValue as string).toLowerCase()).toBe(
      WXPL.toLowerCase(),
    )
  })

  test('a raw action colliding with a permission action is rejected', () => {
    // fynd swap on USDC.transfer selector collides with a USDC permission below.
    expect(() =>
      toSession({
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA] },
        permissions: [
          zeroExSwapActions({ sellToken: USDC, settler: SETTLER })[0],
        ], // approve on USDC
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
