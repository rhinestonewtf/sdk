import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../test/consts'
import { sessionFingerprint } from '../../test/utils/session-fingerprint'
import { SETTLEMENT_CATALOG } from '../../test/utils/settlement-catalog'
import { toSession } from '../modules/validators/smart-sessions/resolve'
import { adaptTransaction } from './account'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const
const ACCOUNT = '0x1111111111111111111111111111111111111111' as const

/**
 * The orchestrator picks the layer after the session is signed. These assert
 * the intent never offers a route the session would refuse on-chain, and only
 * narrows the routes a session with the intent-execution fallback can take.
 * `layers` is the permit's `settlementLayers`; `null` gives no permit at all.
 */
function session(layers: readonly string[] | undefined | null) {
  return toSession(
    {
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      account: ACCOUNT,
      ...(layers === null
        ? {}
        : {
            crossChainPermits: [
              {
                from: { chain: base, token: USDC },
                to: { chain: arbitrum, token: USDC_ARB },
                ...(layers ? { settlementLayers: layers } : {}),
              },
            ],
          }),
    } as never,
    { settlement: SETTLEMENT_CATALOG },
  )
}

function layersFor(
  layers: readonly string[] | undefined | null,
  explicit?: unknown,
): unknown {
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

  test("an ECO_IE session limits the intent to the orchestrator's ECO", () => {
    const eco = toSession(
      {
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA] },
        account: ACCOUNT,
        oneTimeUse: { id: 7n },
        policyAddresses: {
          oneTimeUseId: '0x3333333333333333333333333333333333333333',
        },
        crossChainPermits: [
          {
            from: { chain: base, token: USDC, maxAmount: 100n },
            to: { chain: arbitrum, token: USDC_ARB },
            settlementLayers: ['ECO_IE'],
            maxFeeBps: 50,
            validUntil: new Date(2_000_000_000_000),
          },
        ],
      } as never,
      { settlement: SETTLEMENT_CATALOG },
    )
    const intent = adaptTransaction(
      { account: {} } as never,
      {
        chain: base,
        calls: [],
        signers: { type: 'session', session: eco },
      } as never,
    ) as { options?: { settlementLayers?: unknown } }
    expect(intent.options?.settlementLayers).toEqual({ include: ['ECO'] })
  })

  test('a multi-layer session limits the intent to each of its layers', () => {
    const multi = toSession(
      {
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA] },
        account: ACCOUNT,
        oneTimeUse: { id: 7n },
        policyAddresses: {
          oneTimeUseId: '0x3333333333333333333333333333333333333333',
        },
        crossChainPermits: [
          {
            from: { chain: base, token: USDC, maxAmount: 100n },
            to: { chain: arbitrum, token: USDC_ARB },
            settlementLayers: ['CCTP', 'ECO_IE', 'LZ'],
            maxFeeBps: 50,
            validUntil: new Date(2_000_000_000_000),
          },
        ],
      } as never,
      { settlement: SETTLEMENT_CATALOG },
    )
    const intent = adaptTransaction(
      { account: {} } as never,
      {
        chain: base,
        calls: [],
        signers: { type: 'session', session: multi },
      } as never,
    ) as { options?: { settlementLayers?: unknown } }
    expect(intent.options?.settlementLayers).toEqual({
      include: ['CCTP', 'ECO', 'LZ'],
    })
  })

  test("an 'all' session limits the intent to the layers it kept", () => {
    const all = toSession(
      {
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA] },
        account: ACCOUNT,
        oneTimeUse: { id: 7n },
        policyAddresses: {
          oneTimeUseId: '0x3333333333333333333333333333333333333333',
        },
        crossChainPermits: [
          {
            from: { chain: base, token: USDC },
            to: { chain: arbitrum, token: USDC_ARB },
            settlementLayers: 'all',
          },
        ],
      } as never,
      { settlement: SETTLEMENT_CATALOG },
    )
    const intent = adaptTransaction(
      { account: {} } as never,
      {
        chain: base,
        calls: [],
        signers: { type: 'session', session: all },
      } as never,
    ) as { options?: { settlementLayers?: unknown } }
    expect(intent.options?.settlementLayers).toEqual({
      include: ['CCTP', 'LZ'],
    })
  })

  test('an explicit filter can only narrow the session', () => {
    expect(layersFor(['CCTP'], { include: ['CCTP', 'RELAY'] })).toEqual({
      include: ['CCTP'],
    })
  })

  test('refuses a filter that leaves the session no layer', () => {
    expect(() => layersFor(['CCTP'], { exclude: ['CCTP'] })).toThrow(
      'no settlement layer is left to settle the intent',
    )
    expect(() => layersFor(['CCTP'], { include: ['RELAY'] })).toThrow(
      'no settlement layer is left to settle the intent',
    )
  })

  test('a SAME_CHAIN_IE session adds no bridge filter', () => {
    const sameChain = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      account: ACCOUNT,
      crossChainPermits: [
        {
          from: { chain: base, token: USDC },
          to: {
            chain: base,
            token: USDC,
            recipient: '0x2222222222222222222222222222222222222222',
          },
          allowRecipientNotAccount: true,
          settlementLayers: ['SAME_CHAIN_IE'],
        },
      ],
    } as never)
    expect(sameChain.settlementLayers).toEqual(['SAME_CHAIN_IE'])
    const intent = adaptTransaction(
      { account: {} } as never,
      {
        chain: base,
        calls: [],
        signers: { type: 'session', session: sameChain },
      } as never,
    ) as { options?: { settlementLayers?: unknown } }
    expect(intent.options?.settlementLayers).toBeUndefined()
  })

  test('a Permit2 session naming ACROSS leaves the filter to the caller', () => {
    expect(layersFor(['ACROSS'])).toBeUndefined()
    expect(layersFor(['ACROSS', 'ECO'])).toBeUndefined()
    expect(layersFor(['ACROSS'], { include: ['ACROSS', 'RELAY'] })).toEqual({
      include: ['ACROSS', 'RELAY'],
    })
  })

  test('a Permit2 session excludes only the arbiter it cannot sign', () => {
    // The fallback still settles IntentExecutor routes such as RELAY or CCTP.
    for (const layers of [['ECO'], ['SAME_CHAIN'], ['ECO', 'SAME_CHAIN']]) {
      expect(layersFor(layers)).toEqual({ exclude: ['ACROSS'] })
    }
  })

  test('an explicit filter can only narrow a Permit2 session', () => {
    expect(layersFor(['ECO'], { include: ['ACROSS', 'RELAY'] })).toEqual({
      include: ['RELAY'],
    })
    expect(layersFor(['ECO'], { exclude: ['RELAY'] })).toEqual({
      exclude: ['RELAY', 'ACROSS'],
    })
    expect(() => layersFor(['ECO'], { include: ['ACROSS'] })).toThrow(
      'no settlement layer is left to settle the intent; the session cannot sign ACROSS',
    )
  })

  test('a Permit2 permit that names no layer leaves the filter to the caller', () => {
    expect(layersFor(undefined)).toBeUndefined()
    expect(layersFor([])).toBeUndefined()
    expect(layersFor(undefined, { exclude: ['RELAY'] })).toEqual({
      exclude: ['RELAY'],
    })
  })

  test('a session without crossChainPermits leaves the filter to the caller', () => {
    expect(layersFor(null)).toBeUndefined()
    expect(layersFor(null, { include: ['RELAY'] })).toEqual({
      include: ['RELAY'],
    })
  })

  test('the Permit2 layers do not change the session encoding', () => {
    const layerSets = [['ACROSS'], ['ACROSS', 'ECO'], undefined]
    expect(
      Object.fromEntries(
        layerSets.map((layers) => [
          String(layers),
          sessionFingerprint(session(layers)),
        ]),
      ),
    ).toEqual(PERMIT2_FINGERPRINTS)
  })
})

// Captured from origin/main, before a Permit2 session carried its layers.
const PERMIT2_FINGERPRINTS: Record<string, string> = {
  ACROSS: '0x96bd6382888ab3db8290dfe1f55e47dc829788f9c4bd693aefe48223741ca139',
  'ACROSS,ECO':
    '0xec5782e18534d347a80ae0eef42453faae0570b7e52f36608e6717ae8e67bb1e',
  undefined:
    '0xe6512d4da3c112e3171cac65ebf40c4c322aa06687c5edc2e1675b13aabc7c2d',
}
