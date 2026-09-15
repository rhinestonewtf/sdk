import type { SignedAuthorization } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  mapIntentRequestToWire,
  mapIntentStatusFromWire,
  mapQuoteResponseFromWire,
  mapSignedIntentToWire,
  mapSupportedSignData,
} from './mappers'
import type { OrchestratorSignedIntent } from './types'

const address = '0x0000000000000000000000000000000000000001' as const

function authorization(chainId: number): SignedAuthorization {
  return {
    chainId,
    address,
    nonce: 7,
    yParity: 1,
    r: '0x01',
    s: '0x02',
  }
}

function signedIntent(
  authorizations?: OrchestratorSignedIntent['authorizations'],
): OrchestratorSignedIntent {
  return {
    intentId: 'intent-1',
    signatures: {
      origin: ['0x03', { preClaimSig: '0x04', notarizedClaimSig: '0x05' }],
      destination: '0x06',
      targetExecution: '0x07',
    },
    ...(authorizations ? { authorizations } : {}),
    dryRun: true,
  }
}

describe('mapSupportedSignData', () => {
  const untaggedTypedData = {
    domain: { chainId: 1, verifyingContract: address },
    types: { Test: [{ name: 'value', type: 'uint256' }] },
    primaryType: 'Test',
    message: { value: '1' },
  }
  const taggedTypedData = { kind: 'eip712', ...untaggedTypedData } as const
  const personalSign = {
    kind: 'personalSign',
    message: 'ab'.repeat(32),
    expiresAtSlot: '370123456',
  } as const

  test('accepts tagged EIP-712 origins and untagged destinations', () => {
    expect(
      mapSupportedSignData({
        origin: [taggedTypedData],
        destination: untaggedTypedData,
      }),
    ).toEqual({
      origin: [taggedTypedData],
      destination: untaggedTypedData,
    })
  })

  test('normalizes legacy untagged EIP-712 origins', () => {
    expect(mapSupportedSignData({ origin: [untaggedTypedData] })).toEqual({
      origin: [{ kind: 'eip712', ...untaggedTypedData }],
    })
  })

  test('accepts a personal-sign origin without destination data', () => {
    expect(mapSupportedSignData({ origin: [personalSign] })).toEqual({
      origin: [personalSign],
    })
  })

  test.each([
    [{ kind: 'personalSign', message: 'payload', expiresAtSlot: '1' }],
    [{ kind: 'personalSign', message: 'ab'.repeat(32), expiresAtSlot: 1 }],
    [{ kind: 'personalSign', message: 'ab'.repeat(32), expiresAtSlot: '1.5' }],
  ])('rejects malformed personal-sign payloads', (origin) => {
    expect(() => mapSupportedSignData({ origin: [origin] })).toThrow(
      /invalid personal-sign origin payload/,
    )
  })

  test('rejects tags on destination EIP-712 data', () => {
    expect(() =>
      mapSupportedSignData({
        origin: [taggedTypedData],
        destination: taggedTypedData,
      }),
    ).toThrow(/untagged EIP-712 destination/)
  })

  test('fails the quote response on an unsupported scheme instead of dropping the route', () => {
    const route = {
      intentId: 'unsupported',
      expiresAt: 1,
      estimatedFillTime: { seconds: 1 },
      settlementLayer: 'SAME_CHAIN',
      signData: { origin: [{ kind: 'unknown' }] },
      cost: {
        input: [],
        output: [],
        fees: { total: { usd: 0 }, breakdown: {} },
      },
    }

    expect(() =>
      mapQuoteResponseFromWire({ traceId: 'trace', routes: [route] } as never),
    ).toThrow(/unsupported origin signing scheme: unknown/)
  })

  test('preserves non-EVM cost token references', () => {
    const mint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
    const route = {
      intentId: 'solana',
      expiresAt: 1,
      estimatedFillTime: { seconds: 1 },
      settlementLayer: 'SAME_CHAIN',
      signData: { origin: [personalSign] },
      cost: {
        input: [
          {
            chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
            tokenAddress: mint,
            symbol: 'USDC',
            decimals: 6,
            price: { usd: 1 },
            amount: '100000',
          },
        ],
        output: [],
        fees: { total: { usd: 0 }, breakdown: {} },
      },
    }

    expect(
      mapQuoteResponseFromWire({ traceId: 'trace', routes: [route] } as never)
        .routes[0]?.cost.input[0]?.tokenAddress,
    ).toBe(mint)
  })
})

