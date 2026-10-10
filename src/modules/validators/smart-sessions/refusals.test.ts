import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Address, Chain } from 'viem'
import { arbitrum, base, linea, plasma } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../test/consts'
import { SETTLEMENT_CATALOG } from '../../../../test/utils/settlement-catalog'
import {
  collectRefusals,
  RefusalCollectionHalted,
  recover,
  refusal,
  refuser,
  SESSION_REFUSAL_CODES,
} from './refusals'
import {
  type ResolveSessionOptions,
  toSession,
  validateSessionDefinition,
} from './resolve'
import { SettlementLayerRefusal } from './settlement/served'
import type {
  CrossChainPermissionInput,
  SessionAccess,
  SessionDefinition,
} from './types'

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
  preClaimOps: 'none',
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

const validateRefusals = (
  definition: SessionDefinition,
  options?: ResolveSessionOptions,
) => validateSessionDefinition(definition, options).refusals

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
    expect(Object.keys(SESSION_REFUSAL_CODES)).toEqual([
      'VALID_AFTER_EXCEEDS_VALID_UNTIL',
      'VALID_UNTIL_NOT_IN_FUTURE',
      'PERMIT2_MAX_AMOUNT_REQUIRES_ONE_TIME_USE',
      'SETTLEMENT_SCOPED_SALT_V1',
      'MIXED_PERMIT_KINDS',
      'MULTIPLE_INTENT_EXECUTOR_PERMITS',
      'PERMIT2_LAYER_WITH_INTENT_EXECUTOR_LAYER',
      'SAME_CHAIN_IE_WITH_OTHER_LAYERS',
      'NO_FROM_ON_CHAIN',
      'INTENT_EXECUTOR_MAX_AMOUNT_REQUIRES_ONE_TIME_USE',
      'MULTIPLE_MAX_AMOUNTS',
      'RECIPIENT_ANY_NOT_ALLOWED',
      'RECIPIENT_NEEDS_ACCOUNT',
      'RECIPIENT_NOT_ACCOUNT',
      'MISSING_TO',
      'FILL_DEADLINE_ONLY_PERMIT2',
      'MAX_FEE_BPS_ONLY_ECO_IE',
      'MIN_AMOUNT_ON_PERMIT2_LAYER',
      'SAME_CHAIN_IE_TRANSFER_MIN_AMOUNT',
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
      'MAX_FEE_BPS_ECO_IE_UNAVAILABLE',
      'NO_LAYER_CAN_SETTLE',
      'MULTIPLE_FEE_PAYING_LAYERS',
      'ONE_SOURCE_TOKEN',
      'TOKEN_NOT_ROUTED',
      'ECO_IE_STABLECOIN_DECIMALS',
      'ACCOUNT_REQUIRED',
      'ECO_IE_NEEDS_MAX_AMOUNT_AND_FEE',
      'MAX_FEE_BPS_OUT_OF_RANGE',
      'ECO_IE_VALIDITY_TOO_SHORT',
      'ECO_IE_FLOOR_NEEDS_EQUAL_CAPS',
      'RECIPIENT_ANY_UNPINNABLE',
      'ECO_IE_NO_SHARED_PROVER',
      'LZ_NO_ROUTE',
      'NATIVE_SOURCE_UNSUPPORTED',
      'SAME_CHAIN_IE_OTHER_CHAIN_LEG',
      'SAME_CHAIN_IE_TRANSFER_TO_SELF',
      'SAME_CHAIN_IE_ANY_RECIPIENT_NEEDS_MAX_AMOUNT',
      'SAME_CHAIN_IE_TRANSFER_OR_SINGLE_SWAP',
      'SAME_CHAIN_IE_SWAP_NEEDS_MIN_AMOUNT',
      'SAME_CHAIN_IE_SWAP_NEEDS_MAX_AMOUNT',
      'ALLOW_FEES_CATALOG_MISSING',
      'FEES_NOT_SERVED',
      'ALLOW_FEES_NON_STABLECOIN',
      'ALLOW_FEES_MIXED_DECIMALS',
      'ALLOW_FEES_ONLY_INTENT_EXECUTOR',
      'SIGNING_WITH_INTENT_EXECUTOR_PERMIT',
      'RESTRICTED_WITH_PERMIT2_GRANTS',
      'PERMIT2_ROUTE_NEEDS_FROM',
      'RETIRED_PERMIT2_LAYER',
      'PERMIT2_APPROVE_CONFLICT',
      'FALLBACK_NOT_APPLICABLE',
      'PERMIT2_ROUTE_NEEDS_BOUND',
      'PERMIT2_ROUTE_ACROSS_ONLY',
      'PRE_CLAIM_OPS_NOT_APPLICABLE',
      'NATIVE_DESTINATION_UNSUPPORTED',
      'WRAPPED_NATIVE_ZERO_CAP',
      'WRAPPED_NATIVE_TOKEN_UNSERVED',
      'CLAIM_POLICIES_SIGNING_MODE',
      'CLAIM_POLICIES_SIGNING_WINDOW_CLOSED',
      'DUPLICATE_ERC1271_POLICY',
      'UNIVERSAL_ACTION_COPY_INVALID',
      'UNIVERSAL_ACTION_POLICY_NO_CODE',
      'UNIVERSAL_ACTION_COPY_CODE_MISMATCH',
      'SESSION_REFUSED',
    ])
    for (const code of Object.keys(SESSION_REFUSAL_CODES)) {
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
    expect(validateRefusals(definition, OPTIONS)).toEqual([])
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
    const refusals = validateRefusals(definition, OPTIONS)
    expect(refusals).toEqual([
      {
        code: 'INTENT_EXECUTOR_MAX_AMOUNT_REQUIRES_ONE_TIME_USE',
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
    const refusals = validateRefusals(
      session([permit2(backwards), permit2(backwards)]),
      OPTIONS,
    )
    expect(
      refusals.map(({ code, permitIndex }) => [code, permitIndex]),
    ).toEqual([
      ['VALID_AFTER_EXCEEDS_VALID_UNTIL', 0],
      ['VALID_AFTER_EXCEEDS_VALID_UNTIL', 1],
      // Two Permit2 permits install the claim policy twice.
      ['DUPLICATE_ERC1271_POLICY', undefined],
    ])
  })

  test('every Permit2 permit is expanded, then the dry run stops', () => {
    const refusals = validateRefusals(
      session(
        [
          permit2({ maxFeeBps: 10 }),
          permit2({ allowFees: true, preClaimOps: undefined }),
          permit2({ to: { chain: arbitrum, token: USDC_ARB, minAmount: 1n } }),
        ],
        { restrictToActions: true } as Partial<SessionDefinition>,
      ),
      OPTIONS,
    )
    expect(
      refusals.map(({ code, permitIndex }) => [code, permitIndex]),
    ).toEqual([
      // allowFees now scopes the fee calls, which base's catalog does not serve;
      // restrictToActions beside a Permit2 permit is no longer refused.
      ['FEES_NOT_SERVED', 1],
      ['MAX_FEE_BPS_ONLY_ECO_IE', 0],
      ['MIN_AMOUNT_ON_PERMIT2_LAYER', 2],
    ])
  })

  test('each named layer reports its own refusal; none scoped ends the run', () => {
    const refusals = validateRefusals(
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
    const refusals = validateRefusals(
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
      'MAX_FEE_BPS_ECO_IE_UNAVAILABLE',
      'NO_LAYER_CAN_SETTLE',
    ])
    expect(refusals[1].chainId).toBe(base.id)
  })

  test('fees that cannot be scoped do not hide the layers', () => {
    const refusals = validateRefusals(
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
    const refusals = validateRefusals(definition, {
      settlement: usdcOft,
    })
    expect(refusals.map(({ code }) => code)).toEqual([
      'MAX_FEE_BPS_ONLY_ECO_IE',
      'MULTIPLE_FEE_PAYING_LAYERS',
    ])
    expect(refusals[0].message).toBe(
      thrown(definition, { settlement: usdcOft }),
    )
  })

  test('a second cap and each layer refusing the extra token are reported', () => {
    const refusals = validateRefusals(
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
      'SAME_CHAIN_IE_WITH_OTHER_LAYERS',
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
      'ECO_IE_NEEDS_MAX_AMOUNT_AND_FEE',
      session([cctp({ settlementLayers: ['ECO_IE'] })]),
    ],
    ['SETTLEMENT_CATALOG_MISSING', session([cctp()]), {}],
    [
      'SAME_CHAIN_IE_TRANSFER_TO_SELF',
      session([
        cctp({
          to: { chain: base, token: USDC },
          settlementLayers: ['SAME_CHAIN_IE'],
        }),
      ]),
    ],
    ['MAX_FEE_BPS_ONLY_ECO_IE', session([cctp({ maxFeeBps: 10 })])],
    [
      'FEES_NOT_SERVED',
      session(
        [permit2({ allowFees: true, preClaimOps: undefined })],
        oneTimeUse,
      ),
    ],
    ['PERMIT2_ROUTE_NEEDS_FROM', session([permit2({ from: undefined })])],
    [
      'PERMIT2_ROUTE_NEEDS_BOUND',
      // Linea has no Permit2SenderPolicy to bound a reusable session with.
      session(
        [
          permit2({
            preClaimOps: undefined,
            from: { chain: linea, token: USDC },
          }),
        ],
        { chain: linea } as Partial<SessionDefinition>,
      ),
    ],
    [
      'PERMIT2_ROUTE_ACROSS_ONLY',
      session([permit2({ settlementLayers: ['ACROSS', 'SAME_CHAIN'] })]),
    ],
    ['PRE_CLAIM_OPS_NOT_APPLICABLE', session([permit2()], oneTimeUse)],
    [
      'RETIRED_PERMIT2_LAYER',
      session([permit2({ settlementLayers: ['ECO'] })]),
    ],
    [
      'FALLBACK_NOT_APPLICABLE',
      session([cctp()], { fallback: 'sudo' } as Partial<SessionDefinition>),
    ],
    ['DUPLICATE_ERC1271_POLICY', session([permit2(), permit2()])],
    [
      'CLAIM_POLICIES_SIGNING_MODE',
      session([permit2()], {
        signing: { mode: 'disabled' },
      } as Partial<SessionDefinition>),
    ],
    [
      'CLAIM_POLICIES_SIGNING_WINDOW_CLOSED',
      session([permit2()], {
        signing: { mode: 'unrestricted', validUntil: new Date(1_000) },
      } as Partial<SessionDefinition>),
    ],
    [
      'UNIVERSAL_ACTION_COPY_INVALID',
      session([], {
        policyAddresses: { universalActionCopies: [OTHER, OTHER] },
      } as Partial<SessionDefinition>),
    ],
    [
      'SESSION_REFUSED',
      // Linea has no OneTimeUseIdPolicy to default to.
      session([], {
        chain: linea,
        oneTimeUse: { id: 1n },
      } as Partial<SessionDefinition>),
    ],
  ]
  test.each(cases)(
    '%s matches what createSession throws',
    (code, definition, options = OPTIONS) => {
      const refusals = validateRefusals(definition, options)
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
      }).refusals,
    ).toEqual([{ code: 'SESSION_REFUSED', message: 'boom' }])
  })

  test('a halt ends the run without an entry of its own', () => {
    expect(
      collectRefusals((collect) => {
        collect(refusal('MISSING_TO', 'first'), { permitIndex: 2 })
        collect(refusal('MISSING_TO', 'first'), { permitIndex: 2 })
        throw new RefusalCollectionHalted()
      }).refusals,
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
    }).refusals
    expect(Object.keys(entry)).toEqual(['code', 'message'])
  })
})

