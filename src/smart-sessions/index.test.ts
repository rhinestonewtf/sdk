import { privateKeyToAccount } from 'viem/accounts'
import { base, mainnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { SETTLEMENT_CATALOG } from '../../test/utils/settlement-catalog'
import type { SessionDefinition } from '../config/account'
import { toSession, validateSession } from './index'

const owner = privateKeyToAccount(`0x${'01'.repeat(32)}`)
const definition: SessionDefinition = {
  chain: base,
  owners: { type: 'ecdsa', accounts: [owner] },
  account: owner.address,
  crossChainPermits: [
    {
      from: {
        chain: base,
        token: SETTLEMENT_CATALOG[base.id].cctp!.usdc,
        maxAmount: 100n,
      },
      to: { chain: mainnet, token: SETTLEMENT_CATALOG[mainnet.id].cctp!.usdc },
      settlementLayers: ['CCTP'],
    },
  ],
}

describe('offline session facade', () => {
  test('uses the supplied settlement catalog and returns successful metadata', () => {
    const options = {
      settlement: SETTLEMENT_CATALOG,
      wrappedNativeToken: '0x4200000000000000000000000000000000000006' as const,
    }
    const validation = validateSession(definition, options)
    const session = toSession(definition, options)
    expect(validation.refusals).toEqual([])
    expect(validation.access).toEqual(session.access)
    expect(session.access?.kind).toBe('scoped')
    expect(session.settlementLayers).toEqual(['CCTP'])
    expect(session.lifetimeBudget).toBe(true)
    expect(
      session.actions.some(
        ({ actionTarget }) =>
          actionTarget.toLowerCase() ===
          SETTLEMENT_CATALOG[base.id].cctp!.tokenMessenger,
      ),
    ).toBe(true)
  })

  test('missing offline catalog refuses instead of acquiring network dependencies', () => {
    const validation = validateSession(definition)
    expect(validation.refusals.length).toBeGreaterThan(0)
    expect(() => toSession(definition)).toThrow(validation.refusals[0].message)
    expect(validation.access).toBeUndefined()
  })

  test('explicit open fallback remains distinct from default scoped access', () => {
    const open: SessionDefinition = {
      chain: base,
      owners: definition.owners,
      fallback: 'sudo',
      crossChainPermits: [{ settlementLayers: ['ACROSS'] }],
    }
    expect(validateSession(open).access?.kind).toBe('open')
    expect(toSession(open).access?.kind).toBe('open')
  })
})
