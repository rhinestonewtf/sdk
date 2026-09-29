import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../test/consts'
import { toSession } from '../modules/validators/smart-sessions/resolve'
import { adaptTransaction } from './account'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const
const ACCOUNT = '0x1111111111111111111111111111111111111111' as const

/**
 * A settlement-scoped session only authorises its layers' calls, but the
 * orchestrator picks the layer after the session is signed. These assert the
 * intent carries the session's layers, so it is never routed through a layer
 * the session would refuse on-chain.
 */
function session(settlementLayers: readonly string[]) {
  return toSession({
    chain: base,
    owners: { type: 'ecdsa', accounts: [accountA] },
    account: ACCOUNT,
    crossChainPermits: [
      {
        from: { chain: base, token: USDC },
        to: { chain: arbitrum, token: USDC_ARB },
        settlementLayers,
      },
    ],
  } as never)
}

function layersFor(layers: readonly string[], explicit?: unknown): unknown {
  const intent = adaptTransaction(
    { account: {} } as never,
    {
      chain: base,
      calls: [],
      signers: { type: 'session', session: session(layers) },
      ...(explicit ? { settlementLayers: explicit } : {}),
    } as never,
  ) as { options?: { settlementLayers?: unknown } }
  return intent.options?.settlementLayers
}

describe('settlement layer pin', () => {
  test('a CCTP-scoped session limits the intent to CCTP', () => {
    expect(layersFor(['CCTP'])).toEqual({ include: ['CCTP'] })
  })

  test('an explicit filter can only narrow the session', () => {
    expect(layersFor(['CCTP'], { include: ['CCTP', 'RELAY'] })).toEqual({
      include: ['CCTP'],
    })
    expect(layersFor(['CCTP'], { exclude: ['CCTP'] })).toEqual({ include: [] })
  })

  test('a Permit2 permit leaves the filter to the caller', () => {
    expect(layersFor(['ACROSS'])).toBeUndefined()
    expect(layersFor(['ACROSS'], { exclude: ['RELAY'] })).toEqual({
      exclude: ['RELAY'],
    })
  })
})
