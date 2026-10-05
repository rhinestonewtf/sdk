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
  OTHER,
  PLASMA,
  stargate,
  USDC_ARB,
  USDC_BASE,
  USDC_PLASMA,
} from '../../../../../test/utils/lz-calldata'
import {
  satisfiesRules as holds,
  type RuleUsage,
} from '../../../../../test/utils/policy-rules'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { encodeSessionPolicy } from '../policies/encode'
import { LZ_CCTP_MAX_RELAY_FEE, LZ_EXECUTE_SELECTOR, scopeLz } from './lz'
import type { SettlementCatalog, SettlementContext } from './types'

/** Fields the key may choose: the quote id, fees, and amounts under the cap. */
const FREE: Record<string, readonly string[]> = {
  delegateTransferFrom: ['amount'],
  approve: ['amount'],
  transfer: ['amount'],
  send: ['amountLD', 'minAmountLD', 'nativeFee'],
  depositForBurn: ['amount', 'maxFee', 'minFinalityThreshold'],
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

describe('scopeLz', () => {
  const action = scopeLz(context())

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
    ['taxi', () => execute(stargate('taxi'))],
    ['bus', () => execute(stargate('bus'))],
    ['cctp', () => execute(cctp())],
  ])('accepts the API %s batch', (_, data) => {
    expect(holds(action, data())).toBe(true)
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
    ['taxi', (a: bigint) => execute(stargate('taxi', { amount: a }))],
    ['bus', (a: bigint) => execute(stargate('bus', { amount: a }))],
    ['cctp', (a: bigint) => execute(cctp({ pull: a }))],
  ])('caps the %s pull at maxAmount', (_, data) => {
    expect(holds(action, data(CAP))).toBe(true)
    expect(holds(action, data(CAP + 1n))).toBe(false)
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
    ['taxi', () => execute(stargate('taxi', { amount: 1n }))],
    ['cctp', () => execute(cctp({ pull: 1n, fee: 0n }))],
  ])(
    'admits one execute per session: after %s, no route runs again',
    (_, first) => {
      // Even with a stale TransferDelegate allowance to fund it, a second
      // route would pull another maxAmount, and a second send another fee.
      const usage: RuleUsage = new Map()
      expect(holds(action, first(), usage)).toBe(true)
      for (const again of [
        execute(stargate('taxi', { amount: 1n })),
        execute(stargate('bus', { amount: 1n })),
        execute(cctp({ pull: 1n, fee: 0n })),
      ]) {
        expect(holds(action, again, usage)).toBe(false)
      }
    },
  )

  test('a refused execute does not use up the session', () => {
    const usage: RuleUsage = new Map()
    expect(holds(action, execute(stargate('taxi', { to: OTHER })), usage)).toBe(
      false,
    )
    expect(holds(action, execute(stargate('taxi')), usage)).toBe(true)
  })

  test('refuses a zero-amount Stargate send', () => {
    expect(holds(action, execute(stargate('taxi', { amount: 0n })))).toBe(false)
  })

  test.each([
    ['taxi', () => execute(stargate('taxi', { to: OTHER }))],
    ['taxi eid', () => execute(stargate('taxi', { eid: 30101 }))],
    ['bus', () => execute(stargate('bus', { to: OTHER }))],
    ['cctp', () => execute(cctp({ to: OTHER }))],
    ['cctp domain', () => execute(cctp({ domain: 0 }))],
  ])('refuses a %s batch to another destination', (_, data) => {
    expect(holds(action, data())).toBe(false)
  })

  test('refuses an extra, missing or reordered nested call', () => {
    const calls = stargate('taxi')
    const drain = call(USDC_BASE, fn('transfer', [OTHER, 1n]))
    expect(holds(action, execute([...calls, drain]))).toBe(false)
    expect(holds(action, execute(calls.slice(0, 3)))).toBe(false)
    expect(
      holds(action, execute([calls[0], calls[1], calls[3], calls[2]])),
    ).toBe(false)
  })

  test.each([
    ['taxi', () => execute(stargate('taxi'))],
    ['bus', () => execute(stargate('bus'))],
    ['cctp', () => execute(cctp())],
  ])(
    'accepts a byte-flipped %s batch only when no pinned field changed',
    (_, data) => {
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
  )

  test('binds only the leg its own route delivers', () => {
    const both = scopeLz(
      context({
        destinations: [
          { chainId: ARB, token: USDC_ARB, recipient: ACCOUNT },
          { chainId: PLASMA, token: USDC_PLASMA, recipient: OTHER },
        ],
      }),
    )
    expect(holds(both, execute(stargate('taxi')))).toBe(true)
    expect(holds(both, execute(cctp({}, true)))).toBe(false)
    expect(holds(both, execute(cctp({ to: OTHER }, true)))).toBe(true)
    // Plasma has no Stargate pool, so its recipient does not open a send.
    expect(holds(both, execute(stargate('taxi', { to: OTHER })))).toBe(false)
  })

  test("leaves the recipient open for 'any'", () => {
    const open = scopeLz(
      context({ destinations: [{ chainId: ARB, token: USDC_ARB }] }),
    )
    expect(holds(open, execute(stargate('bus', { to: OTHER })))).toBe(true)
    expect(holds(open, execute(cctp({ to: OTHER })))).toBe(true)
    expect(holds(open, execute(stargate('bus', { eid: 30101 })))).toBe(false)
  })

  test('without a cap, the pull is unbounded but the layout still binds', () => {
    const uncapped = scopeLz(context({ cap: undefined }))
    const big = 10n ** 30n
    expect(holds(uncapped, execute(stargate('taxi', { amount: big })))).toBe(
      true,
    )
    expect(holds(uncapped, execute(stargate('taxi', { to: OTHER })))).toBe(
      false,
    )
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
    // A Stargate leg and a feeless CCTP leg: all three layouts, and it fits.
    expect(
      policy([
        { chainId: ARB, token: USDC_ARB, recipient: ACCOUNT },
        { chainId: PLASMA, token: USDC_PLASMA, recipient: OTHER },
      ]),
    ).not.toThrow()
    expect(
      policy([
        ...destinations,
        { chainId: PLASMA, token: USDC_PLASMA, recipient: OTHER },
      ]),
    ).toThrow(/max is 128/)
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
          { chainId: ARB, token: USDC_ARB, recipient: ACCOUNT },
        ],
      }),
    )
    expect(holds(mixed, execute(stargate('taxi')))).toBe(true)
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

  test('needs the account and exactly one source token', () => {
    expect(() => scopeLz(context({ account: undefined }))).toThrow(/account/)
    expect(() =>
      scopeLz(context({ sourceTokens: [USDC_BASE, USDC_BASE] })),
    ).toThrow(/exactly one/)
  })
})
