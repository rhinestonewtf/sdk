import { type Abi, type Address, type Chain, erc20Abi } from 'viem'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../../test/consts'
import { namedParamOffsets, resolvePermissions } from '../../permissions'
import { getSessionData } from '../digest'
import {
  DUMMY_PRECLAIMOP_TARGET,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  toSession,
} from '../resolve'
import type {
  ArgPolicyExpression,
  ScopedAction,
  SwapScopeInput,
  UniversalActionPolicyParamRule,
} from '../types'
import { FYND_SWAP_SELECTOR, fynd, tychoRouterAbi } from './fynd'
import {
  rhinestoneSwap,
  SWAP_EXACT_IN_SELECTOR,
  SWAP_EXACT_OUT_SELECTOR,
  swapperAddresses,
} from './rhinestone'
import { resolveSwapScope } from './scope'
import {
  ALLOWANCE_HOLDER_EXEC_SELECTOR,
  allowanceHolderAbi,
  resolveZeroExSettler,
  ZEROX_ALLOWANCE_HOLDER,
  ZEROX_SETTLER_REGISTRY,
  zeroEx,
} from './zero-ex'

const USDT0: Address = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb'
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const ACCOUNT: Address = '0x1111111111111111111111111111111111111111'
const SETTLER: Address = '0x7F2194E8d4D5B5F889b17aeCe891F89Da74F5384'
const PLASMA = 9745
const TYCHO_PLASMA: Address = '0x8f9b3b0451efff0ae8100428aee35fa3cbc0b769'

function scope(overrides: Partial<SwapScopeInput> = {}): SwapScopeInput {
  return {
    sell: { token: USDT0 },
    buy: { token: USDC },
    to: ACCOUNT,
    via: [fynd()],
    ...overrides,
  }
}

/** Flatten the AND tree a swap action's ArgPolicy expression is built from. */
function flatten(
  expression: ArgPolicyExpression,
): UniversalActionPolicyParamRule[] {
  if (expression.type === 'rule') return [expression.rule]
  if (expression.type === 'and' || expression.type === 'or') {
    // Flattening an OR loses which branch a rule belongs to, which is fine for
    // asserting that a slot is pinned at all — the alternatives are asserted by
    // checking that every authorised aggregator appears.
    return [...flatten(expression.left), ...flatten(expression.right)]
  }
  throw new Error(`unexpected node in a swap policy: ${expression.type}`)
}

function rulesOf(action: ScopedAction): UniversalActionPolicyParamRule[] {
  const policy = action.policies?.[0]
  if (policy?.type === 'universal-action') return [...policy.rules]
  if (policy?.type === 'arg-policy') return flatten(policy.expression)
  throw new Error(`expected a swap policy, got ${policy?.type}`)
}

function valueLimitOf(action: ScopedAction): bigint | undefined {
  const policy = action.policies?.[0]
  if (policy?.type === 'universal-action' || policy?.type === 'arg-policy') {
    return policy.valueLimitPerUse
  }
  return undefined
}

const SWAPPER_PLASMA = swapperAddresses('production').swapper

function ruleAt(
  rules: UniversalActionPolicyParamRule[],
  offset: bigint,
): UniversalActionPolicyParamRule | undefined {
  return rules.find((r) => r.calldataOffset === offset)
}

