import {
  type Abi,
  type Address,
  type Chain,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  keccak256,
  slice,
  toHex,
  zeroHash,
} from 'viem'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../../test/consts'
import { namedParamOffsets } from '../../permissions'
import { getPermissionId, getSessionData } from '../digest'
import { toSession } from '../resolve'
import type {
  ScopedAction,
  ServedStablecoin,
  SwapScopeInput,
  UniversalActionPolicyParamRule,
} from '../types'
import { fynd } from './fynd'
import {
  rhinestoneSwap,
  SWAP_EXACT_IN_SELECTOR,
  SWAP_EXACT_OUT_SELECTOR,
  swapperAbi,
  swapperAddresses,
} from './rhinestone'
import { resolveSwapScope } from './scope'
import { zeroEx } from './zero-ex'

const USDT0: Address = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb'
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_E18: Address = '0x2222222222222222222222222222222222222222'
const DAI: Address = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
const ACCOUNT: Address = '0x1111111111111111111111111111111111111111'
const ATTACKER: Address = '0x000000000000000000000000000000000000dEaD'
const SETTLER: Address = '0x7F2194E8d4D5B5F889b17aeCe891F89Da74F5384'
const PLASMA = 9745
const plasma = { id: PLASMA, name: 'Plasma' } as unknown as Chain

const CATALOG: ServedStablecoin[] = [
  { address: USDT0.toLowerCase() as Address, symbol: 'USDT0', decimals: 6 },
  { address: USDC, symbol: 'USDC', decimals: 6 },
  // Synthetic 18-decimal stable, as BSC's USDC/USDT are.
  { address: USDC_E18, symbol: 'USDC.e', decimals: 18 },
]

const SERVED = { [PLASMA]: { usdStablecoins: CATALOG } }

const CAP = 1_000_000n

function scope(overrides: Partial<SwapScopeInput> = {}): SwapScopeInput {
  return {
    sell: { token: USDT0, maxTotal: CAP },
    buy: { token: USDC },
    to: ACCOUNT,
    stableFloor: true,
    ...overrides,
  }
}

function actionFor(actions: ScopedAction[], selector: Hex): ScopedAction {
  const action = actions.find((a) => a.selector === selector)
  if (!action) throw new Error(`no action for ${selector}`)
  return action
}

function rulesOf(action: ScopedAction): UniversalActionPolicyParamRule[] {
  const policy = action.policies?.[0]
  if (policy?.type !== 'universal-action') {
    throw new Error(`expected a universal-action policy, got ${policy?.type}`)
  }
  return [...policy.rules]
}

function holds(rule: UniversalActionPolicyParamRule, value: bigint): boolean {
  const ref = BigInt(rule.referenceValue)
  switch (rule.condition) {
    case 'equal':
      return value === ref
    case 'greaterThanOrEqual':
      return value >= ref
    case 'lessThanOrEqual':
      return value <= ref
    default:
      throw new Error(`unmodelled condition ${rule.condition}`)
  }
}

/**
 * UniversalActionPolicy semantics: every rule holds on the call's calldata, and
 * a limited rule's running total stays within its limit; usage commits only
 * when the whole call passes.
 */
function policyOf(action: ScopedAction) {
  const rules = rulesOf(action)
  const used = new Map<number, bigint>()
  return (calldata: Hex): boolean => {
    if (slice(calldata, 0, 4) !== action.selector) return false
    const next = new Map(used)
    for (const [i, rule] of rules.entries()) {
      const start = 4 + Number(rule.calldataOffset)
      const value = BigInt(slice(calldata, start, start + 32))
      if (!holds(rule, value)) return false
      if (rule.usageLimit !== undefined) {
        const total = (used.get(i) ?? 0n) + value
        if (total > rule.usageLimit) return false
        next.set(i, total)
      }
    }
    for (const [i, v] of next) used.set(i, v)
    return true
  }
}

function exactIn(
  amountIn: bigint,
  minAmountOut: bigint,
  buy: Address = USDC,
): Hex {
  return encodeFunctionData({
    abi: swapperAbi,
    functionName: 'swapExactIn',
    args: [USDT0, amountIn, buy, minAmountOut, 0n, ACCOUNT, 0n, []],
  })
}

function exactOut(amountInMax: bigint, amountOut: bigint): Hex {
  return encodeFunctionData({
    abi: swapperAbi,
    functionName: 'swapExactOut',
    args: [USDT0, amountInMax, USDC, amountOut, 0n, ACCOUNT, 0n, []],
  })
}

function resolve(s: SwapScopeInput = scope()) {
  const { actions } = resolveSwapScope(s, PLASMA, 'production', CATALOG)
  return {
    exactIn: policyOf(actionFor(actions, SWAP_EXACT_IN_SELECTOR)),
    exactOut: policyOf(actionFor(actions, SWAP_EXACT_OUT_SELECTOR)),
    actions,
  }
}