describe('refusal code coverage', () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  const sources = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => readFileSync(join(root, file), 'utf8'))
  // Only modules that raise refusals; `code` means other things elsewhere.
  const raising = sources.filter((source) =>
    /refusals'|SettlementLayerRefusal/.test(source),
  )
  const used = new Set(
    raising.flatMap((source) =>
      [...source.matchAll(/(?:code: |refusal\(\s*)'([A-Z0-9_]+)'/g)].map(
        ([, code]) => code,
      ),
    ),
  )

  test('every listed code is raised somewhere in src', () => {
    // A published code stays listed after it stops being raised.
    const retired = ['SESSION_REFUSED', 'ALLOW_FEES_ONLY_INTENT_EXECUTOR']
    const listed = Object.keys(SESSION_REFUSAL_CODES).filter(
      (code) => !retired.includes(code),
    )
    expect(listed.filter((code) => !used.has(code))).toEqual([])
  })

  // refusal() and SettlementLayerRefusal take a typed code; a bare Error does not.
  test('no crossChainPermits refusal is a bare Error', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/new Error\(\s*['"`]crossChainPermits: /)
    }
  })
})

describe("refusals under settlementLayers 'all'", () => {
  const USDT_PLASMA = SETTLEMENT_CATALOG[plasma.id].oft!.token
  const VALID_UNTIL = new Date(2_000_000_000_000)
  // Each drops at least one layer; together they reach every floor refusal.
  const permits: [string, Chain, CrossChainPermissionInput][] = [
    [
      'a floor on a leg LZ reaches over CCTP',
      base,
      cctp({
        from: { chain: base, token: USDC, maxAmount: 100n },
        to: { chain: arbitrum, token: USDC_ARB, minAmount: 98n },
        validUntil: VALID_UNTIL,
        settlementLayers: 'all',
      }),
    ],
    [
      'an OFT floor without validUntil',
      arbitrum,
      {
        from: { chain: arbitrum, token: USDT_ARB, maxAmount: 100n },
        to: { chain: plasma, token: USDT_PLASMA, minAmount: 95n },
        settlementLayers: 'all',
      },
    ],
    [
      'no floor and no maxFeeBps',
      base,
      cctp({
        from: { chain: base, token: USDC, maxAmount: 100n },
        settlementLayers: 'all',
      }),
    ],
  ]

  test.each(permits)(
    '%s: each dropped layer, named alone, is refused with a code',
    (_, chain, permit) => {
      const definition = session([permit], {
        ...oneTimeUse,
        chain,
      } as Partial<SessionDefinition>)
      const validation = validateSessionDefinition(definition, OPTIONS)
      expect(validation.refusals).toEqual([])
      const dropped = validation.settlementCoverage?.dropped ?? []
      expect(dropped.length).toBeGreaterThan(0)
      for (const { layer, reason } of dropped) {
        const [first] = validateRefusals(
          session([{ ...permit, settlementLayers: [layer] }], {
            ...oneTimeUse,
            chain,
          } as Partial<SessionDefinition>),
          OPTIONS,
        )
        expect(first.code).not.toBe('SESSION_REFUSED')
        expect(first).toMatchObject({
          message: `crossChainPermits: ${reason}`,
          layer,
        })
      }
    },
  )

  test('the dry run lists the floor drops createSession records', () => {
    const [, chain, permit] = permits[0]
    const definition = session([permit], {
      ...oneTimeUse,
      chain,
    } as Partial<SessionDefinition>)
    const validation = validateSessionDefinition(definition, OPTIONS)
    expect(validation.settlementCoverage).toEqual(
      toSession(definition, OPTIONS).settlementCoverage,
    )
    expect(
      validation.settlementCoverage?.dropped.map(({ layer }) => layer),
    ).toEqual(['CCTP', 'OFT', 'LZ'])
    const codes = (layer: 'CCTP' | 'LZ') =>
      validateRefusals(
        session([{ ...permit, settlementLayers: [layer] }], oneTimeUse),
        OPTIONS,
      ).map(({ code }) => code)
    expect(codes('CCTP')).toEqual(['MIN_AMOUNT_NOT_ENFORCEABLE'])
    expect(codes('LZ')).toEqual(['LZ_FLOOR_ON_CCTP_ROUTE'])
  })
})