describe('resolveSwapScope — fynd', () => {
  test('targets the chain TychoRouter and pins both tokens plus recipient', () => {
    const { actions } = resolveSwapScope(scope(), PLASMA)
    // The direct router call, plus the Swapper's exact-in/exact-out pair —
    // fynd's exact-input routes are the ones the orchestrator wraps.
    expect(actions).toHaveLength(3)
    const direct = actions.find((a) => a.target.toLowerCase() === TYCHO_PLASMA)!
    expect(direct).toBeDefined()
    expect(direct.selector).toBe('0xce25e49e')
    const rules = rulesOf(direct)
    expect(ruleAt(rules, 32n)?.referenceValue).toBe(USDT0) // tokenIn
    expect(ruleAt(rules, 64n)?.referenceValue).toBe(USDC) // tokenOut
    expect(ruleAt(rules, 128n)?.referenceValue).toBe(ACCOUNT) // receiver
  })

  test('approves the router for the direct pull and the proxy for the wrapped one', () => {
    // Never an allowance holder: fynd pulls through its own router directly,
    // and through the Swapper's proxy when the route is wrapped.
    const { permissions } = resolveSwapScope(scope(), PLASMA)
    const policy = resolvePermissions(permissions)[0].policies![0]
    const encoded = JSON.stringify(policy, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    ).toLowerCase()
    expect(encoded).toContain(TYCHO_PLASMA.slice(2))
    expect(encoded).not.toContain(ZEROX_ALLOWANCE_HOLDER.toLowerCase().slice(2))
  })

  test('throws on a chain where fynd is not deployed', () => {
    // Optimism (10) runs 0x but has no TychoRouter.
    expect(() => resolveSwapScope(scope(), 10)).toThrow(/fynd is not available/)
  })

  test('native value is capped at zero so a payable route cannot carry XPL', () => {
    const { actions } = resolveSwapScope(scope(), PLASMA)
    for (const action of actions) {
      expect(valueLimitOf(action)).toBe(0n)
    }
  })
})

describe('resolveSwapScope — 0x pinned settler', () => {
  const pinned = () =>
    resolveSwapScope(scope({ via: [zeroEx({ settler: SETTLER })] }), PLASMA)

  test('calls AllowanceHolder.exec, not the settler directly', () => {
    const { actions } = pinned()
    expect(actions[0].target).toBe(ZEROX_ALLOWANCE_HOLDER)
    expect(actions[0].selector).toBe(ALLOWANCE_HOLDER_EXEC_SELECTOR)
  })

  test('pins operator AND target — either left free redirects the pull', () => {
    const rules = rulesOf(pinned().actions[0])
    expect(ruleAt(rules, 0n)?.referenceValue).toBe(SETTLER) // operator
    expect(ruleAt(rules, 96n)?.referenceValue).toBe(SETTLER) // target
  })

  test('pins the inner settler args once the callee is trusted', () => {
    const rules = rulesOf(pinned().actions[0])
    expect(ruleAt(rules, 196n)?.referenceValue).toBe(ACCOUNT) // recipient
    expect(ruleAt(rules, 228n)?.referenceValue).toBe(USDC) // buyToken
  })

  test('pins the exec.data pointer, without which 196/228 read decoys', () => {
    // 196/228 are the recipient and buy token only while `data` starts at the
    // canonical tail. Leave that pointer free and a session key can aim `data`
    // elsewhere, put matching decoy words at 196/228 for the policy to read, and
    // have the Settler decode a different recipient from the real payload.
    const rules = rulesOf(pinned().actions[0])
    expect(ruleAt(rules, 128n)?.referenceValue).toBe(160n)
  })

  test('the wrapped half pins the exec it forwards, not just calls[1].target', () => {
    // Pinning calls[1].target to the AllowanceHolder still leaves the exec it
    // forwards free to name any operator/target — which is where the pulled
    // input would go. zeroEx() already knows the Settler, so the wrapped half
    // pins it rather than dropping it.
    const swapperAction = pinned().actions.find(
      (a) => a.target.toLowerCase() === SWAPPER_PLASMA.toLowerCase(),
    )!
    expect(swapperAction).toBeDefined()
    const rules = rulesOf(swapperAction)
    expect(ruleAt(rules, 708n)?.referenceValue).toBe(SETTLER) // exec operator
    expect(ruleAt(rules, 804n)?.referenceValue).toBe(SETTLER) // exec target
  })

  test('approves the AllowanceHolder for the direct shape, never the settler', () => {
    // Default `shape: 'both'` also authorises the wrapped shape, whose spender
    // is the Swapper proxy — so this is an allowlist, not a single pin.
    const actions = resolvePermissions(pinned().permissions)
    const policy = actions[0].policies![0]
    expect(policy.type).toBe('arg-policy')
    const encoded = JSON.stringify(policy, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    ).toLowerCase()
    expect(encoded).toContain(ZEROX_ALLOWANCE_HOLDER.toLowerCase().slice(2))
    expect(encoded).not.toContain(SETTLER.toLowerCase().slice(2))
  })
})

