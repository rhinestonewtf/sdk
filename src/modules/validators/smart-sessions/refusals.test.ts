import type { Address, Chain } from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../test/consts'
import { SETTLEMENT_CATALOG } from '../../../../test/utils/settlement-catalog'
import {
  CROSS_CHAIN_PERMIT_REFUSAL_CODES,
  type CrossChainPermitRefusal,
  collectRefusals,
  RefusalCollectionHalted,
  recover,
  refusal,
  refuser,
} from './refusals'
import {
  collectSessionRefusals,
  type ResolveSessionOptions,
  toSession,
} from './resolve'
import { SettlementLayerRefusal } from './settlement/served'
import type { CrossChainPermissionInput, SessionDefinition } from './types'

const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
const USDC = SETTLEMENT_CATALOG[base.id].cctp!.usdc
const USDC_ARB = SETTLEMENT_CATALOG[arbitrum.id].cctp!.usdc
const USDT_ARB = SETTLEMENT_CATALOG[arbitrum.id].oft!.token
const UNSERVED = { ...base, id: 424242 } as Chain
const OPTIONS: ResolveSessionOptions = { settlement: SETTLEMENT_CATALOG }

const cctp = (
  permit: Partial<CrossChainPermissionInput> = {},
): CrossChainPermissionInput => ({
  from: { chain: base, token: USDC },
  to: { chain: arbitrum, token: USDC_ARB },
  settlementLayers: ['CCTP'],
  ...permit,
})

const permit2 = (
  permit: Partial<CrossChainPermissionInput> = {},
): CrossChainPermissionInput => ({
  from: { chain: base, token: USDC },
  to: { chain: arbitrum, token: USDC_ARB },
  settlementLayers: ['ACROSS'],
  ...permit,
})

const session = (
  crossChainPermits: CrossChainPermissionInput[],
  extra: Partial<SessionDefinition> = {},
): SessionDefinition =>
  ({
    chain: base,
    owners: { type: 'ecdsa', accounts: [accountA] },
    account: ACCOUNT,
    crossChainPermits,
    ...extra,
  }) as SessionDefinition

const oneTimeUse = {
  oneTimeUse: { id: 7n },
  policyAddresses: { oneTimeUseId: ONE_TIME_USE },
} as Partial<SessionDefinition>

function thrown(
  definition: SessionDefinition,
  options: ResolveSessionOptions = OPTIONS,
): string | undefined {
  try {
    toSession(definition, options)
    return undefined
  } catch (error) {
    return (error as Error).message
  }
}

