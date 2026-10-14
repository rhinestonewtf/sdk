import type { Address } from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { accountA } from '../../../../test/consts'
import { SETTLEMENT_CATALOG } from '../../../../test/utils/settlement-catalog'
import {
  type ResolveSessionOptions,
  toSession,
  validateSessionDefinition,
} from './resolve'
import type { CrossChainPermissionInput, SessionDefinition } from './types'

// These tests assume the TimeFramePolicy is deployed on their chains.
vi.mock('./policies/addresses', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./policies/addresses')>()),
  timeFramePolicyDeployed: () => true,
}))

const USDC = SETTLEMENT_CATALOG[base.id].cctp!.usdc
const USDC_ARB = SETTLEMENT_CATALOG[arbitrum.id].cctp!.usdc
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const BUY = '0x4444444444444444444444444444444444444444' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
const OPTIONS: ResolveSessionOptions = { settlement: SETTLEMENT_CATALOG }

const definition = (
  permit: Partial<CrossChainPermissionInput>,
  extra: Partial<SessionDefinition> = {},
): SessionDefinition => ({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  account: ACCOUNT,
  oneTimeUse: { id: 7n },
  policyAddresses: { oneTimeUseId: ONE_TIME_USE },
  crossChainPermits: [
    {
      from: { chain: base, token: USDC, maxAmount: 100n },
      to: { chain: arbitrum, token: USDC_ARB },
      ...permit,
    },
  ],
  ...extra,
})

/** What toSession builds, or the error it throws. */
const outcome = (
  definition: SessionDefinition,
  options: ResolveSessionOptions = OPTIONS,
) => {
  try {
    const session = toSession(definition, options)
    return {
      permissionId: session.permissionId,
      actions: session.actions,
      settlementLayers: session.settlementLayers,
      settlementCoverage: session.settlementCoverage,
      access: session.access,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : error }
  }
}

const codes = (
  definition: SessionDefinition,
  options: ResolveSessionOptions = OPTIONS,
) =>
  validateSessionDefinition(definition, options).refusals.map(
    ({ code }) => code,
  )

const omitted = [
  ['omitted', {}],
  ['[]', { settlementLayers: [] }],
] as const satisfies readonly [string, Partial<CrossChainPermissionInput>][]

describe.each(omitted)('settlementLayers %s without fallback', (_, layers) => {
  test("builds the session 'all' builds", () => {
    const built = outcome(definition(layers))
    expect(built).toEqual(outcome(definition({ settlementLayers: 'all' })))
    expect(built.settlementLayers).toEqual(['CCTP', 'LZ'])
    expect(built.access).toEqual({
      kind: 'scoped',
      reason: 'settlement-scoped permit (CCTP, LZ)',
    })
  })

  test("reports what 'all' dropped", () => {
    const built = outcome(definition(layers))
    expect(built.settlementCoverage?.dropped.map(({ layer }) => layer)).toEqual(
      ['OFT', 'ECO_IE'],
    )
  })

  test("refuses a permit no layer can settle, as 'all' does", () => {
    const unsettled = { from: { chain: base, token: OTHER, maxAmount: 100n } }
    expect(() =>
      toSession(definition({ ...unsettled, ...layers }), OPTIONS),
    ).toThrow('no IntentExecutor layer can settle this permit')
    expect(codes(definition({ ...unsettled, ...layers }))).toEqual(
      codes(definition({ ...unsettled, settlementLayers: 'all' })),
    )
    expect(codes(definition({ ...unsettled, ...layers }))).toEqual([
      'NO_LAYER_CAN_SETTLE',
    ])
  })

  test("throws without the orchestrator's settlement addresses", () => {
    const offline = outcome(definition(layers), {})
    expect(offline).toEqual(
      outcome(definition({ settlementLayers: 'all' }), {}),
    )
    expect(offline).toEqual({
      error: expect.stringContaining('pass it or name settlementLayers'),
    })
    expect(codes(definition(layers), {})).toEqual([
      'SETTLEMENT_CATALOG_MISSING',
    ])
  })

  test("beside a swap scope, behaves as 'all' does", () => {
    const swap = {
      swap: { sell: { token: OTHER }, buy: { token: BUY }, to: ACCOUNT },
    } as Partial<SessionDefinition>
    const built = outcome(definition(layers, swap))
    expect(built).toEqual(
      outcome(definition({ settlementLayers: 'all' }, swap)),
    )
    expect(built.settlementLayers).toEqual(['CCTP', 'LZ'])
  })
})

describe.each(omitted)('settlementLayers %s with fallback', (_, layers) => {
  test.each(['intentExecution', 'sudo'] as const)(
    "%s keeps the Permit2 shape 'all' cannot share",
    (fallback) => {
      const open = definition(layers, { fallback })
      expect(codes(open)).toEqual([])
      const built = outcome(open)
      expect(built.access).toEqual({
        kind: 'open',
        reason: `fallback: ${fallback}`,
      })
      expect(built.permissionId).toEqual(
        outcome(definition({ settlementLayers: ['ACROSS'] }, { fallback }))
          .permissionId,
      )
    },
  )
})

describe("settlementLayers ['ACROSS']", () => {
  test('stays a Permit2-route session', () => {
    const built = outcome(definition({ settlementLayers: ['ACROSS'] }))
    expect(built.settlementLayers).toEqual(['ACROSS'])
    expect(built.access).toEqual({
      kind: 'scoped',
      reason: 'Permit2-route permit (ACROSS)',
    })
  })

  test('still builds offline', () => {
    expect(
      toSession(definition({ settlementLayers: ['ACROSS'] })).settlementLayers,
    ).toEqual(['ACROSS'])
  })
})