describe('resolveSwapScope — 0x anySettler', () => {
  test('requires maxSpend: it is the only bound once target is free', () => {
    expect(() =>
      resolveSwapScope(
        // Bypasses the compile-time requirement the way untyped JS callers would.
        scope({ via: [{ id: '0x', anySettler: true }] }),
        PLASMA,
      ),
    ).toThrow(/requires maxSpend/)
  })

  test('scope-level maxTotal satisfies the requirement', () => {
    const { actions } = resolveSwapScope(
      scope({
        sell: { token: USDT0, maxTotal: 1000n },
        via: [{ id: '0x', anySettler: true }],
      }),
      PLASMA,
    )
    expect(ruleAt(rulesOf(actions[0]), 64n)?.usageLimit).toBe(1000n)
  })

  test('leaves operator/target free but still pins the sell token', () => {
    // token@32 and amount@64 are consumed by AllowanceHolder itself, so they
    // remain meaningful even when the callee is unconstrained.
    const rules = rulesOf(
      resolveSwapScope(
        scope({ via: [zeroEx({ anySettler: true, maxSpend: 500n })] }),
        PLASMA,
      ).actions[0],
    )
    expect(ruleAt(rules, 0n)).toBeUndefined()
    expect(ruleAt(rules, 96n)).toBeUndefined()
    expect(ruleAt(rules, 32n)?.referenceValue).toBe(USDT0)
  })

  test('does NOT pin inner buyToken/recipient — they are meaningless untrusted bytes', () => {
    const rules = rulesOf(
      resolveSwapScope(
        scope({ via: [zeroEx({ anySettler: true, maxSpend: 500n })] }),
        PLASMA,
      ).actions[0],
    )
    expect(ruleAt(rules, 196n)).toBeUndefined()
    expect(ruleAt(rules, 228n)).toBeUndefined()
  })
})

describe('resolveSwapScope — the cumulative cap', () => {
  test('sets usageLimit, not just a per-call comparison', () => {
    // A bare lessThan would let a reusable session run N swaps of `cap` each
    // against a pre-existing allowance the approve limit never observes.
    const { actions } = resolveSwapScope(
      scope({ sell: { token: USDT0, maxTotal: 250n } }),
      PLASMA,
    )
    const amountRule = ruleAt(rulesOf(actions[0]), 0n)
    expect(amountRule?.usageLimit).toBe(250n)
    expect(amountRule?.condition).toBe('lessThanOrEqual')
    expect(amountRule?.referenceValue).toBe(250n)
  })

  test('also lands a spending-limit on the approve', () => {
    const { permissions } = resolveSwapScope(
      scope({ sell: { token: USDT0, maxTotal: 250n } }),
      PLASMA,
    )
    const types = resolvePermissions(permissions)[0]
      .policies!.map((p) => p.type)
      .sort()
    expect(types).toContain('spending-limits')
  })

  test('a venue-level maxSpend overrides the scope-level maxTotal', () => {
    const { actions } = resolveSwapScope(
      scope({
        sell: { token: USDT0, maxTotal: 1000n },
        via: [fynd({ maxSpend: 10n })],
      }),
      PLASMA,
    )
    expect(ruleAt(rulesOf(actions[0]), 0n)?.usageLimit).toBe(10n)
  })

  test('omitting every cap emits no amount rule at all', () => {
    const { actions } = resolveSwapScope(scope(), PLASMA)
    expect(ruleAt(rulesOf(actions[0]), 0n)).toBeUndefined()
  })

  test('a zero cap is honoured rather than treated as absent', () => {
    const { actions } = resolveSwapScope(
      scope({ sell: { token: USDT0, maxTotal: 0n } }),
      PLASMA,
    )
    expect(ruleAt(rulesOf(actions[0]), 0n)?.usageLimit).toBe(0n)
  })
})