describe('refusal codes', () => {
  test('the published codes do not change', () => {
    expect(Object.keys(CROSS_CHAIN_PERMIT_REFUSAL_CODES)).toEqual([
      'VALID_AFTER_AFTER_VALID_UNTIL',
      'SESSION_WINDOW_REQUIRES_ONE_TIME_USE',
      'VALID_UNTIL_NOT_IN_FUTURE',
      'PERMIT2_MAX_AMOUNT_REQUIRES_ONE_TIME_USE',
      'SETTLEMENT_SCOPED_SALT_V1',
      'MIXED_PERMIT_KINDS',
      'MULTIPLE_INTENT_EXECUTOR_PERMITS',
      'PERMIT2_LAYER_WITH_INTENT_EXECUTOR_LAYER',
      'SAME_CHAIN_WITH_OTHER_LAYERS',
      'NO_FROM_ON_CHAIN',
      'MAX_AMOUNT_REQUIRES_ONE_TIME_USE',
      'MULTIPLE_MAX_AMOUNTS',
      'RECIPIENT_ANY_NOT_ALLOWED',
      'RECIPIENT_NEEDS_ACCOUNT',
      'RECIPIENT_NOT_ACCOUNT',
      'MISSING_TO',
      'FILL_DEADLINE_ONLY_PERMIT2',
      'MAX_FEE_BPS_ONLY_ECO',
      'MIN_AMOUNT_ON_PERMIT2_LAYER',
      'SAME_CHAIN_TRANSFER_MIN_AMOUNT',
      'MIN_AMOUNT_OUTSIDE_CAP',
      'MIN_AMOUNT_NOT_ENFORCEABLE',
      'MIN_AMOUNT_NOT_POSITIVE',
      'MIN_AMOUNT_ABOVE_UINT64',
      'FLOOR_DECIMALS_MISMATCH',
      'CONFLICTING_LEG_FLOORS',
      'LZ_FLOORED_LEG_NOT_ALONE',
      'LZ_FLOOR_ON_CCTP_ROUTE',
      'SETTLEMENT_CATALOG_MISSING',
      'LAYER_REQUIRES_ONE_TIME_USE',
      'LAYER_NOT_SERVED',
      'MAX_FEE_BPS_ECO_UNAVAILABLE',
      'NO_LAYER_CAN_SETTLE',
      'MULTIPLE_FEE_PAYING_LAYERS',
      'ONE_SOURCE_TOKEN',
      'TOKEN_NOT_ROUTED',
      'ECO_STABLECOIN_DECIMALS',
      'ACCOUNT_REQUIRED',
      'ECO_NEEDS_MAX_AMOUNT_AND_FEE',
      'MAX_FEE_BPS_OUT_OF_RANGE',
      'ECO_NEEDS_VALID_UNTIL',
      'ECO_VALIDITY_TOO_SHORT',
      'ECO_FLOOR_NEEDS_EQUAL_CAPS',
      'RECIPIENT_ANY_UNPINNABLE',
      'ECO_NO_SHARED_PROVER',
      'LZ_NO_ROUTE',
      'NATIVE_SOURCE_UNSUPPORTED',
      'SAME_CHAIN_OTHER_CHAIN_LEG',
      'SAME_CHAIN_TRANSFER_TO_SELF',
      'SAME_CHAIN_ANY_RECIPIENT_NEEDS_MAX_AMOUNT',
      'SAME_CHAIN_TRANSFER_OR_SINGLE_SWAP',
      'SAME_CHAIN_SWAP_NEEDS_MIN_AMOUNT',
      'SAME_CHAIN_SWAP_NEEDS_MAX_AMOUNT',
      'ALLOW_FEES_CATALOG_MISSING',
      'FEES_NOT_SERVED',
      'ALLOW_FEES_NON_STABLECOIN',
      'ALLOW_FEES_ONLY_INTENT_EXECUTOR',
      'SCOPE_INVARIANT',
      'ALL_LAYERS_NO_PERMIT2_CLAIM',
      'SIGNING_WITH_INTENT_EXECUTOR_PERMIT',
      'RESTRICTED_WITH_PERMIT2_PERMIT',
      'WRAPPED_NATIVE_TOKEN_UNSERVED',
      'SESSION_REFUSED',
    ])
    for (const code of Object.keys(CROSS_CHAIN_PERMIT_REFUSAL_CODES)) {
      expect(code).toMatch(/^[A-Z0-9]+(_[A-Z0-9]+)*$/)
    }
  })

  test('a coded refusal keeps its error class', () => {
    const plain = refusal('MISSING_TO', 'message')
    expect(plain.constructor).toBe(Error)
    expect(plain).toMatchObject({ code: 'MISSING_TO', message: 'message' })
    const layer = new SettlementLayerRefusal('message', {
      code: 'LAYER_NOT_SERVED',
      chainId: 1,
    })
    expect(layer).toBeInstanceOf(SettlementLayerRefusal)
    expect(layer).toMatchObject({ code: 'LAYER_NOT_SERVED', chainId: 1 })
  })
})

