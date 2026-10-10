import {
  type Address,
  type Chain,
  decodeAbiParameters,
  isAddressEqual,
} from 'viem'
import { arbitrum, base, plasma } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../../test/consts'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { TIME_FRAME_POLICY_ADDRESS } from '../policies/addresses'
import { DUMMY_PRECLAIMOP_TARGET, resolveSessionData } from '../resolve'
import type {
  CrossChainPermissionInput,
  ResolvedAction,
  SessionDefinition,
} from '../types'
import type { SettlementCatalog } from './types'

/**
 * A settlement-scoped permit's window is a time-frame policy on each action the
 * permit contributes. The once-policy deadline is `oneTimeUse.validUntil` alone.
 */

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address
const WETH = '0x4200000000000000000000000000000000000006' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
const OFT_ARB = SETTLEMENT_CATALOG[arbitrum.id].oft!
const OFT_PLASMA = SETTLEMENT_CATALOG[plasma.id].oft!
const FEES = {
  appFeeCollector: '0x5555555555555555555555555555555555555555',
  paymaster: '0x6666666666666666666666666666666666666666',
} as const
const WITH_FEES: SettlementCatalog = {
  ...SETTLEMENT_CATALOG,
  [base.id]: { ...SETTLEMENT_CATALOG[base.id], fees: FEES },
  [arbitrum.id]: { ...SETTLEMENT_CATALOG[arbitrum.id], fees: FEES },
}

const UNTIL = 2_000_000_000n
const AFTER = 1_900_000_000n
// Year 2100: an open validUntil.
const FAR_FUTURE = 4_102_444_800n
const date = (seconds: bigint) => new Date(Number(seconds) * 1000)

interface Shape {
  readonly permit: Partial<CrossChainPermissionInput>
  readonly chain?: Chain
  readonly settlement?: SettlementCatalog
  readonly oneTimeUse: boolean
}

const BASE_TO_ARB = {
  from: { chain: base, token: USDC, maxAmount: 100n },
  to: { chain: arbitrum, token: USDC_ARB },
}
const SAME_CHAIN_TRANSFER: Partial<CrossChainPermissionInput> = {
  from: { chain: base, token: USDC, maxAmount: 100n },
  to: { chain: base, token: USDC, recipient: OTHER },
  allowRecipientNotAccount: true,
  settlementLayers: ['SAME_CHAIN_IE'],
}
const SAME_CHAIN_SWAP: Partial<CrossChainPermissionInput> = {
  from: { chain: base, token: USDC, maxAmount: 100n },
  to: { chain: base, token: WETH, recipient: ACCOUNT, minAmount: 5n },
  settlementLayers: ['SAME_CHAIN_IE'],
}

const SHAPES: Record<string, Shape> = {
  CCTP: {
    permit: { ...BASE_TO_ARB, settlementLayers: ['CCTP'] },
    oneTimeUse: true,
  },
  'CCTP without oneTimeUse': {
    permit: {
      from: { chain: base, token: USDC },
      to: { chain: arbitrum, token: USDC_ARB },
      settlementLayers: ['CCTP'],
    },
    oneTimeUse: false,
  },
  'CCTP with fees': {
    permit: { ...BASE_TO_ARB, settlementLayers: ['CCTP'], allowFees: true },
    settlement: WITH_FEES,
    oneTimeUse: true,
  },
  'CCTP with fees, without oneTimeUse': {
    permit: {
      from: { chain: base, token: USDC },
      to: { chain: arbitrum, token: USDC_ARB },
      settlementLayers: ['CCTP'],
      allowFees: true,
    },
    settlement: WITH_FEES,
    oneTimeUse: false,
  },
  ECO_IE: {
    permit: { ...BASE_TO_ARB, settlementLayers: ['ECO_IE'], maxFeeBps: 50 },
    oneTimeUse: true,
  },
  LZ: {
    permit: { ...BASE_TO_ARB, settlementLayers: ['LZ'] },
    oneTimeUse: true,
  },
  OFT: {
    permit: {
      from: { chain: arbitrum, token: OFT_ARB.token, maxAmount: 100n },
      to: { chain: plasma, token: OFT_PLASMA.token },
      settlementLayers: ['OFT'],
    },
    chain: arbitrum,
    oneTimeUse: true,
  },
  'all with fees': {
    permit: {
      ...BASE_TO_ARB,
      settlementLayers: 'all',
      maxFeeBps: 50,
      allowFees: true,
    },
    settlement: WITH_FEES,
    oneTimeUse: true,
  },
  'all, ECO_IE dropped': {
    permit: { ...BASE_TO_ARB, settlementLayers: 'all' },
    oneTimeUse: true,
  },
  'SAME_CHAIN_IE transfer': { permit: SAME_CHAIN_TRANSFER, oneTimeUse: true },
  'SAME_CHAIN_IE transfer without oneTimeUse': {
    permit: {
      ...SAME_CHAIN_TRANSFER,
      from: { chain: base, token: USDC },
    },
    oneTimeUse: false,
  },
  'SAME_CHAIN_IE swap': { permit: SAME_CHAIN_SWAP, oneTimeUse: true },
  'SAME_CHAIN_IE swap with fees': {
    permit: { ...SAME_CHAIN_SWAP, allowFees: true },
    settlement: WITH_FEES,
    oneTimeUse: true,
  },
}

interface Window {
  readonly validUntil?: bigint
  readonly validAfter?: bigint
}