describe('multi-venue keeps the Swapper tail pinned', () => {
  test('two aggregators pin the tail to EITHER, never to neither', () => {
    // Sharing one Swapper action by dropping its route pins would authorise a
    // tail neither venue named — broader than the scope the caller asked for.
    const { actions } = resolveSwapScope(
      scope({ via: [fynd(), zeroEx({ settler: SETTLER })] }),
      PLASMA,
    )
    const wrapped = actions.filter(
      (a) => a.target.toLowerCase() === SWAPPER_PLASMA.toLowerCase(),
    )
    expect(wrapped.length).toBeGreaterThan(0)
    for (const action of wrapped) {
      const rules = rulesOf(action)
      // calls[1].target is the aggregator slot; both venues' routers must appear
      // as alternatives, and the slot must be pinned rather than absent.
      const pinnedAggregators = rules
        .filter((r) => r.calldataOffset === 576n)
        .map((r) => String(r.referenceValue).toLowerCase())
      expect(pinnedAggregators).toContain(TYCHO_PLASMA.toLowerCase())
      expect(pinnedAggregators).toContain(ZEROX_ALLOWANCE_HOLDER.toLowerCase())
    }
  })

  test('a bare rhinestoneSwap() still leaves the tail open, as documented', () => {
    // That venue authorises any aggregator by design, so pinning would
    // contradict it.
    const { actions } = resolveSwapScope(
      scope({ via: [rhinestoneSwap()] }),
      PLASMA,
    )
    for (const action of actions) {
      expect(ruleAt(rulesOf(action), 576n)).toBeUndefined()
    }
  })
})

describe('every scope fits the on-chain rule ceiling', () => {
  // UniversalActionPolicy reverts above 16 rules, and the resolver throws at
  // build time — but only for the exact venue combination under test. Adding a
  // pin is cheap and the ceiling is invisible until something overflows, so
  // sweep the combinations rather than trusting the ones that happen to be
  // covered elsewhere.
  const combos = [
    ['fynd', () => [fynd()]],
    ['0x pinned', () => [zeroEx({ settler: SETTLER })]],
    ['0x anySettler', () => [zeroEx({ anySettler: true, maxSpend: 500n })]],
    ['swapper', () => [rhinestoneSwap()]],
    ['fynd+0x', () => [fynd(), zeroEx({ settler: SETTLER })]],
    ['fynd+swapper', () => [fynd(), rhinestoneSwap()]],
  ] as const

  for (const [name, via] of combos) {
    test(`${name} builds a policy that can hold its rules`, () => {
      const { actions } = resolveSwapScope(scope({ via: via() }), PLASMA)
      for (const action of actions) {
        const policy = action.policies?.[0]
        // UniversalActionPolicy encodes a fixed 16-slot array, so anything past
        // that has to be on ArgPolicy — otherwise the encoder throws and the
        // scope is unbuildable.
        if (policy?.type === 'universal-action') {
          expect(policy.rules.length).toBeLessThanOrEqual(16)
        } else {
          expect(policy?.type).toBe('arg-policy')
        }
      }
    })
  }
})

