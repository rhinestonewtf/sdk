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
function session(
  layers: readonly string[] | undefined | null,
  fallback?: 'intentExecution' | 'sudo',
) {
  return toSession(
    {
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      account: ACCOUNT,
      ...(fallback ? { fallback } : {}),
      ...(layers === null
        ? {}
        : {
            crossChainPermits: [
              {
                from: { chain: base, token: USDC },
                to: { chain: arbitrum, token: USDC_ARB },
                ...(layers ? { settlementLayers: layers } : {}),
                // A reusable scoped Permit2 permit needs it.
                ...(fallback || layers?.includes('CCTP')
                  ? {}
                  : { preClaimOps: 'none' }),
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
  fallback?: 'intentExecution' | 'sudo',
): unknown {
  const intent = adaptTransaction(
    { account: {} } as never,
    {
      targetChain: arbitrum,
      sourceChains: [base],
      calls: [],
      signers: { type: 'session', session: session(layers, fallback) },
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
        targetChain: arbitrum,
        sourceChains: [base],
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
        targetChain: arbitrum,
        sourceChains: [base],
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
        targetChain: arbitrum,
        sourceChains: [base],
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
        targetChain: arbitrum,
        sourceChains: [base],
        calls: [],
        signers: { type: 'session', session: sameChain },
      } as never,
    ) as { options?: { settlementLayers?: unknown } }
    expect(intent.options?.settlementLayers).toBeUndefined()
  })

  test('a scoped Permit2 session limits the intent to ACROSS', () => {
    for (const layers of [['ACROSS'], undefined, []]) {
      expect(layersFor(layers)).toEqual({ include: ['ACROSS'] })
    }
  })

  test('an explicit filter can only narrow a scoped Permit2 session', () => {
    expect(layersFor(['ACROSS'], { include: ['ACROSS', 'RELAY'] })).toEqual({
      include: ['ACROSS'],
    })
    expect(layersFor(undefined, { exclude: ['RELAY'] })).toEqual({
      include: ['ACROSS'],
    })
    expect(() => layersFor(['ACROSS'], { include: ['RELAY'] })).toThrow(
      'no settlement layer is left to settle the intent',
    )
    expect(() => layersFor(undefined, { exclude: ['ACROSS'] })).toThrow(
      'no settlement layer is left to settle the intent',
    )
  })

  describe.each(['intentExecution', 'sudo'] as const)(
    'a Permit2 session with fallback: %s',
    (fallback) => {
      test('naming ACROSS leaves the filter to the caller', () => {
        expect(layersFor(['ACROSS'], undefined, fallback)).toBeUndefined()
        expect(
          layersFor(['ACROSS', 'SAME_CHAIN'], undefined, fallback),
        ).toBeUndefined()
        expect(
          layersFor(['ACROSS'], { include: ['ACROSS', 'RELAY'] }, fallback),
        ).toEqual({ include: ['ACROSS', 'RELAY'] })
      })

      test('excludes only the arbiter it cannot sign', () => {
        // The fallback still settles IntentExecutor routes such as RELAY or CCTP.
        expect(layersFor(['SAME_CHAIN'], undefined, fallback)).toEqual({
          exclude: ['ACROSS'],
        })
      })

      test('an explicit filter can only narrow it', () => {
        expect(
          layersFor(['SAME_CHAIN'], { include: ['ACROSS', 'RELAY'] }, fallback),
        ).toEqual({ include: ['RELAY'] })
        expect(
          layersFor(['SAME_CHAIN'], { exclude: ['RELAY'] }, fallback),
        ).toEqual({
          exclude: ['RELAY', 'ACROSS'],
        })
        expect(() =>
          layersFor(['SAME_CHAIN'], { include: ['ACROSS'] }, fallback),
        ).toThrow(
          'no settlement layer is left to settle the intent; the session cannot sign ACROSS',
        )
      })

      test('naming no layer leaves the filter to the caller', () => {
        expect(layersFor(undefined, undefined, fallback)).toBeUndefined()
        expect(layersFor([], undefined, fallback)).toBeUndefined()
        expect(layersFor(undefined, { exclude: ['RELAY'] }, fallback)).toEqual({
          exclude: ['RELAY'],
        })
      })
    },
  )

  test('a session without crossChainPermits leaves the filter to the caller', () => {
    expect(layersFor(null)).toBeUndefined()
    expect(layersFor(null, { include: ['RELAY'] })).toEqual({
      include: ['RELAY'],
    })
  })

  test('the Permit2 layers do not change the session encoding', () => {
    const layerSets = [['ACROSS'], undefined]
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

// Captured from origin/main, before a Permit2 session carried its layers;
// moved when Permit2-route sessions became scoped (RHI-8045), and again when
// they took preClaimOps: 'none' and omitted layers came to admit ACROSS alone.
const PERMIT2_FINGERPRINTS: Record<string, string> = {
  ACROSS: '0xe6fa95b4cd4438b8eb63f08e7667f3cb033e81feda1ce62546d7d8c19ca6af86',
  // Omitted layers admit ACROSS alone, as naming it does.
  undefined:
    '0xe6fa95b4cd4438b8eb63f08e7667f3cb033e81feda1ce62546d7d8c19ca6af86',
}

describe('source asset pin', () => {
  const OTHER = '0x4200000000000000000000000000000000000006' as const
  const accessFor = (
    sourceAssets?: unknown,
    fallback?: 'intentExecution' | 'sudo',
  ) =>
    (
      adaptTransaction(
        { account: {} } as never,
        {
          targetChain: arbitrum,
          sourceChains: [base],
          calls: [],
          signers: {
            type: 'session',
            session: session(['ACROSS'], fallback),
          },
          ...(sourceAssets ? { sourceAssets } : {}),
        } as never,
      ) as { accountAccessList?: unknown }
    ).accountAccessList

  test("a scoped Permit2 session funds the intent only from its permit's `from` tokens", () => {
    expect(accessFor()).toEqual({ chainTokens: { [base.id]: [USDC] } })
  })

  test('refuses a same-chain intent', () => {
    const sameChain = (fallback?: 'sudo') =>
      adaptTransaction(
        { account: {} } as never,
        {
          chain: base,
          calls: [],
          signers: { type: 'session', session: session(['ACROSS'], fallback) },
        } as never,
      )
    expect(() => sameChain()).toThrow(
      'A scoped Permit2 session settles cross-chain intents only',
    )
    expect(() => sameChain('sudo')).not.toThrow()
  })

  test('an explicit sourceAssets can only narrow it', () => {
    expect(accessFor([USDC, OTHER])).toEqual({
      chainTokens: { [base.id]: [USDC] },
    })
    expect(accessFor([{ chain: base, address: USDC, amount: 5n }])).toEqual({
      chainTokenAmounts: { [base.id]: { [USDC]: 5n } },
    })
    expect(() => accessFor({ [base.id]: [OTHER] })).toThrow(
      'No source asset is left for the intent',
    )
  })

  test('keeps only the listed chains and tokens', () => {
    const multi = toSession(
      {
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA] },
        account: ACCOUNT,
        crossChainPermits: [
          {
            from: [
              { chain: base, token: USDC },
              { chain: base, token: OTHER },
              { chain: arbitrum, token: USDC_ARB },
            ],
            to: { chain: arbitrum, token: USDC_ARB },
            settlementLayers: ['ACROSS'],
            preClaimOps: 'none',
          },
        ],
      } as never,
      { settlement: SETTLEMENT_CATALOG },
    )
    const pin = (sourceAssets?: unknown) =>
      (
        adaptTransaction(
          { account: {} } as never,
          {
            targetChain: arbitrum,
            sourceChains: [base],
            calls: [],
            signers: { type: 'session', session: multi },
            ...(sourceAssets ? { sourceAssets } : {}),
          } as never,
        ) as { accountAccessList?: unknown }
      ).accountAccessList
    // The intent's source chain is base, so arbitrum's leg is left out.
    expect(pin()).toEqual({ chainTokens: { [base.id]: [USDC, OTHER] } })
    expect(pin([OTHER])).toEqual({ chainTokens: { [base.id]: [OTHER] } })
  })

  describe('with a capped `from` leg', () => {
    const capped = toSession(
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
            from: { chain: base, token: USDC, maxAmount: 5n },
            to: { chain: arbitrum, token: USDC_ARB },
            settlementLayers: ['ACROSS'],
          },
        ],
      } as never,
      { settlement: SETTLEMENT_CATALOG },
    )
    const pin = (extra: object = {}) =>
      (
        adaptTransaction(
          { account: {} } as never,
          {
            targetChain: arbitrum,
            sourceChains: [base],
            calls: [],
            signers: { type: 'session', session: capped },
            ...extra,
          } as never,
        ) as { accountAccessList?: unknown }
      ).accountAccessList
    const atMost = (amount: bigint) => ({
      chainTokenAmounts: { [base.id]: { [USDC]: amount } },
    })

    test('caps what the orchestrator may plan to spend, whatever the intent asks', () => {
      // Max-out (no amount), and a request whose input plus fees exceeds the cap.
      expect(pin()).toEqual(atMost(5n))
      expect(
        pin({ tokenRequests: [{ address: USDC_ARB, amount: 10n }] }),
      ).toEqual(atMost(5n))
    })

    test('an explicit amount can only lower the cap', () => {
      const amount = (value: bigint) => ({
        sourceAssets: [{ chain: base, address: USDC, amount: value }],
      })
      expect(pin(amount(9n))).toEqual(atMost(5n))
      expect(pin(amount(3n))).toEqual(atMost(3n))
      expect(pin({ sourceAssets: [USDC] })).toEqual(atMost(5n))
    })

    test('an explicit amount on another token is dropped', () => {
      expect(() =>
        pin({ sourceAssets: [{ chain: base, address: OTHER, amount: 5n }] }),
      ).toThrow('No source asset is left for the intent')
      expect(
        pin({
          sourceAssets: [
            { chain: base, address: USDC, amount: 5n },
            { chain: base, address: OTHER, amount: 7n },
          ],
        }),
      ).toEqual(atMost(5n))
    })
  })

  test.each(['intentExecution', 'sudo'] as const)(
    'a session with fallback: %s leaves the source assets to the caller',
    (fallback) => {
      expect(accessFor(undefined, fallback)).toEqual({ chainIds: [base.id] })
    },
  )
})