describe('collectSessionRefusals', () => {
  test('a valid permit reports nothing', () => {
    const definition = session([cctp()])
    expect(thrown(definition)).toBeUndefined()
    expect(collectSessionRefusals(definition, OPTIONS)).toEqual([])
  })

  test('a permit with independent problems reports each of them', () => {
    const definition = session(
      [
        cctp({
          from: { chain: base, token: USDC, maxAmount: 100n },
          fillDeadline: [{ chain: arbitrum, max: new Date(2_000_000_000_000) }],
          settlementLayers: ['CCTP', 'OFT'],
        }),
      ],
      { signing: { mode: 'unrestricted' } } as Partial<SessionDefinition>,
    )
    const refusals = collectSessionRefusals(definition, OPTIONS)
    expect(refusals).toEqual([
      {
        code: 'MAX_AMOUNT_REQUIRES_ONE_TIME_USE',
        message:
          'crossChainPermits: maxAmount on an IntentExecutor-layer permit requires oneTimeUse',
        permitIndex: 0,
      },
      {
        code: 'FILL_DEADLINE_ONLY_PERMIT2',
        message:
          'crossChainPermits: fillDeadline applies only to Permit2 layers',
        permitIndex: 0,
      },
      {
        code: 'LAYER_REQUIRES_ONE_TIME_USE',
        message: 'crossChainPermits: an OFT permit requires oneTimeUse',
        permitIndex: 0,
        layer: 'OFT',
      },
      {
        code: 'SIGNING_WITH_INTENT_EXECUTOR_PERMIT',
        message:
          'crossChainPermits: an IntentExecutor-layer permit cannot enable `signing`',
      },
    ])
    // Each is what createSession throws once the ones before it are fixed.
    const fixes: SessionDefinition[] = [
      definition,
      session(
        [
          cctp({
            fillDeadline: [
              { chain: arbitrum, max: new Date(2_000_000_000_000) },
            ],
            settlementLayers: ['CCTP', 'OFT'],
          }),
        ],
        { signing: { mode: 'unrestricted' } } as Partial<SessionDefinition>,
      ),
      session([cctp({ settlementLayers: ['CCTP', 'OFT'] })], {
        signing: { mode: 'unrestricted' },
      } as Partial<SessionDefinition>),
      session([cctp()], {
        signing: { mode: 'unrestricted' },
      } as Partial<SessionDefinition>),
    ]
    expect(fixes.map((fix) => thrown(fix))).toEqual(
      refusals.map(({ message }) => message),
    )
  })

  test('the window of every permit is checked', () => {
    const backwards = {
      validAfter: new Date(2_000_000_000_000),
      validUntil: new Date(1_900_000_000_000),
    }
    const refusals = collectSessionRefusals(
      session([permit2(backwards), permit2(backwards)]),
      OPTIONS,
    )
    expect(
      refusals.map(({ code, permitIndex }) => [code, permitIndex]),
    ).toEqual([
      ['SESSION_WINDOW_REQUIRES_ONE_TIME_USE', 0],
      ['SESSION_WINDOW_REQUIRES_ONE_TIME_USE', 1],
      ['VALID_AFTER_AFTER_VALID_UNTIL', 0],
      ['VALID_AFTER_AFTER_VALID_UNTIL', 1],
      ['SESSION_REFUSED', undefined],
    ])
  })

  test('every Permit2 permit is expanded, then the dry run stops', () => {
    const refusals = collectSessionRefusals(
      session(
        [
          permit2({ maxFeeBps: 10 }),
          permit2({ allowFees: true }),
          permit2({ to: { chain: arbitrum, token: USDC_ARB, minAmount: 1n } }),
        ],
        { restrictToActions: true } as Partial<SessionDefinition>,
      ),
      OPTIONS,
    )
    expect(
      refusals.map(({ code, permitIndex }) => [code, permitIndex]),
    ).toEqual([
      ['RESTRICTED_WITH_PERMIT2_PERMIT', undefined],
      ['MAX_FEE_BPS_ONLY_ECO', 0],
      ['ALLOW_FEES_ONLY_INTENT_EXECUTOR', 1],
      ['MIN_AMOUNT_ON_PERMIT2_LAYER', 2],
    ])
  })

  test('each named layer reports its own refusal; none scoped ends the run', () => {
    const refusals = collectSessionRefusals(
      session([
        cctp({
          from: { chain: base, token: USDT_ARB },
          settlementLayers: ['CCTP', 'OFT'],
        }),
      ]),
      OPTIONS,
    )
    expect(refusals).toEqual([
      {
        code: 'TOKEN_NOT_ROUTED',
        message: `crossChainPermits: CCTP moves only USDC; the \`from\` token on chain ${base.id} is ${USDT_ARB}`,
        permitIndex: 0,
        layer: 'CCTP',
        chainId: base.id,
        leg: 'from',
      },
      {
        code: 'LAYER_REQUIRES_ONE_TIME_USE',
        message: 'crossChainPermits: an OFT permit requires oneTimeUse',
        permitIndex: 0,
        layer: 'OFT',
      },
    ])
  })

  test("'all' keeps skipping what it cannot settle", () => {
    const refusals = collectSessionRefusals(
      session(
        [
          cctp({
            from: { chain: base, token: USDT_ARB, maxAmount: 100n },
            settlementLayers: 'all',
            maxFeeBps: 10,
          }),
        ],
        oneTimeUse,
      ),
      OPTIONS,
    )
    expect(refusals.map(({ code }) => code)).toEqual([
      'MAX_FEE_BPS_ECO_UNAVAILABLE',
      'NO_LAYER_CAN_SETTLE',
    ])
    expect(refusals[1].chainId).toBe(base.id)
  })

  test('fees that cannot be scoped do not hide the layers', () => {
    const refusals = collectSessionRefusals(
      session([
        cctp({
          from: { chain: base, token: USDT_ARB },
          allowFees: true,
        }),
      ]),
      OPTIONS,
    )
    expect(refusals.map(({ code }) => code)).toEqual([
      'FEES_NOT_SERVED',
      'TOKEN_NOT_ROUTED',
    ])
  })

  test('several fee-paying layers are reported beside a stray maxFeeBps', () => {
    const usdcOft = {
      ...SETTLEMENT_CATALOG,
      [base.id]: {
        ...SETTLEMENT_CATALOG[base.id],
        oft: { adapter: OTHER, eid: 30184, token: USDC },
      },
      [arbitrum.id]: {
        ...SETTLEMENT_CATALOG[arbitrum.id],
        oft: { ...SETTLEMENT_CATALOG[arbitrum.id].oft!, token: USDC_ARB },
      },
    }
    const definition = session(
      [
        cctp({
          from: { chain: base, token: USDC, maxAmount: 100n },
          settlementLayers: ['OFT', 'LZ'],
          maxFeeBps: 10,
        }),
      ],
      oneTimeUse,
    )
    const refusals = collectSessionRefusals(definition, {
      settlement: usdcOft,
    })
    expect(refusals.map(({ code }) => code)).toEqual([
      'MAX_FEE_BPS_ONLY_ECO',
      'MULTIPLE_FEE_PAYING_LAYERS',
    ])
    expect(refusals[0].message).toBe(
      thrown(definition, { settlement: usdcOft }),
    )
  })

  test('a second cap and each layer refusing the extra token are reported', () => {
    const refusals = collectSessionRefusals(
      session(
        [
          {
            from: [
              { chain: arbitrum, token: USDT_ARB, maxAmount: 1n },
              { chain: arbitrum, token: USDC_ARB, maxAmount: 1n },
            ],
            to: { chain: base, token: USDC },
            settlementLayers: ['OFT', 'LZ'],
          },
        ],
        { ...oneTimeUse, chain: arbitrum } as Partial<SessionDefinition>,
      ),
      OPTIONS,
    )
    expect(
      refusals.map(({ code, layer, chainId }) => [code, layer, chainId]),
    ).toEqual([
      ['MULTIPLE_MAX_AMOUNTS', undefined, arbitrum.id],
      ['ONE_SOURCE_TOKEN', 'OFT', arbitrum.id],
      ['ONE_SOURCE_TOKEN', 'LZ', arbitrum.id],
    ])
  })

  // One bad permit per row: the dry run's first refusal is createSession's error.
  const cases: [string, SessionDefinition, ResolveSessionOptions?][] = [
    ['MIXED_PERMIT_KINDS', session([cctp(), permit2()])],
    ['MULTIPLE_INTENT_EXECUTOR_PERMITS', session([cctp(), cctp()])],
    [
      'PERMIT2_LAYER_WITH_INTENT_EXECUTOR_LAYER',
      session([cctp({ settlementLayers: ['CCTP', 'ACROSS'] })]),
    ],
    [
      'SAME_CHAIN_WITH_OTHER_LAYERS',
      session([cctp({ settlementLayers: ['CCTP', 'SAME_CHAIN_IE'] })]),
    ],
    [
      'NO_FROM_ON_CHAIN',
      session([cctp({ from: { chain: arbitrum, token: USDC_ARB } })]),
    ],
    [
      'RECIPIENT_ANY_NOT_ALLOWED',
      session([
        cctp({ to: { chain: arbitrum, token: USDC_ARB, recipient: 'any' } }),
      ]),
    ],
    [
      'RECIPIENT_NEEDS_ACCOUNT',
      session([cctp()], { account: undefined } as Partial<SessionDefinition>),
    ],
    [
      'RECIPIENT_NOT_ACCOUNT',
      session([
        cctp({ to: { chain: arbitrum, token: USDC_ARB, recipient: OTHER } }),
      ]),
    ],
    ['MISSING_TO', session([cctp({ to: undefined })])],
    [
      'LAYER_NOT_SERVED',
      session([cctp({ to: { chain: UNSERVED, token: USDC_ARB } })]),
    ],
    [
      'ECO_NEEDS_MAX_AMOUNT_AND_FEE',
      session([cctp({ settlementLayers: ['ECO_IE'] })]),
    ],
    ['SETTLEMENT_CATALOG_MISSING', session([cctp()]), {}],
    [
      'SAME_CHAIN_TRANSFER_TO_SELF',
      session([
        cctp({
          to: { chain: base, token: USDC },
          settlementLayers: ['SAME_CHAIN_IE'],
        }),
      ]),
    ],
    ['MAX_FEE_BPS_ONLY_ECO', session([cctp({ maxFeeBps: 10 })])],
    [
      'ALLOW_FEES_ONLY_INTENT_EXECUTOR',
      session([permit2({ allowFees: true })]),
    ],
    [
      'SESSION_REFUSED',
      session([cctp()], {
        oneTimeUse: { id: 1n },
      } as Partial<SessionDefinition>),
    ],
  ]
  test.each(cases)(
    '%s matches what createSession throws',
    (code, definition, options = OPTIONS) => {
      const refusals = collectSessionRefusals(definition, options)
      expect(refusals[0]).toMatchObject({
        code,
        message: thrown(definition, options),
      })
    },
  )
})

describe('collectRefusals', () => {
  test('a non-Error throw is still reported', () => {
    expect(
      collectRefusals(() => {
        throw 'boom'
      }),
    ).toEqual([{ code: 'SESSION_REFUSED', message: 'boom' }])
  })

  test('a halt ends the run without an entry of its own', () => {
    expect(
      collectRefusals((collect) => {
        collect(refusal('MISSING_TO', 'first'), { permitIndex: 2 })
        collect(refusal('MISSING_TO', 'first'), { permitIndex: 2 })
        throw new RefusalCollectionHalted()
      }),
    ).toEqual([{ code: 'MISSING_TO', message: 'first', permitIndex: 2 }])
  })

  test('recover passes a halt through', () => {
    expect(() =>
      recover(
        refuser(() => {}),
        () => {
          throw new RefusalCollectionHalted()
        },
      ),
    ).toThrow(RefusalCollectionHalted)
  })

  test('an entry names only what is known about it', () => {
    const [entry] = collectRefusals(() => {
      throw new Error('plain')
    }) as CrossChainPermitRefusal[]
    expect(Object.keys(entry)).toEqual(['code', 'message'])
  })
})
