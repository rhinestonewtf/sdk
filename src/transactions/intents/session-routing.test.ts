import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { toEvmChainReference } from '../../chains/caip2'
import { toSession } from '../../modules/validators/smart-sessions/resolve'
import type { Session } from '../../modules/validators/smart-sessions/types'
import { constrainSessionIntent } from './session-routing'
import type { IntentInput } from './types'

const token = '0x0000000000000000000000000000000000000001'
const other = '0x0000000000000000000000000000000000000002'
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const base = toSession({
  chain: mainnet,
  owners: { type: 'ecdsa', accounts: [account] },
})
const scoped: Session = {
  ...base,
  permit2Sources: [{ chain: mainnet, token, maxAmount: 10n }],
  settlementLayers: ['ACROSS'],
}
const intent = (
  session: Session,
  options?: IntentInput['options'],
): IntentInput => ({
  source: { chain: toEvmChainReference(1), token },
  destination: toEvmChainReference(42161),
  calls: [],
  signers: { kind: 'smart-session', byChain: { 1: { session } } },
  options,
})

describe('singular session source and routing constraints', () => {
  test('caps the named source and preserves a tighter caller cap', () => {
    const input = intent(scoped)
    expect(
      constrainSessionIntent(input, account.address).source?.maxAmount,
    ).toBe(10n)
    expect(
      constrainSessionIntent(
        { ...input, source: { ...input.source!, maxAmount: 3n } },
        account.address,
      ).source?.maxAmount,
    ).toBe(3n)
    expect(input.source?.maxAmount).toBeUndefined()
  })
  test('refuses incompatible token or chain instead of discovering another source', () => {
    const input = intent(scoped)
    expect(() =>
      constrainSessionIntent(
        { ...input, source: { ...input.source!, token: other } },
        account.address,
      ),
    ).toThrow('funding scope')
    expect(() =>
      constrainSessionIntent(
        intent({
          ...scoped,
          permit2Sources: [{ chain: { ...mainnet, id: 10 }, token }],
        }),
        account.address,
      ),
    ).toThrow('funding scope')
  })
  test('same-chain ACROSS requires the swap scope and spends only its sell tokens/cap', () => {
    const input = { ...intent(scoped), destination: toEvmChainReference(1) }
    expect(() => constrainSessionIntent(input, account.address)).toThrow(
      'swap scope',
    )
    const session: Session = {
      ...scoped,
      swap: {
        to: account.address,
        sell: { token: other, maxTotal: 4n },
        buy: { token },
        via: [{ id: 'fynd' as const }],
      },
    }
    const withSwap = {
      ...input,
      signers: { kind: 'smart-session' as const, byChain: { 1: { session } } },
    }
    expect(() => constrainSessionIntent(withSwap, account.address)).toThrow(
      'funding scope',
    )
    const adapted = constrainSessionIntent(
      { ...withSwap, source: { ...withSwap.source!, token: other } },
      account.address,
    )
    expect(adapted.source).toMatchObject({ token: other, maxAmount: 4n })
    expect(adapted.options?.quoters).toEqual({ include: ['fynd'] })
  })
  test('intersects scoped layers and refuses an incompatible explicit filter', () => {
    const session = {
      ...scoped,
      access: { kind: 'scoped' as const, reason: 'scoped' },
      settlementLayers: ['ACROSS', 'CCTP'] as const,
    }
    expect(
      constrainSessionIntent(
        intent(session, { settlementLayers: { include: ['CCTP', 'OFT'] } }),
        account.address,
      ).options?.settlementLayers,
    ).toEqual({ include: ['CCTP'] })
    expect(() =>
      constrainSessionIntent(
        intent(session, { settlementLayers: { exclude: ['ACROSS', 'CCTP'] } }),
        account.address,
      ),
    ).toThrow('no settlement layer')
  })
  test('open fallback excludes only unnamed Permit2 arbiters', () => {
    const session = { ...scoped, settlementLayers: ['SAME_CHAIN'] as const }
    expect(
      constrainSessionIntent(intent(session), account.address).options
        ?.settlementLayers,
    ).toEqual({ exclude: ['ACROSS'] })
  })
  test('irrelevant sessions cannot veto global quoters; caller cannot widen pins', () => {
    const session: Session = {
      ...base,
      swap: {
        to: account.address,
        sell: { token },
        buy: { token: other },
        via: [{ id: 'fynd' }],
      },
    }
    const input: IntentInput = {
      ...intent(session, { quoters: { include: ['0x', 'fynd'] } }),
      signers: {
        kind: 'smart-session',
        byChain: {
          1: { session },
          10: {
            session: {
              ...session,
              swap: { ...session.swap!, via: [{ id: '0x' }] },
            },
          },
        },
      },
    }
    expect(
      constrainSessionIntent(input, account.address).options?.quoters,
    ).toEqual({ include: ['fynd'] })
    expect(
      constrainSessionIntent(
        intent(session, { quoters: { exclude: ['fynd'] } }),
        account.address,
      ).options?.quoters,
    ).toEqual({ include: [] })
  })
})