describe('mapSignedIntentToWire', () => {
  test('maps concrete and any-chain sponsor and recipient authorizations', () => {
    const result = mapSignedIntentToWire(
      signedIntent({
        sponsor: [authorization(8453), authorization(0)],
        recipient: [authorization(10), authorization(0)],
      }),
    )

    expect(result).toEqual({
      intentId: 'intent-1',
      signatures: {
        origin: ['0x03', { preClaimSig: '0x04', notarizedClaimSig: '0x05' }],
        destination: '0x06',
        targetExecution: '0x07',
      },
      authorizations: {
        sponsor: [
          {
            chainId: 'eip155:8453',
            address,
            nonce: 7,
            yParity: 1,
            r: '0x01',
            s: '0x02',
          },
          {
            chainId: 0,
            address,
            nonce: 7,
            yParity: 1,
            r: '0x01',
            s: '0x02',
          },
        ],
        recipient: [
          {
            chainId: 'eip155:10',
            address,
            nonce: 7,
            yParity: 1,
            r: '0x01',
            s: '0x02',
          },
          {
            chainId: 0,
            address,
            nonce: 7,
            yParity: 1,
            r: '0x01',
            s: '0x02',
          },
        ],
      },
      options: { dryRun: true },
    })
  })

  test('keeps omitted authorizations omitted', () => {
    expect(mapSignedIntentToWire(signedIntent())).not.toHaveProperty(
      'authorizations',
    )
  })

  test('omits a missing destination signature instead of sending a placeholder', () => {
    const result = mapSignedIntentToWire({
      intentId: 'solana-intent',
      signatures: { origin: ['0x03'] },
    })

    expect(result).toEqual({
      intentId: 'solana-intent',
      signatures: { origin: ['0x03'] },
    })
    expect(result.signatures).not.toHaveProperty('destination')
  })

  test.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
    ['HyperCore L1', 1337],
    ['HyperCore spot', 1337001],
    ['HyperCore perp', 1337002],
    ['Tron', 728126428],
    ['Solana', 792703809],
  ])('rejects %s authorization chain IDs', (_name, chainId) => {
    expect(() =>
      mapSignedIntentToWire(
        signedIntent({ sponsor: [authorization(chainId)] }),
      ),
    ).toThrow(new Error(`Invalid EIP-7702 authorization chain ID: ${chainId}`))
  })
})

describe('mapIntentRequestToWire — quoter pin', () => {
  const base = {
    account: { address, accountType: 'ERC7579' },
    destinationChainId: 8453,
    tokenRequests: [],
    options: {},
  } as never

  // A venue pin only protects a scoped session if it actually leaves the SDK.
  // The mapper enumerates most options explicitly, so a new one silently
  // vanishing here is the failure this guards.
  test('carries options.quoters through to the wire request', () => {
    const wire = mapIntentRequestToWire({
      ...(base as object),
      options: { quoters: { include: ['0x'] } },
    } as never) as { options?: { quoters?: unknown } }
    expect(wire.options?.quoters).toEqual({ include: ['0x'] })
  })

  test('carries an exclude filter through unchanged', () => {
    const wire = mapIntentRequestToWire({
      ...(base as object),
      options: { quoters: { exclude: ['fynd', 'relay'] } },
    } as never) as { options?: { quoters?: unknown } }
    expect(wire.options?.quoters).toEqual({ exclude: ['fynd', 'relay'] })
  })

  test('carries an EMPTY filter through instead of dropping it', () => {
    // An empty filter is how conflicting per-chain session scopes say "no venue
    // can serve this". Dropping it here would turn a fail-closed request back
    // into an unconstrained one — the exact outcome the pin exists to prevent.
    const wire = mapIntentRequestToWire({
      ...(base as object),
      options: { quoters: { include: [] } },
    } as never) as { options?: { quoters?: unknown } }
    expect(wire.options?.quoters).toEqual({ include: [] })
  })

  test('omits it entirely when unset, rather than sending an empty filter', () => {
    // An empty filter means "no venue" server-side and fails closed, so an
    // absent pin must not become one.
    const wire = mapIntentRequestToWire(base) as {
      options?: { quoters?: unknown }
    }
    expect(wire.options?.quoters).toBeUndefined()
  })
})

