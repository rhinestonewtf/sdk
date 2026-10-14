import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../test/consts'
import { sessionFingerprint } from '../../../../test/utils/session-fingerprint'
import { SETTLEMENT_CATALOG } from '../../../../test/utils/settlement-catalog'
import {
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
  toSession,
} from './resolve'
import type {
  CrossChainPermissionInput,
  Session,
  SessionDefinition,
} from './types'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const USDT = '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2' as const
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const
const ACCOUNT = '0x1111111111111111111111111111111111111111' as const
const ARBITER = '0x00000000000000000000000000000000000000ab' as const
const APPROVE = { target: USDC, selector: '0x095ea7b3' } as const
const claimPolicies = [{ type: 'permit2', spenders: [ARBITER] }] as const
const owners = { type: 'ecdsa', accounts: [accountA] } as const
const permit = (
  settlementLayers?: CrossChainPermissionInput['settlementLayers'],
): CrossChainPermissionInput => ({
  from: { chain: base, token: USDC },
  to: { chain: arbitrum, token: USDC_ARB },
  ...(settlementLayers ? { settlementLayers } : {}),
})

const DEFINITIONS = {
  plain: { chain: base, owners },
  actions: { chain: base, owners, actions: [APPROVE] },
  claimPolicies: { chain: base, owners, claimPolicies },
  claimPoliciesWithActions: {
    chain: base,
    owners,
    claimPolicies,
    actions: [APPROVE],
  },
  across: { chain: base, owners, crossChainPermits: [permit(['ACROSS'])] },
  cctp: {
    chain: base,
    owners,
    account: ACCOUNT,
    crossChainPermits: [permit(['CCTP'])],
  },
  restrictToActions: {
    chain: base,
    owners,
    restrictToActions: true,
    actions: [APPROVE],
  },
  swap: {
    chain: base,
    owners,
    swap: {
      sell: { token: USDC, maxTotal: 1_000_000n },
      buy: { token: USDT },
      to: ACCOUNT,
    },
  },
} as unknown as Record<string, SessionDefinition>

const session = (name: string): Session =>
  toSession(DEFINITIONS[name], { settlement: SETTLEMENT_CATALOG })

describe('session access', () => {
  test.each([
    [
      'plain',
      {
        kind: 'open',
        reason: 'no restriction set; the wildcard fallback is sudo',
      },
    ],
    ['actions', { kind: 'open', reason: 'no restriction set' }],
    [
      'claimPolicies',
      {
        kind: 'open',
        reason: 'claimPolicies only; the wildcard fallback is sudo',
      },
    ],
    [
      'claimPoliciesWithActions',
      {
        kind: 'open',
        reason: 'claimPolicies keep the intent-execution fallback',
      },
    ],
    [
      'across',
      {
        kind: 'open',
        reason:
          'Permit2-route permit (ACROSS) keeps the intent-execution fallback',
      },
    ],
    ['cctp', { kind: 'scoped', reason: 'settlement-scoped permit (CCTP)' }],
    ['restrictToActions', { kind: 'scoped', reason: 'restrictToActions' }],
    ['swap', { kind: 'scoped', reason: 'swap scope' }],
  ])('%s', (name, access) => {
    expect(session(name).access).toEqual(access)
  })

  test("'open' is exactly a session holding the wildcard fallback", () => {
    for (const name of Object.keys(DEFINITIONS)) {
      const s = session(name)
      const hasFallback = s.actions.some(
        (action) =>
          action.actionTarget === SMART_SESSIONS_FALLBACK_TARGET_FLAG &&
          action.actionTargetSelector ===
            SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
      )
      expect(s.access?.kind === 'open').toBe(hasFallback)
    }
  })

  test('a Permit2 permit naming no layer reports any layer', () => {
    expect(
      toSession({ ...DEFINITIONS.across, crossChainPermits: [permit()] })
        .access,
    ).toEqual({
      kind: 'open',
      reason:
        'Permit2-route permit (any layer) keeps the intent-execution fallback',
    })
  })

  test('reporting access leaves the encoded session unchanged', () => {
    // Captured from origin/main (ade12708), before sessions carried access.
    expect(
      Object.fromEntries(
        Object.keys(DEFINITIONS).map((name) => [
          name,
          sessionFingerprint(session(name)),
        ]),
      ),
    ).toEqual({
      plain:
        '0x8b11091aa8b409b90cba35d3bd7c3a723e81488b25c6baa74fe58c6d885c4c6a',
      actions:
        '0xee645fe91386e340c0848b4b9f08e381cf27f853575ca483775efd3b169ffce2',
      claimPolicies:
        '0xd7d27e168552f7868708b94b69466b28bec01a734ddc0217dedfffbd3330cca5',
      claimPoliciesWithActions:
        '0x54f7b11d9665425cf479f3cb77f49b80b28129026aeb7042a14926c1adbe9649',
      across:
        '0x96bd6382888ab3db8290dfe1f55e47dc829788f9c4bd693aefe48223741ca139',
      cctp: '0x3e848b71c89c12576c20ad3bf3ab943be1e85c5e611f1ae93ea76494a3d9ef46',
      restrictToActions:
        '0x706042507973928c950a6c52a0a670153375d07be64e38ea5df7b8fe36783804',
      swap: '0xf912c0da8bccc002ad700cfe3904df06b1605498a18fde2581966d8dcd455eda',
    })
  })
})
