import {
  type Address,
  decodeFunctionData,
  type Hex,
  maxUint256,
  toHex,
} from 'viem'
import { describe, expect, test } from 'vitest'
import {
  ACCOUNT,
  ARB,
  abi,
  BASE,
  CAP,
  type Call,
  call,
  cctp,
  context,
  execute,
  fn,
  lz,
  MC,
  multiCallReverts,
  OTHER,
  PLASMA,
  SONEIUM,
  SONEIUM_EID,
  stargate,
  USDC_ARB,
  USDC_BASE,
  USDC_PLASMA,
  USDC_SONEIUM,
} from '../../../../../test/utils/lz-calldata'
import {
  satisfiesRules as holds,
  type RuleUsage,
} from '../../../../../test/utils/policy-rules'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { encodeSessionPolicy } from '../policies/encode'
import { pinValue } from '../swap/rules'
import type { ArgPolicyExpression } from '../types'
import {
  LZ_CCTP_MAX_RELAY_FEE,
  LZ_EXECUTE_SELECTOR,
  sameRule,
  scopeLz,
} from './lz'
import type { SettlementCatalog, SettlementContext } from './types'

/** Fields the key may choose: the quote id, fees, and amounts under the cap. */
const FREE: Record<string, readonly string[]> = {
  delegateTransferFrom: ['amount'],
  approve: ['amount'],
  transfer: ['amount'],
  send: ['amountLD', 'minAmountLD', 'nativeFee'],
  depositForBurn: ['amount', 'burnToken', 'maxFee', 'minFinalityThreshold'],
  sweep: [],
}

/** The calls with every free field blanked, for comparing two batches. */
function pinnedView(data: Hex) {
  const { args } = decodeFunctionData({ abi, data })
  const [calls] = args as unknown as [Call[]]
  return calls.map((c) => {
    const inner = decodeFunctionData({ abi, data: c.data })
    const free = FREE[inner.functionName]
    const blank = (value: unknown, names: readonly string[]): unknown => {
      if (Array.isArray(value)) return value.map((v) => blank(v, names))
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [
            k,
            names.includes(k) ? '*' : blank(v, names),
          ]),
        )
      }
      return value
    }
    const params = abi.find(
      (item) => item.type === 'function' && item.name === inner.functionName,
    )
    const named = Object.fromEntries(
      (params && 'inputs' in params ? params.inputs : []).map((input, i) => [
        input.name,
        (inner.args as readonly unknown[])[i],
      ]),
    )
    return {
      target: c.target.toLowerCase(),
      value: inner.functionName === 'send' ? '*' : c.value,
      fn: inner.functionName,
      args: blank(named, free),
    }
  })
}

const revertsOnChain = (data: Hex) => {
  try {
    return multiCallReverts(data, ACCOUNT)
  } catch {
    return false
  }
}

const ARB_LEG = { chainId: ARB, token: USDC_ARB, recipient: ACCOUNT }
const SONEIUM_LEG = {
  chainId: SONEIUM,
  token: USDC_SONEIUM,
  recipient: ACCOUNT,
}

/** The API's Stargate TAXI batch into Soneium, which no CCTP route reaches. */
const taxi = (o: Parameters<typeof stargate>[1] = {}) =>
  execute(stargate('taxi', { eid: SONEIUM_EID, ...o }))