// 1_000_000 × (10000 − 100) / 10000
const FLOOR = 990_000n

describe('stableFloor — the output bound', () => {
  test('both output bounds sit at the same head offset', () => {
    const inOffsets = namedParamOffsets(
      swapperAbi as unknown as Abi,
      'swapExactIn',
    )
    const outOffsets = namedParamOffsets(
      swapperAbi as unknown as Abi,
      'swapExactOut',
    )
    expect(inOffsets.minAmountOut).toBe(96n)
    expect(outOffsets.amountOut).toBe(96n)
    // And that offset reads the argument in real encoded calldata.
    expect(BigInt(slice(exactIn(1n, 12345n), 4 + 96, 4 + 128))).toBe(12345n)
    expect(BigInt(slice(exactOut(1n, 54321n), 4 + 96, 4 + 128))).toBe(54321n)
  })

  test('exact-in: minAmountOut at the floor passes, one below is refused', () => {
    expect(resolve().exactIn(exactIn(CAP, FLOOR))).toBe(true)
    expect(resolve().exactIn(exactIn(CAP, FLOOR - 1n))).toBe(false)
  })

  test('exact-out: amountOut at the floor passes, one below is refused', () => {
    expect(resolve().exactOut(exactOut(CAP, FLOOR))).toBe(true)
    expect(resolve().exactOut(exactOut(CAP, FLOOR - 1n))).toBe(false)
  })

  test('the floor rule rides the existing Swapper policy, before the cap', () => {
    const { actions } = resolve()
    for (const selector of [SWAP_EXACT_IN_SELECTOR, SWAP_EXACT_OUT_SELECTOR]) {
      expect(actionFor(actions, selector).policies).toHaveLength(1)
    }
    const rules = rulesOf(actionFor(actions, SWAP_EXACT_IN_SELECTOR))
    const floorIndex = rules.findIndex((r) => r.calldataOffset === 96n)
    const capIndex = rules.findIndex((r) => r.usageLimit !== undefined)
    expect(rules[floorIndex]).toEqual({
      condition: 'greaterThanOrEqual',
      calldataOffset: 96n,
      referenceValue: FLOOR,
    })
    expect(capIndex).toBe(rules.length - 1)
    expect(floorIndex).toBeLessThan(capIndex)
  })

  test('no rule reads calls[], so only the head bounds bind', () => {
    // The bare Swapper pins nothing past the eight-word head (calls[] starts at
    // 224), so the route is free and the floor is what bounds it.
    for (const selector of [SWAP_EXACT_IN_SELECTOR, SWAP_EXACT_OUT_SELECTOR]) {
      for (const rule of rulesOf(actionFor(resolve().actions, selector))) {
        expect(rule.calldataOffset < 224n).toBe(true)
      }
    }
    expect(resolve().exactIn(exactIn(CAP, 0n))).toBe(false)
    expect(resolve().exactOut(exactOut(CAP, 0n))).toBe(false)
  })
})

describe('stableFloor — the input cap', () => {
  test('exact-in amountIn over the cap is refused', () => {
    expect(resolve().exactIn(exactIn(CAP + 1n, FLOOR))).toBe(false)
  })

  test('exact-out amountInMax over the cap is refused', () => {
    expect(resolve().exactOut(exactOut(CAP + 1n, FLOOR))).toBe(false)
  })

  test('the cap is cumulative across calls', () => {
    const { exactIn: inPolicy, exactOut: outPolicy } = resolve()
    expect(inPolicy(exactIn(600_000n, FLOOR))).toBe(true)
    expect(inPolicy(exactIn(600_000n, FLOOR))).toBe(false)
    expect(outPolicy(exactOut(600_000n, FLOOR))).toBe(true)
    expect(outPolicy(exactOut(600_000n, FLOOR))).toBe(false)
  })
})

