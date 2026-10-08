import { keccak256, toHex } from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../test/consts'
import { SETTLEMENT_CATALOG } from '../../../../test/utils/settlement-catalog'
import { getSessionData } from './digest'
import {
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
  toSession,
} from './resolve'
import type { Session, SessionDefinition } from './types'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const USDT = '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2' as const
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const
const ACCOUNT = '0x1111111111111111111111111111111111111111' as const
const owners = { type: 'ecdsa', accounts: [accountA] } as const
const permit = (settlementLayers?: readonly string[]) => ({
  from: { chain: base, token: USDC },
  to: { chain: arbitrum, token: USDC_ARB },
  ...(settlementLayers ? { settlementLayers } : {}),
})

const DEFINITIONS = {
  plain: { chain: base, owners },
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
    actions: [{ target: USDC, selector: '0x095ea7b3' }],
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

function fingerprint(s: Session): string {
  return keccak256(
    toHex(
      JSON.stringify(
        { permissionId: s.permissionId, data: getSessionData(s) },
        (_, v) => (typeof v === 'bigint' ? v.toString() : v),
      ),
    ),
  )
}

describe('session access', () => {
  test.each([
    ['plain', { kind: 'open', reason: 'no restriction set' }],
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

  test("'open' is exactly a session holding the intent-execution fallback", () => {
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
    // Captured from origin/main (de03a9b2), before sessions carried access.
    expect(
      Object.fromEntries(
        Object.keys(DEFINITIONS).map((name) => [
          name,
          fingerprint(session(name)),
        ]),
      ),
    ).toEqual({
      plain:
        '0x0eac25512dd643fde0af64f505f2395b9724ee13eeaaca0850b77993f52eb192',
      across:
        '0x03c6c23807dc744a506a73a92bae72c3d8ea73b7d9bc67c72d0f5d71a31a7cb6',
      cctp: '0xb1078ebcd5539c5f0585a84f18bf2694329bb021aaf4ed4645adca55c13a2cde',
      restrictToActions:
        '0x50a01b5d03e82fcb16a6b82fdd56e10ade9b49efafe97ade337416f69b7817b5',
      swap: '0xffb9b23f1f9378127afe0dd9e19dd3735f3a7bf2c1b2d9403ed9dfe87a2dffa2',
    })
  })
})