describe('scopeLz', () => {
  // Base -> Arbitrum, which CCTP reaches: no Stargate route.
  const action = scopeLz(context())
  const toSoneium = scopeLz(context({ destinations: [SONEIUM_LEG] }))

  test('targets the chain LZMultiCall execute and admits native value', () => {
    expect(action.target).toBe(MC)
    expect(action.selector).toBe(LZ_EXECUTE_SELECTOR)
    const policy = action.policies?.[0]
    expect(policy?.type).toBe('arg-policy')
    expect(policy?.type === 'arg-policy' && policy.valueLimitPerUse).toBe(
      maxUint256,
    )
  })

  test.each([
    ['taxi', () => toSoneium, () => taxi()],
    ['cctp', () => action, () => execute(cctp())],
  ])('accepts the API %s batch', (_, permit, data) => {
    expect(holds(permit(), data())).toBe(true)
  })

  test('refuses Stargate TAXI into a leg a CCTP route reaches', () => {
    expect(holds(action, execute(stargate('taxi')))).toBe(false)
    const both = scopeLz(context({ destinations: [ARB_LEG, SONEIUM_LEG] }))
    expect(holds(both, execute(stargate('taxi')))).toBe(false)
    expect(holds(both, taxi())).toBe(true)
    expect(holds(both, execute(cctp()))).toBe(true)
  })

  test('refuses the API Stargate BUS batch', () => {
    expect(
      holds(toSoneium, execute(stargate('bus', { eid: SONEIUM_EID }))),
    ).toBe(false)
  })

  test('accepts the feeless CCTP batch to Plasma', () => {
    const toPlasma = scopeLz(
      context({
        destinations: [
          { chainId: PLASMA, token: USDC_PLASMA, recipient: ACCOUNT },
        ],
      }),
    )
    expect(holds(toPlasma, execute(cctp({}, true)))).toBe(true)
    // A fee transfer on a feeless leg, or no fee where one is due, is refused.
    expect(holds(toPlasma, execute(cctp({ domain: 33 })))).toBe(false)
    expect(holds(action, execute(cctp({ domain: 3 }, true)))).toBe(false)
  })

  test.each([
    ['taxi', () => toSoneium, (a: bigint) => taxi({ amount: a })],
    ['cctp', () => action, (a: bigint) => execute(cctp({ pull: a }))],
  ])('caps the %s pull at maxAmount', (_, permit, data) => {
    expect(holds(permit(), data(CAP))).toBe(true)
    expect(holds(permit(), data(CAP + 1n))).toBe(false)
  })

  test('caps the feeless CCTP pull at maxAmount', () => {
    const toPlasma = scopeLz(
      context({
        destinations: [
          { chainId: PLASMA, token: USDC_PLASMA, recipient: ACCOUNT },
        ],
      }),
    )
    expect(holds(toPlasma, execute(cctp({ pull: CAP }, true)))).toBe(true)
    expect(holds(toPlasma, execute(cctp({ pull: CAP + 1n }, true)))).toBe(false)
  })

  test('caps the CCTP relay fee at maxAmount and the fixed ceiling', () => {
    expect(holds(action, execute(cctp({ fee: CAP })))).toBe(false)
    const large = scopeLz(context({ cap: 10n * LZ_CCTP_MAX_RELAY_FEE }))
    const fee = (f: bigint) =>
      execute(cctp({ pull: 5n * LZ_CCTP_MAX_RELAY_FEE, fee: f }))
    expect(holds(large, fee(LZ_CCTP_MAX_RELAY_FEE))).toBe(true)
    expect(holds(large, fee(LZ_CCTP_MAX_RELAY_FEE + 1n))).toBe(false)
    const uncapped = scopeLz(context({ cap: undefined }))
    expect(holds(uncapped, fee(LZ_CCTP_MAX_RELAY_FEE + 1n))).toBe(false)
  })

  test.each([
    ['taxi', () => taxi({ amount: 1n })],
    ['cctp', () => execute(cctp({ pull: 1n, fee: 0n }))],
  ])(
    'admits one execute per session: after %s, no route runs again',
    (_, first) => {
      // Even with a stale TransferDelegate allowance to fund it, a second
      // route would pull another maxAmount, and a second send another fee.
      const both = scopeLz(context({ destinations: [ARB_LEG, SONEIUM_LEG] }))
      const usage: RuleUsage = new Map()
      expect(holds(both, first(), usage)).toBe(true)
      for (const again of [
        taxi({ amount: 1n }),
        execute(cctp({ pull: 1n, fee: 0n })),
      ]) {
        expect(holds(both, again, usage)).toBe(false)
      }
    },
  )

  test('a refused execute does not use up the session', () => {
    const usage: RuleUsage = new Map()
    expect(holds(toSoneium, taxi({ to: OTHER }), usage)).toBe(false)
    expect(holds(toSoneium, taxi(), usage)).toBe(true)
  })

  test('refuses a zero-amount Stargate send', () => {
    expect(holds(toSoneium, taxi({ amount: 0n }))).toBe(false)
  })

  test.each([
    ['taxi', () => toSoneium, () => taxi({ to: OTHER })],
    ['taxi eid', () => toSoneium, () => taxi({ eid: 30101 })],
    ['cctp', () => action, () => execute(cctp({ to: OTHER }))],
    ['cctp domain', () => action, () => execute(cctp({ domain: 0 }))],
  ])('refuses a %s batch to another destination', (_, permit, data) => {
    expect(holds(permit(), data())).toBe(false)
  })

  test('refuses an extra, missing or reordered nested call', () => {
    const calls = stargate('taxi', { eid: SONEIUM_EID })
    const drain = call(USDC_BASE, fn('transfer', [OTHER, 1n]))
    expect(holds(toSoneium, execute(calls))).toBe(true)
    expect(holds(toSoneium, execute([...calls, drain]))).toBe(false)
    expect(holds(toSoneium, execute(calls.slice(0, 3)))).toBe(false)
    expect(
      holds(toSoneium, execute([calls[0], calls[1], calls[3], calls[2]])),
    ).toBe(false)
  })

  test.each([
    ['taxi', () => toSoneium, () => taxi()],
    ['cctp', () => action, () => execute(cctp())],
  ])(
    'accepts a byte-flipped %s batch only when no pinned field changed',
    (_, permit, data) => {
      const action = permit()
      const original = data()
      const expected = pinnedView(original)
      const bytes = Buffer.from(original.slice(2), 'hex')
      let accepted = 0
      for (let i = 4; i < bytes.length; i++) {
        for (const mask of [0x01, 0x80]) {
          const flipped = Buffer.from(bytes)
          flipped[i] ^= mask
          const mutated = toHex(flipped)
          if (!holds(action, mutated)) continue
          accepted++
          // LZMultiCall reverts these on-chain, whatever the policy says.
          if (revertsOnChain(mutated)) continue
          let view: ReturnType<typeof pinnedView>
          try {
            view = pinnedView(mutated)
          } catch (error) {
            // The length-and-selector pin leaves a length word's top 4 bytes
            // open; any flip there is a length past 2^224, which fails to
            // decode on-chain too.
            expect((error as Error).name, `byte ${i} ^ ${mask}`).toBe(
              'IntegerOutOfRangeError',
            )
            continue
          }
          expect(view, `byte ${i} ^ ${mask}`).toEqual(expected)
        }
      }
      // Free fields exist, so some flips must pass: the check is not vacuous.
      expect(accepted).toBeGreaterThan(0)
    },
    // Two flips per byte of the batch: past the 5s default under coverage.
    30_000,
  )

  test('binds only the leg its own route delivers', () => {
    const both = scopeLz(
      context({
        destinations: [
          SONEIUM_LEG,
          { chainId: PLASMA, token: USDC_PLASMA, recipient: OTHER },
        ],
      }),
    )
    expect(holds(both, taxi())).toBe(true)
    expect(holds(both, execute(cctp({}, true)))).toBe(false)
    expect(holds(both, execute(cctp({ to: OTHER }, true)))).toBe(true)
    // Plasma has no Stargate pool, so its recipient does not open a send.
    expect(holds(both, taxi({ to: OTHER }))).toBe(false)
  })

  test("leaves the recipient open for 'any'", () => {
    const open = scopeLz(
      context({
        destinations: [
          { chainId: ARB, token: USDC_ARB },
          { chainId: SONEIUM, token: USDC_SONEIUM },
        ],
      }),
    )
    expect(holds(open, taxi({ to: OTHER }))).toBe(true)
    expect(holds(open, execute(cctp({ to: OTHER })))).toBe(true)
    expect(holds(open, taxi({ eid: 30101 }))).toBe(false)
  })

  test('without a cap, the pull is unbounded but the layout still binds', () => {
    const uncapped = scopeLz(
      context({ destinations: [SONEIUM_LEG], cap: undefined }),
    )
    const big = 10n ** 30n
    expect(holds(uncapped, taxi({ amount: big }))).toBe(true)
    expect(holds(uncapped, taxi({ to: OTHER }))).toBe(false)
  })

  test('refuses a permit that would exceed the ArgPolicy rule limit', () => {
    const destinations = [1, 10, 130, 137, 143, 146, 999, 42161, 43114].map(
      (chainId, i) => ({
        chainId,
        token:
          chainId === 130
            ? ('0x078D782b760474a361dDA0AF3839290b0EF57AD6' as Address)
            : chainId === 143
              ? ('0x754704Bc059F8C67012fEd69BC8A327a5aafb603' as Address)
              : chainId === 999
                ? ('0xb88339CB7199b77E23DB6E890353E22632Ba630f' as Address)
                : lz(chainId).stargateUsdc!.token,
        recipient: `0x${(i + 1).toString(16).padStart(40, '0')}` as Address,
      }),
    )
    const policy = (legs: SettlementContext['destinations']) => {
      const p = scopeLz(context({ destinations: legs })).policies?.[0]
      if (!p) throw new Error('no policy')
      return () => encodeSessionPolicy(p, 'production')
    }
    // Every destination LZ serves from Base, in all three layouts, fits.
    const all = [
      ...destinations,
      SONEIUM_LEG,
      { chainId: PLASMA, token: USDC_PLASMA, recipient: OTHER },
    ]
    expect(policy(all)).not.toThrow()
    // Each further recipient adds a branch, until it no longer fits.
    const more = Array.from({ length: 12 }, (_, n) => ({
      ...ARB_LEG,
      recipient: `0x${(0x20 + n).toString(16).padStart(40, '0')}` as Address,
    }))
    expect(policy([...all, ...more.slice(0, 11)])).not.toThrow()
    expect(policy([...all, ...more])).toThrow(/max is 128/)
  })

  test('refuses a token LZ does not move', () => {
    expect(() => scopeLz(context({ sourceTokens: [OTHER] }))).toThrow(
      /moves only USDC/,
    )
    expect(() =>
      scopeLz(
        context({
          destinations: [{ chainId: ARB, token: OTHER, recipient: ACCOUNT }],
        }),
      ),
    ).toThrow(/delivers only USDC/)
    expect(() => scopeLz(context({ chainId: 56 }))).toThrow(
      /does not route from chain 56/,
    )
  })

  test('skips legs no route from this chain reaches', () => {
    // A multi-chain permit names legs for other chains' sessions too.
    const mixed = scopeLz(
      context({
        destinations: [
          { chainId: BASE, token: USDC_BASE, recipient: OTHER },
          { chainId: 56, token: OTHER, recipient: OTHER },
          ARB_LEG,
        ],
      }),
    )
    expect(holds(mixed, execute(cctp()))).toBe(true)
    expect(() =>
      scopeLz(
        context({
          destinations: [{ chainId: BASE, token: USDC_BASE, recipient: OTHER }],
        }),
      ),
    ).toThrow(/no route from chain 8453/)
  })

  test('refuses Ink USDC.e, which the orchestrator does not quote', () => {
    expect(() =>
      scopeLz(
        context({
          chainId: 57073,
          target: lz(57073).multiCall,
          sourceTokens: ['0xF1815bd50389c46847f0Bda824eC8da914045D14'],
        }),
      ),
    ).toThrow(/moves only USDC/)
  })

  /** The fixture with one chain's `lz` block replaced (undefined drops it). */
  const withLz = (
    chainId: number,
    block: NonNullable<SettlementCatalog[number]['lz']> | undefined,
  ): SettlementCatalog => {
    const { lz: _, ...rest } = SETTLEMENT_CATALOG[chainId]
    return {
      ...SETTLEMENT_CATALOG,
      [chainId]: block ? { ...rest, lz: block } : rest,
    }
  }

  test('pins the relay fee to the source chain served receiver', () => {
    const settlement = withLz(BASE, {
      ...lz(BASE),
      cctp: { ...lz(BASE).cctp!, feeReceiver: OTHER },
    })
    const moved = scopeLz(context({ settlement }))
    expect(holds(moved, execute(cctp({ receiver: OTHER })))).toBe(true)
    expect(holds(moved, execute(cctp()))).toBe(false)
  })

  test('drops the fee transfer where the destination is served feeless', () => {
    const settlement = withLz(ARB, {
      ...lz(ARB),
      cctp: { ...lz(ARB).cctp!, feeless: true },
    })
    const feeless = scopeLz(context({ settlement }))
    expect(holds(feeless, execute(cctp({ domain: 3 }, true)))).toBe(true)
    expect(holds(feeless, execute(cctp()))).toBe(false)
  })

  test('admits Stargate TAXI where no CCTP route reaches the leg', () => {
    const { cctp: _, ...noCctp } = lz(ARB)
    const intoArb = scopeLz(context({ settlement: withLz(ARB, noCctp) }))
    expect(holds(intoArb, execute(stargate('taxi')))).toBe(true)
    expect(holds(intoArb, execute(cctp()))).toBe(false)
    // A source without CCTP has no CCTP route to any leg.
    const { cctp: __, ...noSourceCctp } = lz(BASE)
    const fromBase = scopeLz(
      context({ settlement: withLz(BASE, noSourceCctp) }),
    )
    expect(holds(fromBase, execute(stargate('taxi')))).toBe(true)
    expect(holds(fromBase, execute(cctp()))).toBe(false)
  })

  test('admits Stargate TAXI for a Stargate USDC that CCTP does not mint', () => {
    const settlement = withLz(ARB, {
      ...lz(ARB),
      stargateUsdc: { ...lz(ARB).stargateUsdc!, token: OTHER },
    })
    const toStargateUsdc = scopeLz(
      context({
        settlement,
        destinations: [{ chainId: ARB, token: OTHER, recipient: ACCOUNT }],
      }),
    )
    expect(holds(toStargateUsdc, execute(stargate('taxi')))).toBe(true)
    expect(holds(toStargateUsdc, execute(cctp()))).toBe(false)
    // The CCTP USDC leg on the same pair still gets CCTP only.
    const toCctpUsdc = scopeLz(context({ settlement }))
    expect(holds(toCctpUsdc, execute(cctp()))).toBe(true)
    expect(holds(toCctpUsdc, execute(stargate('taxi')))).toBe(false)
  })

  test('routes only through the blocks the orchestrator serves', () => {
    const { stargateUsdc: _, ...noPool } = lz(ARB)
    const cctpOnly = scopeLz(context({ settlement: withLz(ARB, noPool) }))
    expect(holds(cctpOnly, execute(cctp()))).toBe(true)
    expect(holds(cctpOnly, execute(stargate('taxi')))).toBe(false)
    expect(() =>
      scopeLz(context({ settlement: withLz(ARB, undefined) })),
    ).toThrow(/no route from chain 8453/)
    expect(() =>
      scopeLz(context({ settlement: withLz(BASE, undefined) })),
    ).toThrow(/does not route from chain 8453/)
  })

  test('never shares a usage-limited rule between branches', () => {
    const rule = pinValue(0x40n, 4n)
    expect(sameRule(rule, { ...rule })).toBe(true)
    const limited = { ...rule, usageLimit: 4n }
    expect(sameRule(limited, { ...limited })).toBe(false)
  })

  test('needs the account and exactly one source token', () => {
    expect(() => scopeLz(context({ account: undefined }))).toThrow(/account/)
    expect(() =>
      scopeLz(context({ sourceTokens: [USDC_BASE, USDC_BASE] })),
    ).toThrow(/exactly one/)
  })
})