describe('stableFloor — amounts', () => {
  test('custom maxSlippageBps', () => {
    const { exactIn: inPolicy } = resolve(
      scope({ stableFloor: { maxSlippageBps: 50 } }),
    )
    expect(inPolicy(exactIn(CAP, 995_000n))).toBe(true)
    expect(
      resolve(scope({ stableFloor: { maxSlippageBps: 50 } })).exactIn(
        exactIn(CAP, 994_999n),
      ),
    ).toBe(false)
  })

  test('zero slippage floors at the cap itself', () => {
    const { exactIn: inPolicy } = resolve(
      scope({ stableFloor: { maxSlippageBps: 0 } }),
    )
    expect(inPolicy(exactIn(CAP, CAP))).toBe(true)
    expect(inPolicy(exactIn(CAP, CAP - 1n))).toBe(false)
  })

  test('scales 6 → 18 decimals', () => {
    const s = scope({ buy: { token: USDC_E18 } })
    const floor = 990_000_000_000_000_000n
    expect(resolve(s).exactIn(exactIn(CAP, floor, USDC_E18))).toBe(true)
    expect(resolve(s).exactIn(exactIn(CAP, floor - 1n, USDC_E18))).toBe(false)
  })

  test('scales 18 → 6 decimals, rounding the floor up', () => {
    const cap = 10n ** 18n + 1n
    const s = scope({
      sell: { token: USDC_E18, maxTotal: cap },
      buy: { token: USDC },
    })
    const rules = rulesOf(actionFor(resolve(s).actions, SWAP_EXACT_IN_SELECTOR))
    // (1e18 + 1) × 0.99 / 1e12 = 990000.00000000000099, so the floor is 990001.
    expect(rules.find((r) => r.calldataOffset === 96n)?.referenceValue).toBe(
      990_001n,
    )
  })

  test('a venue-level maxSpend sets both the cap and the floor', () => {
    const s = scope({ via: [rhinestoneSwap({ maxSpend: 500_000n })] })
    const { exactIn: inPolicy } = resolve(s)
    expect(inPolicy(exactIn(500_000n, 494_999n))).toBe(false)
    expect(inPolicy(exactIn(500_000n, 495_000n))).toBe(true)
  })
})

