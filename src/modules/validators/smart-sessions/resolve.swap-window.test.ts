import { type Address, type Chain, erc20Abi, isAddressEqual } from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { accountA } from '../../../../test/consts'
import { SETTLEMENT_CATALOG } from '../../../../test/utils/settlement-catalog'
import { TIME_FRAME_POLICY_ADDRESS } from './policies/addresses'
import { resolveSessionData, toSession } from './resolve'
import { fynd } from './swap/fynd'
import { resolveSwapScope } from './swap/scope'
import { zeroEx } from './swap/zero-ex'
import type {
  ResolvedAction,
  ResolvedPolicy,
  ServedStablecoin,
  SessionDefinition,
  SwapScopeInput,
} from './types'

// These tests assume the TimeFramePolicy is deployed on their chains.
vi.mock('./policies/addresses', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./policies/addresses')>()),
  timeFramePolicyDeployed: () => true,
}))

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address
const WETH = '0x4200000000000000000000000000000000000006' as Address
const DAI = '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const TARGET = '0x4444444444444444444444444444444444444444' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
const SETTLER = '0x7F2194E8d4D5B5F889b17aeCe891F89Da74F5384' as Address
const UNTIL = new Date(2_000_000_000_000)
const AFTER = new Date(1_900_000_000_000)
const FAR_FUTURE = 4_102_444_800n
const owners = { type: 'ecdsa' as const, accounts: [accountA] }
const seconds = (date: Date) => BigInt(date.getTime() / 1000)
const T = seconds(UNTIL)

const swap = (extra: Partial<SwapScopeInput> = {}): SwapScopeInput => ({
  sell: { tokens: [WETH, DAI] },
  buy: { token: USDC },
  to: ACCOUNT,
  via: [zeroEx({ settler: SETTLER }), fynd()],
  ...extra,
})

const resolve = (definition: Partial<SessionDefinition>) =>
  resolveSessionData(
    { chain: base, owners, ...definition } as SessionDefinition,
    {
      settlement: SETTLEMENT_CATALOG,
    },
  ).actions

/** encodePacked(uint48 validUntil, uint48 validAfter), in seconds. */
const framesOf = (policies: readonly ResolvedPolicy[]) =>
  policies
    .filter((p) => isAddressEqual(p.policy, TIME_FRAME_POLICY_ADDRESS))
    .map(({ initData }) => ({
      validUntil: BigInt(`0x${initData.slice(2, 14)}`),
      validAfter: BigInt(`0x${initData.slice(14, 26)}`),
    }))

const windowsOf = (action: ResolvedAction) => framesOf(action.actionPolicies)

const window = (validUntil = FAR_FUTURE, validAfter = 0n) => [
  { validUntil, validAfter },
]

/** The (target, selector) of every action the swap scope compiles to. */
function swapActionKeys(
  scope: SwapScopeInput,
  {
    environment = 'production',
    chainId = base.id,
    stablecoins,
  }: {
    environment?: 'production' | 'development'
    chainId?: number
    stablecoins?: readonly ServedStablecoin[]
  } = {},
): string[] {
  const { permissions, actions } = resolveSwapScope(
    scope,
    chainId,
    environment,
    stablecoins,
  )
  return [
    ...permissions.map((p) => `${p.address}:0x095ea7b3`),
    ...actions.map((a) => `${a.target}:${a.selector}`),
  ].map((key) => key.toLowerCase())
}

const keyOf = (a: ResolvedAction) =>
  `${a.actionTarget}:${a.actionTargetSelector}`.toLowerCase()

