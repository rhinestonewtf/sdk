import {
  type Abi,
  type Address,
  type Chain,
  encodeFunctionData,
  type Hex,
  keccak256,
  slice,
  toHex,
} from 'viem'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../../test/consts'
import { namedParamOffsets } from '../../permissions'
import { getSessionData } from '../digest'
import { toSession } from '../resolve'
import type {
  ScopedAction,
  SessionTokenInfo,
  SwapScopeInput,
  UniversalActionPolicyParamRule,
} from '../types'
import { fynd } from './fynd'
import {
  rhinestoneSwap,
  SWAP_EXACT_IN_SELECTOR,
  SWAP_EXACT_OUT_SELECTOR,
  swapperAbi,
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

const CATALOG: SessionTokenInfo[] = [
  { address: USDT0.toLowerCase(), symbol: 'USDT0', decimals: 6 },
  { address: USDC, symbol: 'USDC', decimals: 6 },
  // Synthetic 18-decimal stable, as BSC's USDC/USDT are.
  { address: USDC_E18, symbol: 'USDC.e', decimals: 18 },
  { address: DAI, symbol: 'DAI', decimals: 18 },
]

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

const drainRoute = [
  {
    target: USDT0,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'transfer',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [{ name: '', type: 'bool' }],
        },
      ],
      functionName: 'transfer',
      args: [ATTACKER, CAP],
    }),
  },
] as const

function exactIn(
  amountIn: bigint,
  minAmountOut: bigint,
  calls: readonly { target: Address; value: bigint; data: Hex }[] = [],
  buy: Address = USDC,
): Hex {
  return encodeFunctionData({
    abi: swapperAbi,
    functionName: 'swapExactIn',
    args: [USDT0, amountIn, buy, minAmountOut, 0n, ACCOUNT, 0n, calls],
  })
}

function exactOut(
  amountInMax: bigint,
  amountOut: bigint,
  calls: readonly { target: Address; value: bigint; data: Hex }[] = [],
): Hex {
  return encodeFunctionData({
    abi: swapperAbi,
    functionName: 'swapExactOut',
    args: [USDT0, amountInMax, USDC, amountOut, 0n, ACCOUNT, 0n, calls],
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

  test('the route is irrelevant: a draining route still has to meet the floor', () => {
    expect(resolve().exactIn(exactIn(CAP, 0n, drainRoute))).toBe(false)
    expect(resolve().exactOut(exactOut(CAP, 0n, drainRoute))).toBe(false)
    // Whatever the route does, the Swapper enforces the recipient's delta.
    expect(resolve().exactIn(exactIn(CAP, FLOOR, drainRoute))).toBe(true)
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

  test('a refused call does not consume the cap', () => {
    const { exactIn: inPolicy } = resolve()
    expect(inPolicy(exactIn(CAP, FLOOR - 1n))).toBe(false)
    expect(inPolicy(exactIn(CAP, FLOOR))).toBe(true)
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
    expect(inPolicy(exactIn(CAP, CAP - 1n))).toBe(false)
  })

  test('scales 6 → 18 decimals', () => {
    const s = scope({ buy: { token: USDC_E18 } })
    const floor = 990_000_000_000_000_000n
    expect(resolve(s).exactIn(exactIn(CAP, floor, [], USDC_E18))).toBe(true)
    expect(resolve(s).exactIn(exactIn(CAP, floor - 1n, [], USDC_E18))).toBe(
      false,
    )
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

  test('a non-stable token on either side', () => {
    refuses(
      scope({ buy: { token: DAI } }),
      /buy token .* \(DAI\) is not a USD stablecoin/,
    )
    refuses(
      scope({ sell: { token: DAI, maxTotal: CAP } }),
      /sell token .* \(DAI\) is not a USD stablecoin/,
    )
  })

  test('a token the catalog does not list', () => {
    refuses(
      scope({ buy: { token: ATTACKER } }),
      /buy token .* is not in the chain’s token catalog/,
    )
  })

  test('a catalog that lists all tokens', () => {
    refuses(scope(), /lists all tokens/, 'all' as never)
  })

  test('no catalog at all', () => {
    expect(() => resolveSwapScope(scope(), PLASMA)).toThrow(
      /needs the chain’s token catalog/,
    )
    expect(() =>
      toSession({
        chain: plasma,
        owners: { type: 'ecdsa', accounts: [accountA] },
        swap: scope(),
      }),
    ).toThrow(/needs the chain’s token catalog/)
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

describe('stableFloor off', () => {
  const build = (swap: SwapScopeInput, supportedTokens?: SessionTokenInfo[]) =>
    toSession(
      { chain: plasma, owners: { type: 'ecdsa', accounts: [accountA] }, swap },
      supportedTokens ? { supportedTokens } : {},
    )
  const digest = (swap: SwapScopeInput, supportedTokens?: SessionTokenInfo[]) =>
    keccak256(
      toHex(
        JSON.stringify(getSessionData(build(swap, supportedTokens)), (_k, v) =>
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
      'Swapper with maxSpend',
      {
        sell: { token: USDT0, maxTotal: CAP },
        buy: { token: USDC },
        to: ACCOUNT,
        via: [rhinestoneSwap({ maxSpend: 5n })],
      },
      '0xd5c6e5146131385265a508c1f3999990670b4228b73f2d73ce4ab8b72ee94311',
    ],
    [
      'fynd',
      {
        sell: { token: USDT0, maxTotal: CAP },
        buy: { token: USDC },
        to: ACCOUNT,
        via: [fynd()],
      },
      '0xd1f55bcc11b4a6026fe42c7d781ee66ec7d288a5f7d540ad8f8da956272126a5',
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
    '%s: session data unchanged, with or without a catalog',
    (_name, swap, expected) => {
      expect(digest(swap)).toBe(expected)
      expect(digest(swap, CATALOG)).toBe(expected)
      expect(
        getSessionData(build({ ...swap, stableFloor: undefined })),
      ).toEqual(getSessionData(build(swap)))
    },
  )
})