describe('resolveSwapScope — multi-venue and validation', () => {
  test('merges one approve with an allowlist across venue spenders', () => {
    const { permissions, actions } = resolveSwapScope(
      scope({ via: [fynd(), zeroEx({ settler: SETTLER })] }),
      PLASMA,
    )
    expect(permissions).toHaveLength(1)
    // fynd's router, 0x direct, and the Swapper's exact-in/exact-out pair.
    expect(actions).toHaveLength(4)
    // Two distinct spenders force the anyOf/OR path, i.e. arg-policy.
    const resolved = resolvePermissions(permissions)
    expect(resolved[0].policies![0].type).toBe('arg-policy')
  })

  test('naming a venue twice does not duplicate its spenders', () => {
    const once = resolveSwapScope(
      scope({ via: [zeroEx({ settler: SETTLER })] }),
      PLASMA,
    )
    const twice = resolveSwapScope(
      scope({
        via: [zeroEx({ settler: SETTLER }), zeroEx({ settler: SETTLER })],
      }),
      PLASMA,
    )
    // 0x spans two spenders on its own — the AllowanceHolder for the direct
    // pull, the proxy for the wrapped one — so the OR is real, not pointless.
    // Repeating the venue must not grow it.
    expect(JSON.stringify(twice.permissions)).toBe(
      JSON.stringify(once.permissions),
    )
  })

  test('two venues authorising the same call collapse instead of colliding', () => {
    // Two 0x venues describe the same calls, so they collapse rather than clash.
    const { actions } = resolveSwapScope(
      scope({
        via: [zeroEx({ settler: SETTLER }), zeroEx({ settler: SETTLER })],
      }),
      PLASMA,
    )
    const keys = actions.map((a) => `${a.target}|${a.selector}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('conflicting policies on the same call are rejected, not silently merged', () => {
    expect(() =>
      resolveSwapScope(
        scope({
          sell: { token: USDT0, maxTotal: 1000n },
          // Different caps produce different rules for the same Swapper call.
          via: [
            zeroEx({ settler: SETTLER }),
            zeroEx({ anySettler: true, maxSpend: 5n }),
          ],
        }),
        PLASMA,
      ),
    ).toThrow(/Conflicting swap actions/)
  })

  test('rejects an empty venue list', () => {
    expect(() => resolveSwapScope(scope({ via: [] }), PLASMA)).toThrow(
      /at least one venue/,
    )
  })

  test('rejects sell === buy, which would authorise a no-op drain loop', () => {
    expect(() =>
      resolveSwapScope(scope({ buy: { token: USDT0 } }), PLASMA),
    ).toThrow(/same address/)
  })

  test('rejects sell === buy regardless of address casing', () => {
    expect(() =>
      resolveSwapScope(
        scope({ buy: { token: USDT0.toLowerCase() as Address } }),
        PLASMA,
      ),
    ).toThrow(/same address/)
  })

  test('the sell token is pinned from the scope, never from venue options', () => {
    // Kevin blocker: a venue that forgot to restate the sell token would let a
    // standing allowance be spent on a different token.
    for (const via of [
      [fynd()],
      [zeroEx({ settler: SETTLER })],
      [zeroEx({ anySettler: true, maxSpend: 1n })],
    ]) {
      const { actions } = resolveSwapScope(scope({ via }), PLASMA)
      const sellOffset = via[0].id === 'fynd' ? 32n : 32n
      expect(ruleAt(rulesOf(actions[0]), sellOffset)?.referenceValue).toBe(
        USDT0,
      )
    }
  })
})

describe('swap scope through toSession', () => {
  // Plasma is not in viem/chains; the resolver only reads chain.id.
  const plasma = { id: PLASMA, name: 'Plasma' } as unknown as Chain
  const swap = {
    sell: { token: USDT0, maxTotal: 1_000_000n },
    buy: { token: USDC },
    to: ACCOUNT,
    via: [fynd()],
  } as const

  const build = (extra: Record<string, unknown> = {}) =>
    toSession({
      chain: plasma,
      owners: { type: 'ecdsa', accounts: [accountA] },
      swap,
      ...extra,
    })

  test('declaring swap drops the wildcard fallback without asking', () => {
    const actions = getSessionData(build()).actions
    const fallback = actions.find(
      (a) =>
        a.actionTarget.toLowerCase() ===
        SMART_SESSIONS_FALLBACK_TARGET_FLAG.toLowerCase(),
    )
    expect(fallback).toBeUndefined()
  })

  test('authorises exactly the approve, the swaps, and the dummy pre-claim', () => {
    const targets = getSessionData(build())
      .actions.map((a) => a.actionTarget.toLowerCase())
      .sort()
    // The Swapper appears twice — exact-in and exact-out are separate actions
    // on one address.
    expect(targets).toEqual(
      [
        USDT0.toLowerCase(),
        TYCHO_PLASMA.toLowerCase(),
        SWAPPER_PLASMA.toLowerCase(),
        SWAPPER_PLASMA.toLowerCase(),
        DUMMY_PRECLAIMOP_TARGET.toLowerCase(),
      ].sort(),
    )
  })

  test('a swap session cannot also carry a permit', () => {
    expect(() => build({ claimPolicies: [{ type: 'permit2' }] })).toThrow(
      /incompatible with crossChainPermits\/claimPolicies/,
    )
  })

  test('swap composes with hand-written permissions on the same session', () => {
    const session = toSession({
      chain: plasma,
      owners: { type: 'ecdsa', accounts: [accountA] },
      swap,
      permissions: [
        {
          abi: erc20Abi,
          address: USDC,
          functions: { transfer: { maxUses: 1n } },
        },
      ],
    })
    const targets = getSessionData(session).actions.map((a) =>
      a.actionTarget.toLowerCase(),
    )
    expect(targets).toContain(USDC.toLowerCase())
    expect(targets).toContain(TYCHO_PLASMA.toLowerCase())
  })

  test('a swap-scoped session still has its 1271 surface locked down', () => {
    const open = toSession({
      chain: plasma,
      owners: { type: 'ecdsa', accounts: [accountA] },
      permissions: [
        {
          abi: erc20Abi,
          address: USDC,
          functions: { transfer: { maxUses: 1n } },
        },
      ],
    })
    expect(build().erc7739Policies.erc1271Policies.length).toBeLessThan(
      open.erc7739Policies.erc1271Policies.length,
    )
  })

  test('two venues produce two distinct swap actions, no collision', () => {
    const session = toSession({
      chain: plasma,
      owners: { type: 'ecdsa', accounts: [accountA] },
      swap: {
        ...swap,
        via: [fynd(), zeroEx({ settler: SETTLER })],
      },
    })
    const targets = getSessionData(session).actions.map((a) =>
      a.actionTarget.toLowerCase(),
    )
    expect(targets).toContain(TYCHO_PLASMA.toLowerCase())
    expect(targets).toContain(ZEROX_ALLOWANCE_HOLDER.toLowerCase())
    // The Swapper carries exact-in and exact-out on one address, so the action
    // key is (target, selector) — a repeated target is not a collision.
    const keys = getSessionData(session).actions.map(
      (a) => `${a.actionTarget.toLowerCase()}|${a.actionTargetSelector}`,
    )
    expect(new Set(keys).size).toBe(keys.length)
  })
})

// The ABIs in the venue modules exist to DERIVE selectors and offsets, so a typo
// in an argument type would silently retarget every rule. These pin the derived
// values against the real on-chain signatures.
describe('venue ABIs derive the on-chain selectors', () => {
  test('fynd singleSwap selector matches the deployed TychoRouter', () => {
    expect(FYND_SWAP_SELECTOR).toBe('0xce25e49e')
  })

  test('0x AllowanceHolder exec selector matches the deployed contract', () => {
    expect(ALLOWANCE_HOLDER_EXEC_SELECTOR).toBe('0x2213bc0b')
  })

  test('fynd head offsets come out where live calldata puts them', () => {
    const offsets = namedParamOffsets(
      tychoRouterAbi as unknown as Abi,
      'singleSwap',
    )
    expect(offsets).toMatchObject({
      amountIn: 0n,
      tokenIn: 32n,
      tokenOut: 64n,
      minAmountOut: 96n,
      receiver: 128n,
    })
  })

  test('the dynamic tail is not addressable, so it is absent from the offsets', () => {
    const offsets = namedParamOffsets(
      tychoRouterAbi as unknown as Abi,
      'singleSwap',
    )
    expect(offsets.permit).toBeUndefined()
    expect(offsets.swap).toBeUndefined()
  })

  test('0x exec head offsets are the four static words', () => {
    const offsets = namedParamOffsets(
      allowanceHolderAbi as unknown as Abi,
      'exec',
    )
    expect(offsets).toMatchObject({
      operator: 0n,
      token: 32n,
      amount: 64n,
      target: 96n,
    })
    expect(offsets.data).toBeUndefined()
  })
})

describe('resolveSwapScope — Rhinestone Swapper', () => {
  const swapper: Address = '0x40CE38e0cbB8ec54a601256E4FacfED5679bccD0'
  const proxy: Address = '0x5afCe415B4370E5EfD8B9BE784d21C331bEAb965'

  test('is the default when no venue is named', () => {
    const { actions } = resolveSwapScope(
      { sell: { token: USDT0 }, buy: { token: USDC }, to: ACCOUNT },
      PLASMA,
    )
    expect(actions.map((a) => a.target)).toEqual([swapper, swapper])
    expect(actions.map((a) => a.selector)).toEqual([
      SWAP_EXACT_IN_SELECTOR,
      SWAP_EXACT_OUT_SELECTOR,
    ])
  })

  test('approves the proxy, never the Swapper or a router', () => {
    const { permissions } = resolveSwapScope(
      { sell: { token: USDT0 }, buy: { token: USDC }, to: ACCOUNT },
      PLASMA,
    )
    const policy = resolvePermissions(permissions)[0].policies![0]
    if (policy.type !== 'universal-action') throw new Error('wrong type')
    expect(policy.rules[0].referenceValue).toBe(proxy.toLowerCase())
  })

  test('pins tokens, recipient and the cap on both selectors', () => {
    const { actions } = resolveSwapScope(
      {
        sell: { token: USDT0, maxTotal: 500n },
        buy: { token: USDC },
        to: ACCOUNT,
      },
      PLASMA,
    )
    for (const action of actions) {
      const rules = rulesOf(action)
      expect(ruleAt(rules, 0n)?.referenceValue).toBe(USDT0) // tokenIn
      expect(ruleAt(rules, 64n)?.referenceValue).toBe(USDC) // tokenOut
      expect(ruleAt(rules, 160n)?.referenceValue).toBe(ACCOUNT) // recipient
      // amountIn (exact-in) and amountInMax (exact-out) share offset 32.
      expect(ruleAt(rules, 32n)?.usageLimit).toBe(500n)
    }
  })

  test('leaves the calls[] route unpinned by default', () => {
    const rules = rulesOf(
      resolveSwapScope(
        { sell: { token: USDT0 }, buy: { token: USDC }, to: ACCOUNT },
        PLASMA,
      ).actions[0],
    )
    for (const offset of [224n, 256n, 288n, 320n, 352n, 576n]) {
      expect(ruleAt(rules, offset)).toBeUndefined()
    }
  })
})

// Pinning a target inside a dynamic array is only sound if the LAYOUT is pinned
// too — otherwise a compromised key re-encodes so a fixed offset reads a
// different word. These assert the shape words are pinned alongside the targets.
describe('resolveSwapScope — wrapped 0x route pinning', () => {
  const scoped = () =>
    resolveSwapScope(
      {
        sell: { token: USDT0, maxTotal: 500n },
        buy: { token: USDC },
        to: ACCOUNT,
        via: [zeroEx({ settler: SETTLER })],
      },
      PLASMA,
    )

  /** The Swapper actions — zeroEx() also emits the direct AllowanceHolder call. */
  const wrapped = () =>
    scoped().actions.filter(
      (a) => a.target.toLowerCase() === SWAPPER_PLASMA.toLowerCase(),
    )

  test('pins the array pointer, length and both element pointers', () => {
    const rules = rulesOf(wrapped()[0])
    expect(ruleAt(rules, 224n)?.referenceValue).toBe(256n) // calls -> ptr
    expect(ruleAt(rules, 256n)?.referenceValue).toBe(2n) // length
    expect(ruleAt(rules, 288n)?.referenceValue).toBe(64n) // elem[0] ptr
    expect(ruleAt(rules, 320n)?.referenceValue).toBe(288n) // elem[1] ptr
  })

  test('pins calls[0] to the sell token and calls[1] to 0x', () => {
    const rules = rulesOf(wrapped()[0])
    expect(ruleAt(rules, 352n)?.referenceValue).toBe(USDT0)
    expect(ruleAt(rules, 576n)?.referenceValue).toBe(ZEROX_ALLOWANCE_HOLDER)
  })

  test('applies the same route pins to the exact-out selector', () => {
    const rules = rulesOf(wrapped()[1])
    expect(ruleAt(rules, 256n)?.referenceValue).toBe(2n)
    expect(ruleAt(rules, 576n)?.referenceValue).toBe(ZEROX_ALLOWANCE_HOLDER)
  })

  test('a fully pinned wrapped route moves to ArgPolicy rather than drop a pin', () => {
    // The shape words, both call targets, the approve and the nested exec run
    // past UniversalActionPolicy's fixed 16 slots. ArgPolicy's rule list is
    // dynamic, so the overflow costs a policy type rather than a binding.
    for (const action of wrapped()) {
      expect(rulesOf(action).length).toBeGreaterThan(16)
      expect(action.policies?.[0].type).toBe('arg-policy')
    }
    // The direct call still fits the simpler policy.
    const direct = scoped().actions.find(
      (a) => a.target.toLowerCase() === ZEROX_ALLOWANCE_HOLDER.toLowerCase(),
    )!
    expect(direct.policies?.[0].type).toBe('universal-action')
  })

  test('rejects a chain where 0x is not a quoter', () => {
    expect(() =>
      resolveSwapScope(
        {
          sell: { token: USDT0 },
          buy: { token: USDC },
          to: ACCOUNT,
          via: [zeroEx({ settler: SETTLER })],
        },
        // Gnosis (100) runs neither 0x nor fynd.
        100,
      ),
    ).toThrow(/0x is not available/)
  })

  test('the unrouted Swapper venue still works on a non-0x chain', () => {
    expect(() =>
      resolveSwapScope(
        { sell: { token: USDT0 }, buy: { token: USDC }, to: ACCOUNT },
        100,
      ),
    ).not.toThrow()
  })
})

describe('resolveZeroExSettler', () => {
  test('reads ownerOf(2) off the registry', async () => {
    const calls: unknown[] = []
    const settler = await resolveZeroExSettler({
      readContract: async (args) => {
        calls.push(args)
        return SETTLER
      },
    })
    expect(settler).toBe(SETTLER)
    // Feature 2 is the taker-submitted Settler; a different slot would resolve
    // a Settler variant ordinary swaps never use.
    expect(calls[0]).toMatchObject({
      address: ZEROX_SETTLER_REGISTRY,
      functionName: 'ownerOf',
      args: [2n],
    })
  })

  test('propagates a failing read rather than returning a zero address', async () => {
    await expect(
      resolveZeroExSettler({
        readContract: async () => {
          throw new Error('rpc down')
        },
      }),
    ).rejects.toThrow(/rpc down/)
  })
})

describe('swapperAddresses', () => {
  test('production and development are distinct pairs', () => {
    const prod = swapperAddresses('production')
    const dev = swapperAddresses('development')
    expect(prod.swapper).not.toBe(dev.swapper)
    expect(prod.proxy).not.toBe(dev.proxy)
  })

  test('a development session scopes the dev Swapper', () => {
    const { actions } = resolveSwapScope(
      { sell: { token: USDT0 }, buy: { token: USDC }, to: ACCOUNT },
      PLASMA,
      'development',
    )
    const { swapper } = swapperAddresses('development')
    expect(actions.every((a) => a.target === swapper)).toBe(true)
  })
})

describe('venue maxSpend', () => {
  test('rhinestoneSwap carries a venue-level cap', () => {
    const { actions } = resolveSwapScope(
      {
        sell: { token: USDT0, maxTotal: 1000n },
        buy: { token: USDC },
        to: ACCOUNT,
        via: [rhinestoneSwap({ maxSpend: 7n })],
      },
      PLASMA,
    )
    expect(ruleAt(rulesOf(actions[0]), 32n)?.usageLimit).toBe(7n)
  })
})