describe('mapIntentRequestToWire — Solana destination', () => {
  // Base58 is case-sensitive: any lowercasing or checksumming of a mint or a
  // recipient on the way to the wire delivers to a different account.
  const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  const recipient = 'EEnKdeMRGrhKq1Z2rkRubkrkTxCZigLZ5QgUYqAMvPnU'

  const request = {
    account: { address, accountType: 'ERC7579' },
    destinationChainId: 792703809,
    destinationExecutions: [],
    tokenRequests: [{ tokenAddress: mint, amount: 50000n }],
    recipient: { address: recipient },
    accountAccessList: { chainIds: [8453] },
    options: {},
  } as never

  test('sends the CAIP-2 destination and passes base58 references through verbatim', () => {
    const wire = mapIntentRequestToWire(request) as unknown as {
      destinationChainId: string
      tokenRequests: readonly { tokenAddress: string; amount: string }[]
      recipient?: Record<string, unknown>
      accountAccessList?: unknown
    }

    expect(wire.destinationChainId).toBe(
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    )
    expect(wire.tokenRequests).toEqual([
      { tokenAddress: mint, amount: '50000' },
    ])
    // A non-EVM recipient carries no account type or setup ops to project.
    expect(wire.recipient).toEqual({ address: recipient })
    expect(wire.accountAccessList).toEqual({ chainIds: ['eip155:8453'] })
  })
})

describe('mapIntentRequestToWire — HyperCore action', () => {
  const base = {
    account: { address, accountType: 'ERC7579' },
    destinationChainId: 1337002,
    tokenRequests: [],
    options: {},
  } as never

  const action = {
    type: 'order',
    orders: [
      {
        a: 0,
        b: true,
        p: '64572',
        s: '0.00155',
        r: false,
        t: { limit: { tif: 'Ioc' } },
      },
    ],
    grouping: 'na',
  }

  // The agent authorising the action is derived from these bytes, so the mapper
  // reaching in to normalise or reorder anything would forge a different agent
  // than the one the caller's signature registers.
  test('carries the action to the wire byte for byte', () => {
    const wire = mapIntentRequestToWire({
      ...(base as object),
      options: { hyperCore: { action } },
    } as never) as { options?: { hyperCore?: unknown } }

    expect(wire.options?.hyperCore).toEqual({ action })
    expect(JSON.stringify(wire.options?.hyperCore)).toBe(
      JSON.stringify({ action }),
    )
  })

  test('omits it entirely when unset', () => {
    const wire = mapIntentRequestToWire(base) as {
      options?: { hyperCore?: unknown }
    }
    expect(wire.options?.hyperCore).toBeUndefined()
  })
})

describe('mapIntentStatusFromWire native transaction references', () => {
  test('preserves a Solana transaction signature exactly', () => {
    const signature =
      '5KtPn1LGuxhFiKZ9xVLYBu9A2yBqX6gB4XzYGVxV9Dszgvn6YxrY3JQSMNJ4e6d7S5kJqY2LxA2nCE4BrVQCLH5m'
    const mapped = mapIntentStatusFromWire('intent-1', {
      traceId: 'trace-1',
      status: 'COMPLETED',
      accountAddress: address,
      operations: [
        {
          chain: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
          items: [{ status: 'COMPLETED', txHash: signature, timestamp: 1 }],
        },
      ],
    })

    expect(mapped.operations[0]).toMatchObject({
      chain: 792703810,
      status: 'COMPLETED',
      txHash: signature,
    })
  })
})

