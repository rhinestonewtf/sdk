import { keccak256, toHex } from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../test/consts'
import { SETTLEMENT_CATALOG } from '../../test/utils/settlement-catalog'
import { getSessionData } from '../modules/validators/smart-sessions/digest'
import { toSession } from '../modules/validators/smart-sessions/resolve'
import type { Session } from '../modules/validators/smart-sessions/types'
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
  return toSession(
    {
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
    } as never,
    { settlement: SETTLEMENT_CATALOG },
  )
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

  test('an ACROSS-only Permit2 session limits the intent to ACROSS', () => {
    expect(layersFor(['ACROSS'])).toEqual({ include: ['ACROSS'] })
  })

  test('an explicit filter can only narrow a Permit2 session', () => {
    expect(layersFor(['ACROSS'], { include: ['ACROSS', 'RELAY'] })).toEqual({
      include: ['ACROSS'],
    })
    expect(layersFor(['ACROSS'], { exclude: ['RELAY'] })).toEqual({
      include: ['ACROSS'],
    })
    expect(() => layersFor(['ACROSS'], { exclude: ['ACROSS'] })).toThrow(
      'no settlement layer is left to settle the intent',
    )
    expect(() => layersFor(['ACROSS'], { include: ['RELAY'] })).toThrow(
      'no settlement layer is left to settle the intent',
    )
  })

  test('retired Permit2 layers add no layer to the filter', () => {
    expect(layersFor(['ACROSS', 'ECO', 'SAME_CHAIN'])).toEqual({
      include: ['ACROSS'],
    })
  })

  test('refuses a Permit2 session that names only retired layers', () => {
    for (const layers of [['ECO'], ['SAME_CHAIN'], ['ECO', 'SAME_CHAIN']]) {
      expect(() => layersFor(layers)).toThrow(
        'the session permits only retired Permit2 layers',
      )
      // An explicit filter cannot supply a layer the session cannot sign.
      expect(() => layersFor(layers, { include: ['ACROSS'] })).toThrow(
        'name ECO_IE or SAME_CHAIN_IE in its permit instead',
      )
    }
  })

  test('a Permit2 permit that names no layer leaves the filter to the caller', () => {
    expect(permit2Layers([undefined])).toBeUndefined()
    expect(permit2Layers([[]])).toBeUndefined()
    expect(permit2Layers([undefined], { exclude: ['RELAY'] })).toEqual({
      exclude: ['RELAY'],
    })
  })

  test('a session without crossChainPermits leaves the filter to the caller', () => {
    expect(permit2Layers([])).toBeUndefined()
    expect(permit2Layers([], { include: ['RELAY'] })).toEqual({
      include: ['RELAY'],
    })
  })

  test('the Permit2 layers do not change the session encoding', () => {
    const layerSets = [['ACROSS'], ['ACROSS', 'ECO'], undefined]
    expect(
      Object.fromEntries(
        layerSets.map((layers) => [
          String(layers),
          fingerprint(permit2Session([layers])),
        ]),
      ),
    ).toEqual(PERMIT2_FINGERPRINTS)
  })
})

function permit2Session(
  permits: readonly (readonly string[] | undefined)[],
): Session {
  return toSession(
    {
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      account: ACCOUNT,
      ...(permits.length
        ? {
            crossChainPermits: permits.map((settlementLayers) => ({
              from: { chain: base, token: USDC },
              to: { chain: arbitrum, token: USDC_ARB },
              ...(settlementLayers ? { settlementLayers } : {}),
            })),
          }
        : {}),
    } as never,
    { settlement: SETTLEMENT_CATALOG },
  )
}

function permit2Layers(
  permits: readonly (readonly string[] | undefined)[],
  explicit?: unknown,
): unknown {
  const intent = adaptTransaction(
    { account: {} } as never,
    {
      chain: base,
      calls: [],
      signers: { type: 'session', session: permit2Session(permits) },
      ...(explicit ? { settlementLayers: explicit } : {}),
    } as never,
  ) as { options?: { settlementLayers?: unknown } }
  return intent.options?.settlementLayers
}

/** Everything the session enables and signs with, minus the intent metadata. */
function fingerprint(session: Session): string {
  return keccak256(
    toHex(
      JSON.stringify(
        {
          permissionId: session.permissionId,
          data: getSessionData(session),
          claimPolicies: session.claimPolicies,
          hasExplicitPermissions: session.hasExplicitPermissions,
        },
        (_, value) =>
          typeof value === 'bigint'
            ? value.toString()
            : value && typeof value === 'object' && 'rpcUrls' in value
              ? value.id
              : value,
      ),
    ),
  )
}

// Captured from origin/main, before a Permit2 session carried its layers.
const PERMIT2_FINGERPRINTS: Record<string, string> = {
  ACROSS: '0xde85b36b910f2af3fc2e2d016fb53f575a24750e68ce12e2164478a66cd4b7af',
  'ACROSS,ECO':
    '0x8e8cef790a7a8af4b148d9a22bd3e770dc095650a4001faab956c06545e56649',
  undefined:
    '0x98648166ab66979b2497021e9b81d3685b6dc5951abd908364172eeb60b32939',
}