describe('validateSessionDefinition access', () => {
  test.each<[string, SessionDefinition, SessionAccess]>([
    [
      'a Permit2 permit',
      session([permit2()]),
      { kind: 'scoped', reason: 'Permit2-route permit (ACROSS)' },
    ],
    [
      'a Permit2 permit with fallback: sudo',
      session([permit2()], { fallback: 'sudo' } as Partial<SessionDefinition>),
      { kind: 'open', reason: 'fallback: sudo' },
    ],
    [
      'a settlement-scoped permit',
      session([cctp()]),
      { kind: 'scoped', reason: 'settlement-scoped permit (CCTP)' },
    ],
  ])('reports %s as createSession would', (_, definition, access) => {
    const validation = validateSessionDefinition(definition, OPTIONS)
    expect(validation).toMatchObject({ refusals: [], access })
    expect(validation.access).toEqual(toSession(definition, OPTIONS).access)
  })

  test('a refused definition reports no access or coverage', () => {
    // Resolution runs to the end past this refusal, so the session is built.
    const signing = session([cctp({ settlementLayers: 'all' })], {
      signing: { mode: 'unrestricted' },
    } as Partial<SessionDefinition>)
    expect(validateSessionDefinition(signing, OPTIONS)).toEqual({
      refusals: [
        expect.objectContaining({
          code: 'SIGNING_WITH_INTENT_EXECUTOR_PERMIT',
        }),
      ],
    })
    expect(
      validateSessionDefinition(session([cctp({ to: undefined })]), OPTIONS),
    ).toEqual({ refusals: [expect.objectContaining({ code: 'MISSING_TO' })] })
  })
})