describe('mapIntentStatusFromWire refunds', () => {
  const REFUND_TX =
    '0x8e483d74ff15e79f86e0c23e81444a5db5b2ce31c9ec28f84259dfc83f0bbc28'

  const status = (refunds?: unknown) => ({
    traceId: 'trace-1',
    status: 'FAILED',
    accountAddress: address,
    operations: [
      { chain: 8453, items: [{ status: 'COMPLETED', txHash: '0xaa' }] },
    ],
    ...(refunds === undefined ? {} : { refunds }),
  })

  test('surfaces the refund transaction and chain', () => {
    const mapped = mapIntentStatusFromWire(
      'intent-1',
      status([{ chain: 8453, txHash: REFUND_TX }]),
    )
    expect(mapped.refunds).toEqual([{ chain: 8453, txHash: REFUND_TX }])
  })

  test('leaves refunds absent when the orchestrator reports none', () => {
    // Not `[]`. The key is omitted when no refund is KNOWN, which is a
    // different fact from "there was none" — defaulting here would tell a
    // caller reconciling a failed intent that the funds were kept.
    const mapped = mapIntentStatusFromWire('intent-1', status())
    expect('refunds' in mapped).toBe(false)
  })

  test('parses a CAIP-2 refund chain the way an operation chain is parsed', () => {
    // `chain` is a number on today's wire, but it goes through the same helper
    // as `operations[].chain`, so the two cannot diverge if that changes.
    const mapped = mapIntentStatusFromWire(
      'intent-1',
      status([{ chain: 'eip155:42161', txHash: REFUND_TX }]),
    )
    expect(mapped.refunds).toEqual([{ chain: 42161, txHash: REFUND_TX }])
  })
})

describe('mapIntentStatusFromWire hyperCore', () => {
  const status = (hyperCore?: unknown) => ({
    traceId: 'trace-1',
    status: 'FAILED',
    accountAddress: address,
    operations: [
      { chain: 8453, items: [{ status: 'COMPLETED', txHash: '0xaa' }] },
    ],
    ...(hyperCore === undefined ? {} : { hyperCore }),
  })

  test('surfaces the outcome and its reason', () => {
    const mapped = mapIntentStatusFromWire(
      'intent-1',
      status({ outcome: 'refused', reason: 'Insufficient margin.' }),
    )
    expect(mapped.hyperCore).toEqual({
      outcome: 'refused',
      reason: 'Insufficient margin.',
    })
  })

  test('surfaces an outcome that carries no reason', () => {
    const mapped = mapIntentStatusFromWire(
      'intent-1',
      status({ outcome: 'accepted' }),
    )
    expect(mapped.hyperCore).toEqual({ outcome: 'accepted' })
  })

  test('leaves hyperCore absent when the intent carried no action', () => {
    const mapped = mapIntentStatusFromWire('intent-1', status())
    expect('hyperCore' in mapped).toBe(false)
  })

  test('keeps a partial outcome distinct from a refused one', () => {
    // A partial placed orders and must not be re-sent; a refusal placed none
    // and is safe to retry. Both arrive with every operation COMPLETED.
    const partial = mapIntentStatusFromWire(
      'intent-1',
      status({
        outcome: 'partial',
        reason: 'action 0 accepted; action 1 refused: Insufficient margin.',
      }),
    )
    const refused = mapIntentStatusFromWire(
      'intent-1',
      status({ outcome: 'refused', reason: 'Insufficient margin.' }),
    )
    expect(partial.hyperCore?.outcome).toBe('partial')
    expect(refused.hyperCore?.outcome).toBe('refused')
  })
})