describe('scopeLz to.minAmount', () => {
  const FLOOR = 9_800_000n
  const floored = (minAmount: bigint = FLOOR) =>
    scopeLz(context({ destinations: [{ ...SONEIUM_LEG, minAmount }] }))

  test('admits a Stargate send whose minAmountLD is at or above the floor', () => {
    expect(holds(floored(), taxi())).toBe(true)
    expect(holds(floored(), taxi({ minAmount: FLOOR }))).toBe(true)
    expect(holds(floored(), taxi({ minAmount: CAP }))).toBe(true)
  })

  test('refuses a Stargate send that accepts less than the floor', () => {
    expect(holds(floored(), taxi({ minAmount: FLOOR - 1n }))).toBe(false)
    expect(holds(floored(), taxi({ minAmount: 0n }))).toBe(false)
    // Without the floor the key may accept any shortfall.
    expect(holds(toSoneiumUnfloored(), taxi({ minAmount: 0n }))).toBe(true)
  })

  test('the floor binds only its own leg', () => {
    const arbStargate = (() => {
      const { cctp: _, ...noCctp } = lz(ARB)
      return {
        ...SETTLEMENT_CATALOG,
        [ARB]: { ...SETTLEMENT_CATALOG[ARB], lz: noCctp },
      }
    })()
    const both = scopeLz(
      context({
        settlement: arbStargate,
        destinations: [{ ...SONEIUM_LEG, minAmount: FLOOR }, ARB_LEG],
      }),
    )
    expect(holds(both, taxi({ minAmount: FLOOR - 1n }))).toBe(false)
    expect(holds(both, execute(stargate('taxi', { minAmount: 0n })))).toBe(true)
  })

  test('adds one rule and keeps a one-leg policy free of ORs', () => {
    const count = (e: ArgPolicyExpression): { rules: number; ors: number } =>
      e.type === 'rule'
        ? { rules: 1, ors: 0 }
        : e.type === 'not'
          ? count(e.child)
          : (() => {
              const l = count(e.left)
              const r = count(e.right)
              return {
                rules: l.rules + r.rules,
                ors: l.ors + r.ors + (e.type === 'or' ? 1 : 0),
              }
            })()
    const expr = (a: ReturnType<typeof scopeLz>) => {
      const policy = a.policies![0]
      if (policy.type !== 'arg-policy') throw new Error('not an arg-policy')
      return policy.expression
    }
    const before = count(expr(toSoneiumUnfloored()))
    const after = count(expr(floored()))
    expect(after).toEqual({ rules: before.rules + 1, ors: before.ors })
    expect(after.ors).toBe(0)
  })

  test('refuses a floor no Stargate route can carry', () => {
    // CCTP reaches Arbitrum from Base, and depositForBurn has no minimum out.
    expect(() =>
      scopeLz(context({ destinations: [{ ...ARB_LEG, minAmount: FLOOR }] })),
    ).toThrow('only on a Stargate send')
  })

  test('refuses a floor that is not positive', () => {
    expect(() => floored(0n)).toThrow(/positive/)
  })

  test('refuses a floor across tokens whose decimals are not served equal', () => {
    const { usdStablecoins: _, ...soneium } = SETTLEMENT_CATALOG[SONEIUM]
    expect(() =>
      scopeLz(
        context({
          settlement: { ...SETTLEMENT_CATALOG, [SONEIUM]: soneium },
          destinations: [{ ...SONEIUM_LEG, minAmount: FLOOR }],
        }),
      ),
    ).toThrow(/decimals/)
    expect(() =>
      scopeLz(
        context({
          settlement: {
            ...SETTLEMENT_CATALOG,
            [SONEIUM]: {
              ...soneium,
              usdStablecoins: [
                { address: USDC_SONEIUM, symbol: 'USDC', decimals: 18 },
              ],
            },
          },
          destinations: [{ ...SONEIUM_LEG, minAmount: FLOOR }],
        }),
      ),
    ).toThrow(/decimals/)
  })

  test('refuses a second leg into the floored chain, which would bypass the floor', () => {
    for (const second of [
      SONEIUM_LEG,
      { ...SONEIUM_LEG, minAmount: 1n },
      { ...SONEIUM_LEG, recipient: undefined },
    ]) {
      expect(() =>
        scopeLz(
          context({
            destinations: [{ ...SONEIUM_LEG, minAmount: FLOOR }, second],
          }),
        ),
      ).toThrow(/one `to` leg/)
    }
  })

  test('refuses a floor Stargate could not read as a uint64', () => {
    expect(() =>
      scopeLz(
        context({
          cap: undefined,
          destinations: [{ ...SONEIUM_LEG, minAmount: 2n ** 64n }],
        }),
      ),
    ).toThrow(/uint64/)
    expect(
      holds(
        scopeLz(
          context({
            cap: undefined,
            destinations: [{ ...SONEIUM_LEG, minAmount: 2n ** 64n - 1n }],
          }),
        ),
        taxi({ minAmount: 2n ** 64n - 1n }),
      ),
    ).toBe(true)
  })
})

function toSoneiumUnfloored() {
  return scopeLz(context({ destinations: [SONEIUM_LEG] }))
}