function definitionOf(
  shape: Shape,
  window: Window,
  once?: bigint,
): SessionDefinition {
  return {
    chain: shape.chain ?? base,
    owners: { type: 'ecdsa', accounts: [accountA] },
    account: ACCOUNT,
    ...(shape.oneTimeUse && {
      oneTimeUse: {
        id: 7n,
        ...(once === undefined ? {} : { validUntil: date(once) }),
      },
      policyAddresses: { oneTimeUseId: ONE_TIME_USE },
    }),
    crossChainPermits: [
      {
        ...shape.permit,
        ...(window.validUntil === undefined
          ? {}
          : { validUntil: date(window.validUntil) }),
        ...(window.validAfter === undefined
          ? {}
          : { validAfter: date(window.validAfter) }),
      },
    ],
  } as SessionDefinition
}

function resolve(shape: Shape, window: Window, once?: bigint) {
  return resolveSessionData(definitionOf(shape, window, once), {
    settlement: shape.settlement ?? SETTLEMENT_CATALOG,
  }).actions
}

const timeFrameOf = (action: ResolvedAction) => {
  const initData = action.actionPolicies.find((p) =>
    isAddressEqual(p.policy, TIME_FRAME_POLICY_ADDRESS),
  )?.initData
  // encodePacked(uint48 validUntil, uint48 validAfter)
  return initData === undefined
    ? undefined
    : {
        validUntil: BigInt(`0x${initData.slice(2, 14)}`),
        validAfter: BigInt(`0x${initData.slice(14, 26)}`),
      }
}

const onceInitData = (action: ResolvedAction) =>
  action.actionPolicies.find((p) => isAddressEqual(p.policy, ONE_TIME_USE))
    ?.initData

/** OneTimeUseIdPolicy's initData: abi.encode(id, deadline). */
function deadlineOf(action: ResolvedAction) {
  const initData = onceInitData(action)
  if (!initData) return undefined
  return decodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    initData,
  )[1]
}

const isBurn = (action: ResolvedAction) =>
  isAddressEqual(action.actionTarget, ONE_TIME_USE)
// Injected for every session without oneTimeUse; the permit contributes none.
const isDummy = (action: ResolvedAction) =>
  isAddressEqual(action.actionTarget, DUMMY_PRECLAIMOP_TARGET)

const WINDOWS: Record<string, Window> = {
  validUntil: { validUntil: UNTIL },
  validAfter: { validAfter: AFTER },
  'validAfter and validUntil': { validAfter: AFTER, validUntil: UNTIL },
}

const ONCE_DEADLINES: Record<string, bigint | undefined> = {
  'no once-deadline': undefined,
  'earlier once-deadline': UNTIL - 1000n,
  'later once-deadline': UNTIL + 1000n,
}

describe("a permit's window is a time-frame policy on each action it contributes", () => {
  const cases = Object.entries(SHAPES).flatMap(([shapeName, shape]) =>
    Object.entries(WINDOWS).flatMap(([windowName, window]) =>
      Object.entries(shape.oneTimeUse ? ONCE_DEADLINES : { '': undefined }).map(
        ([onceName, once]) =>
          [
            [shapeName, windowName, onceName].filter(Boolean).join(', '),
            shape,
            window,
            once,
          ] as const,
      ),
    ),
  )

  test.each(cases)('%s', (_, shape, window, once) => {
    const actions = resolve(shape, window, once)
    const scoped = actions.filter((a) => !isBurn(a) && !isDummy(a))
    expect(scoped.length).toBeGreaterThan(0)
    for (const action of scoped) {
      expect(timeFrameOf(action)).toEqual({
        validUntil: window.validUntil ?? FAR_FUTURE,
        validAfter: window.validAfter ?? 0n,
      })
    }
    for (const action of actions.filter((a) => isBurn(a) || isDummy(a))) {
      expect(timeFrameOf(action)).toBeUndefined()
    }
    if (!shape.oneTimeUse) return
    // The window is not folded into the once-policy deadline.
    for (const action of actions) expect(deadlineOf(action)).toBe(once ?? 0n)
    // OneTimeUseIdPolicy requires one config across the session's actions.
    expect(new Set(actions.map(onceInitData)).size).toBe(1)
  })

  test.each(Object.entries(SHAPES))(
    '%s without a window has none',
    (_, shape) => {
      for (const action of resolve(shape, {})) {
        expect(timeFrameOf(action)).toBeUndefined()
      }
    },
  )
})

describe('an IntentExecutor-layer permit validUntil must be in the future', () => {
  const INVALID: Record<string, Date> = {
    'before 1970': new Date('1960-01-01'),
    'the epoch': new Date(0),
    'in the past': new Date(Date.now() - 86_400_000),
    'not a date': new Date(Number.NaN),
  }
  const shapes = [
    ['CCTP', SHAPES.CCTP],
    ['CCTP without oneTimeUse', SHAPES['CCTP without oneTimeUse']],
  ] as const
  const cases = shapes.flatMap(([shapeName, shape]) =>
    Object.entries(INVALID).map(
      ([name, validUntil]) =>
        [`${shapeName}, ${name}`, shape, validUntil] as const,
    ),
  )

  test.each(cases)('%s', (_, shape, validUntil) => {
    const definition = definitionOf(shape, {})
    definition.crossChainPermits = [
      { ...definition.crossChainPermits![0], validUntil },
    ]
    expect(() =>
      resolveSessionData(definition, { settlement: SETTLEMENT_CATALOG }),
    ).toThrow(
      'crossChainPermits[0]: validUntil must be a valid Date in the future',
    )
  })
})

test('a validAfter later than validUntil is refused', () => {
  expect(() =>
    resolve(SHAPES.CCTP, { validAfter: UNTIL + 1n, validUntil: UNTIL }),
  ).toThrow('validAfter (2000000001) is greater than validUntil (2000000000)')
})