describe('stableFloor — refusals', () => {
  const refuses = (s: SwapScopeInput, message: RegExp, catalog = CATALOG) =>
    expect(() => resolveSwapScope(s, PLASMA, 'production', catalog)).toThrow(
      message,
    )

  test('two sell tokens', () => {
    refuses(
      scope({ sell: { tokens: [USDT0, USDC_E18], maxTotal: CAP } }),
      /exactly one sell token/,
    )
  })

  test('no maxTotal', () => {
    refuses(scope({ sell: { token: USDT0 } }), /needs swap\.sell\.maxTotal/)
  })

  test('a token the orchestrator does not serve as a stablecoin, on either side', () => {
    refuses(
      scope({ buy: { token: DAI } }),
      /buy token .* is not a USD stablecoin the orchestrator serves/,
    )
    refuses(
      scope({ sell: { token: ATTACKER, maxTotal: CAP } }),
      /sell token .* is not a USD stablecoin the orchestrator serves/,
    )
  })

  test('no catalog at all', () => {
    expect(() => resolveSwapScope(scope(), PLASMA)).toThrow(
      /needs the orchestrator's stablecoins/,
    )
    expect(() =>
      toSession({
        chain: plasma,
        owners: { type: 'ecdsa', accounts: [accountA] },
        swap: scope(),
      }),
    ).toThrow(/needs the orchestrator's stablecoins/)
  })

  test('an aggregator venue, alone or beside the Swapper', () => {
    refuses(
      scope({ via: [fynd()] }),
      /only the Rhinestone Swapper venue, not fynd/,
    )
    refuses(
      scope({ via: [rhinestoneSwap(), zeroEx({ settler: SETTLER })] }),
      /only the Rhinestone Swapper venue, not 0x/,
    )
  })

  test('slippage outside [0, 10000) or fractional', () => {
    for (const maxSlippageBps of [10_000, -1, 1.5]) {
      refuses(scope({ stableFloor: { maxSlippageBps } }), /maxSlippageBps/)
    }
  })
})

describe('stableFloor — catalog integrity', () => {
  const withCatalog = (catalog: ServedStablecoin[]) => () =>
    resolveSwapScope(scope(), PLASMA, 'production', catalog)
  const others = CATALOG.filter((t) => t.symbol !== 'USDC')

  test.each([0, 8, 24])('refuses a stable with %i decimals', (decimals) => {
    expect(
      withCatalog([...others, { address: USDC, symbol: 'USDC', decimals }]),
    ).toThrow(/has \d+ decimals; expected 6 or 18/)
  })

  test('refuses a token listed twice, even with equal metadata', () => {
    const usdc = { address: USDC, symbol: 'USDC', decimals: 6 }
    expect(
      withCatalog([
        ...others,
        usdc,
        { ...usdc, address: USDC.toLowerCase() as Address },
      ]),
    ).toThrow(/appears 2 times in the served stablecoins/)
  })
})

describe('stableFloor — side doors', () => {
  const session = (extra: Record<string, unknown>) => () =>
    toSession(
      {
        chain: plasma,
        owners: { type: 'ecdsa', accounts: [accountA] },
        swap: scope(),
        ...extra,
      },
      { settlement: SERVED },
    )

  test('builds with no other grant and signing left unset or disabled', () => {
    expect(session({})).not.toThrow()
    expect(session({ signing: { mode: 'disabled' } })).not.toThrow()
  })

  test.each([
    ['unrestricted', { mode: 'unrestricted' }],
    [
      'scoped',
      {
        mode: 'scoped',
        allowedContents: [
          {
            domain: { name: 'Permit2', chainId: PLASMA },
            types: { Transfer: [{ name: 'amount', type: 'uint256' }] },
            primaryType: 'Transfer',
          },
        ],
      },
    ],
  ])('refuses %s signing', (_name, signing) => {
    expect(session({ signing })).toThrow(/cannot enable `signing`/)
  })

  test('refuses a user permission on the sell token', () => {
    expect(
      session({
        permissions: [
          { abi: erc20Abi, address: USDT0, functions: { transfer: {} } },
        ],
      }),
    ).toThrow(/also grants an action on/)
  })

  test.each([
    ['Permit2', '0x000000000022D473030F116dDEE9F6B43aC78BA3'],
    ['the Swapper', swapperAddresses('production').swapper],
    ['the sell token', USDT0.toLowerCase()],
  ])('refuses a raw action on %s', (_name, target) => {
    expect(session({ actions: [{ target, selector: '0x12345678' }] })).toThrow(
      /also grants an action on/,
    )
  })

  // A SAME_CHAIN_IE permit compiles to a `transfer` on its source token, a
  // different selector from the swap's approve, so no duplicate guard sees it.
  test('refuses a cross-chain permit that transfers the sell token', () => {
    expect(
      session({
        crossChainPermits: [
          {
            from: { chain: plasma, token: USDT0 },
            to: { chain: plasma, token: USDT0, recipient: ATTACKER },
            settlementLayers: ['SAME_CHAIN_IE'],
            allowRecipientNotAccount: true,
          },
        ],
      }),
    ).toThrow(/cannot be combined with `crossChainPermits`/)
  })

  test('refuses claim policies', () => {
    expect(
      session({ claimPolicies: [{ policy: ATTACKER, initData: '0x' }] }),
    ).toThrow(/cannot be combined with `crossChainPermits` or `claimPolicies`/)
  })

  test('allows an unrelated user permission', () => {
    expect(
      session({
        permissions: [
          { abi: erc20Abi, address: DAI, functions: { transfer: {} } },
        ],
      }),
    ).not.toThrow()
  })
})

describe('stableFloor — salt', () => {
  const build = (swap: SwapScopeInput, extra: Record<string, unknown> = {}) =>
    toSession(
      {
        chain: plasma,
        owners: { type: 'ecdsa', accounts: [accountA] },
        swap,
        ...extra,
      },
      { settlement: SERVED },
    )

  test('never shares a permissionId with the same scope unfloored', () => {
    const floored = build(scope())
    const unfloored = build({ ...scope(), stableFloor: undefined })
    expect(unfloored.salt).toBe(zeroHash)
    expect(floored.salt).not.toBe(zeroHash)
    expect(getPermissionId(floored)).not.toBe(getPermissionId(unfloored))
  })

  test("overrides saltMode 'none' and refuses 'v1'", () => {
    expect(build(scope(), { saltMode: 'none' }).salt).toBe(build(scope()).salt)
    expect(() => build(scope(), { saltMode: 'v1' })).toThrow(
      /cannot use saltMode 'v1'/,
    )
  })
})

describe('stableFloor off', () => {
  const build = (swap: SwapScopeInput, served?: boolean) =>
    toSession(
      { chain: plasma, owners: { type: 'ecdsa', accounts: [accountA] }, swap },
      served ? { settlement: SERVED } : {},
    )
  const digest = (swap: SwapScopeInput, served?: boolean) =>
    keccak256(
      toHex(
        JSON.stringify(getSessionData(build(swap, served)), (_k, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
      ),
    )

  // Captured from main before stableFloor existed.
  test.each([
    [
      'default Swapper',
      { sell: { token: USDT0 }, buy: { token: USDC }, to: ACCOUNT },
      '0x7a024ed0b8211641268fce4d1de03ba36bfe2e36a77b478276408d39f172b393',
    ],
    [
      'capped Swapper',
      {
        sell: { token: USDT0, maxTotal: CAP },
        buy: { token: USDC },
        to: ACCOUNT,
      },
      '0xec0e76b3fe1000926d15b011811e725e3d883ddbff344bf8293e6d1cfa7e970e',
    ],
    [
      'two sell tokens',
      {
        sell: { tokens: [USDT0, DAI], maxTotal: 9n },
        buy: { token: USDC },
        to: ACCOUNT,
        via: [fynd()],
      },
      '0x2cca6ce8fa8c9068f1751e53e249307000672255c568d5be5207c6f0f69423c9',
    ],
  ] as [string, SwapScopeInput, Hex][])(
    '%s: session data unchanged, with or without served stablecoins',
    (_name, swap, expected) => {
      expect(digest(swap)).toBe(expected)
      expect(digest(swap, true)).toBe(expected)
    },
  )
})
