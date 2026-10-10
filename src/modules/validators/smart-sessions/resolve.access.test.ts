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
  across: {
    chain: base,
    owners,
    crossChainPermits: [{ ...permit(['ACROSS']), preClaimOps: 'none' }],
  },
  acrossReusable: {
    chain: base,
    owners,
    crossChainPermits: [permit(['ACROSS'])],
  },
  acrossIntentExecution: {
    chain: base,
    owners,
    crossChainPermits: [permit(['ACROSS'])],
    fallback: 'intentExecution',
  },
  acrossSudo: {
    chain: base,
    owners,
    crossChainPermits: [permit(['ACROSS'])],
    fallback: 'sudo',
  },
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
    ['across', { kind: 'scoped', reason: 'Permit2-route permit (ACROSS)' }],
    [
      'acrossReusable',
      { kind: 'scoped', reason: 'Permit2-route permit (ACROSS)' },
    ],
    [
      'acrossIntentExecution',
      { kind: 'open', reason: 'fallback: intentExecution' },
    ],
    ['acrossSudo', { kind: 'open', reason: 'fallback: sudo' }],
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

  test('a Permit2 permit naming no layer is scoped to ACROSS', () => {
    expect(
      toSession({
        ...DEFINITIONS.across,
        crossChainPermits: [{ ...permit(), preClaimOps: 'none' }],
      }).access,
    ).toEqual({ kind: 'scoped', reason: 'Permit2-route permit (ACROSS)' })
  })

  test('pins the encoded session of each shape', () => {
    // Captured from origin/main (ade12708), before sessions carried access.
    // `across` moved when Permit2-route sessions became scoped (RHI-8045)
    // and again when it took preClaimOps: 'none'. `acrossReusable` was refused
    // until Permit2SenderPolicy bounded it. The fallback rows moved when they
    // stopped carrying the Permit2 approve, which the wildcard admits;
    // acrossIntentExecution is back to the pre-RHI-8045 `across`.
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
        '0xe6fa95b4cd4438b8eb63f08e7667f3cb033e81feda1ce62546d7d8c19ca6af86',
      acrossReusable:
        '0x8fab4865c997ab10f3ac94309e9f41b5039e1b33012a4d071dedf3028d6801b8',
      acrossIntentExecution:
        '0x96bd6382888ab3db8290dfe1f55e47dc829788f9c4bd693aefe48223741ca139',
      acrossSudo:
        '0x2aa92407fa43a899863534d89934bfacdc45aa7c23237a9530c890737115bde4',
      cctp: '0x3e848b71c89c12576c20ad3bf3ab943be1e85c5e611f1ae93ea76494a3d9ef46',
      restrictToActions:
        '0x706042507973928c950a6c52a0a670153375d07be64e38ea5df7b8fe36783804',
      swap: '0xf912c0da8bccc002ad700cfe3904df06b1605498a18fde2581966d8dcd455eda',
    })
  })
})