describe("a swap scope's window", () => {
  test.each([
    ['validUntil', { validUntil: UNTIL }, window(T)],
    ['validAfter', { validAfter: AFTER }, window(FAR_FUTURE, seconds(AFTER))],
    [
      'validAfter and validUntil',
      { validAfter: AFTER, validUntil: UNTIL },
      window(T, seconds(AFTER)),
    ],
  ])('%s goes on every approve and venue action', (_, w, expected) => {
    const keys = swapActionKeys(swap())
    // Both sell tokens' approves, the 0x and fynd calls, and the Swapper's
    // exact-in and exact-out calls that wrap them.
    expect(keys).toHaveLength(6)
    const actions = resolve({ swap: swap(w) })
    expect(actions.map(keyOf)).toEqual(expect.arrayContaining(keys))
    for (const action of actions.filter((a) => keys.includes(keyOf(a)))) {
      expect(windowsOf(action)).toEqual(expected)
    }
  })

  test('goes on the default Swapper venue', () => {
    const scope = swap({ sell: { token: WETH }, via: undefined })
    const keys = swapActionKeys(scope)
    const actions = resolve({
      swap: { ...scope, validUntil: UNTIL },
    }).filter((a) => keys.includes(keyOf(a)))
    expect(actions).toHaveLength(keys.length)
    for (const action of actions) expect(windowsOf(action)).toEqual(window(T))
  })

  test('a validAfter between seconds opens at the next one', () => {
    const keys = swapActionKeys(swap())
    const actions = resolve({
      swap: swap({ validAfter: new Date(AFTER.getTime() + 1) }),
    }).filter((a) => keys.includes(keyOf(a)))
    expect(actions).toHaveLength(keys.length)
    for (const action of actions) {
      expect(windowsOf(action)).toEqual(window(FAR_FUTURE, seconds(AFTER) + 1n))
    }
  })

  test('without one, no swap action carries a time frame', () => {
    for (const action of resolve({ swap: swap() })) {
      expect(windowsOf(action)).toEqual([])
    }
  })

  test("beside a permit's window, each holds on its own actions", () => {
    const actions = resolve({
      account: ACCOUNT,
      swap: swap({ validUntil: UNTIL }),
      crossChainPermits: [
        {
          from: { chain: base, token: USDC },
          to: { chain: arbitrum, token: USDC_ARB },
          settlementLayers: ['ACROSS'],
          preClaimOps: 'none',
          validAfter: AFTER,
          validUntil: new Date(UNTIL.getTime() - 7_000),
        },
      ],
    })
    const keys = swapActionKeys(swap())
    const swapActions = actions.filter((a) => keys.includes(keyOf(a)))
    const permitActions = actions.filter((a) => !keys.includes(keyOf(a)))
    expect(swapActions).toHaveLength(keys.length)
    expect(permitActions.length).toBeGreaterThan(0)
    for (const action of swapActions) {
      expect(windowsOf(action)).toEqual(window(T))
    }
    for (const action of permitActions) {
      expect(windowsOf(action)).toEqual(window(T - 7n, seconds(AFTER)))
    }
  })

  test('bounds an open signing surface, as an action window does', () => {
    const { erc1271Policies } = resolveSessionData(
      {
        chain: base,
        owners,
        swap: swap({ validAfter: AFTER, validUntil: UNTIL }),
        signing: { mode: 'unrestricted' },
      },
      { settlement: SETTLEMENT_CATALOG },
    ).erc7739Policies
    expect(framesOf(erc1271Policies)).toEqual(window(T, seconds(AFTER)))
  })

  test("saltMode 'v1' keeps the window", () => {
    for (const environment of ['production', 'development'] as const) {
      const { actions } = resolveSessionData(
        {
          chain: base,
          owners,
          saltMode: 'v1',
          swap: swap({ validUntil: UNTIL }),
        },
        { environment },
      )
      const keys = swapActionKeys(swap(), { environment })
      const swapActions = actions.filter((a) => keys.includes(keyOf(a)))
      expect(swapActions).toHaveLength(keys.length)
      for (const action of swapActions) {
        expect(windowsOf(action)).toEqual(window(T))
      }
    }
  })
})

test('a stableFloor scope takes a window on its approve and Swapper call', () => {
  const USDT0 = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb' as Address
  const USDC_PLASMA = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address
  const plasma = { id: 9745, name: 'Plasma' } as unknown as Chain
  const usdStablecoins = [
    { address: USDT0, symbol: 'USDT0', decimals: 6 },
    { address: USDC_PLASMA, symbol: 'USDC', decimals: 6 },
  ]
  const scope: SwapScopeInput = {
    sell: { token: USDT0, maxTotal: 1_000_000n },
    buy: { token: USDC_PLASMA },
    to: ACCOUNT,
    stableFloor: true,
  }
  const { actions } = resolveSessionData(
    { chain: plasma, owners, swap: { ...scope, validUntil: UNTIL } },
    { settlement: { [plasma.id]: { usdStablecoins } } as never },
  )
  const keys = swapActionKeys(scope, {
    chainId: plasma.id,
    stablecoins: usdStablecoins,
  })
  const swapActions = actions.filter((a) => keys.includes(keyOf(a)))
  expect(swapActions).toHaveLength(keys.length)
  for (const action of swapActions) expect(windowsOf(action)).toEqual(window(T))
})

test('each window holds only on the actions it was set on', () => {
  const PERMISSION_UNTIL = new Date(UNTIL.getTime() - 50_000)
  const PERMIT_UNTIL = new Date(UNTIL.getTime() - 100_000)
  const TRANSFER = '0xa9059cbb'
  const actions = resolve({
    account: ACCOUNT,
    oneTimeUse: { id: 7n },
    policyAddresses: { oneTimeUseId: ONE_TIME_USE },
    swap: swap({ validUntil: UNTIL }),
    permissions: [
      {
        abi: erc20Abi,
        address: DAI,
        functions: { transfer: { validUntil: PERMISSION_UNTIL } },
      },
    ],
    actions: [{ target: TARGET, selector: '0x12345678' }],
    crossChainPermits: [
      {
        from: { chain: base, token: USDC, maxAmount: 100n },
        to: { chain: arbitrum, token: USDC_ARB, recipient: ACCOUNT },
        settlementLayers: ['ECO_IE'],
        maxFeeBps: 100,
        validUntil: PERMIT_UNTIL,
      },
    ],
  })
  const keys = swapActionKeys(swap())
  const at = (target: Address, selector?: string) =>
    actions.filter(
      (a) =>
        isAddressEqual(a.actionTarget, target) &&
        (selector === undefined || a.actionTargetSelector === selector),
    )
  const swapActions = actions.filter((a) => keys.includes(keyOf(a)))
  const own = new Set([
    ...swapActions,
    ...at(DAI, TRANSFER),
    ...at(TARGET),
    ...at(ONE_TIME_USE),
  ])
  const permitActions = actions.filter((a) => !own.has(a))
  expect(swapActions).toHaveLength(keys.length)
  expect(at(DAI, TRANSFER)).toHaveLength(1)
  expect(at(TARGET)).toHaveLength(1)
  expect(permitActions.length).toBeGreaterThan(0)
  for (const action of swapActions) expect(windowsOf(action)).toEqual(window(T))
  expect(windowsOf(at(DAI, TRANSFER)[0])).toEqual(
    window(seconds(PERMISSION_UNTIL)),
  )
  for (const action of [...at(TARGET), ...at(ONE_TIME_USE)]) {
    expect(windowsOf(action)).toEqual([])
  }
  for (const action of permitActions) {
    expect(windowsOf(action)).toEqual(window(seconds(PERMIT_UNTIL)))
  }
})

describe('a windowed swap scope gets its own permissionId', () => {
  const id = (scope: SwapScopeInput, saltMode?: 'v1' | 'strict') =>
    toSession({
      chain: base,
      owners,
      swap: scope,
      ...(saltMode && { saltMode }),
    }).permissionId

  test('under the default salt', () => {
    const windowless = id(swap())
    expect(windowless).toBe(toSession({ chain: base, owners }).permissionId)
    expect(id(swap({ validUntil: UNTIL }))).not.toBe(windowless)
    expect(id(swap({ validUntil: UNTIL }))).not.toBe(
      id(swap({ validUntil: new Date(UNTIL.getTime() + 1_000) })),
    )
  })

  test("saltMode 'v1' keeps its own salt, which hashes the windowed actions", () => {
    const windowed = id(swap({ validUntil: UNTIL }), 'v1')
    expect(windowed).not.toBe(id(swap(), 'v1'))
    // The 'v1' salt, as before swap windows were salted.
    expect(windowed).toBe(
      '0x6f01c96b4b47efa89c4976efb796ae9f266583e1fba222ba24edf9cb4ba7f9c8',
    )
  })
})
