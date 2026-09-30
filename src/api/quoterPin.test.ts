import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../test/consts'
import { toSession } from '../modules/validators/smart-sessions/resolve'
import { fynd, rhinestoneSwap, zeroEx } from '../smart-sessions'
import { adaptTransaction } from './account'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const USDT0 = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb' as const
const SETTLER = '0x5555555555555555555555555555555555555555' as const
const ACCOUNT = '0x1111111111111111111111111111111111111111' as const

/**
 * A venue-scoped session names its venues on-chain, but the orchestrator picks
 * the venue AFTER the session is signed — so unless the intent carries a matching
 * quoter pin, it can route through a venue the session does not permit and the
 * swap is rejected on-chain. These assert the pin is derived from the session's
 * own scope, so a caller states the venue once.
 */
function session(via: readonly unknown[] | undefined) {
  return toSession({
    chain: base,
    owners: { type: 'ecdsa', accounts: [accountA] },
    swap: {
      sell: { token: USDT0, maxTotal: 1_000_000n },
      buy: { token: USDC },
      to: ACCOUNT,
      ...(via ? { via } : {}),
    },
  } as never)
}

function pinFor(via: readonly unknown[] | undefined, quoters?: unknown) {
  const intent = adaptTransaction(
    { account: {} } as never,
    {
      destination: { chain: base },
      calls: [],
      signers: { type: 'session', session: session(via) },
      ...(quoters ? { quoters } : {}),
    } as never,
  ) as { options?: { quoters?: unknown } }
  return intent.options?.quoters
}

/**
 * Two legal roles an intent ever touches: its one `source` chain and its
 * `destination` chain. A per-chain session map may carry more entries than
 * that (see the last test below), but only these two are ever "in play" for a
 * single intent — there is no discovery across further source chains.
 */
function pinForChains(input: {
  readonly sourceChainId: number
  readonly sourceVia: readonly unknown[] | undefined
  readonly destinationChainId: number
  readonly destinationVia: readonly unknown[] | undefined
}) {
  const sessions = {
    [input.sourceChainId]: { session: session(input.sourceVia) },
    [input.destinationChainId]: { session: session(input.destinationVia) },
  }
  const intent = adaptTransaction(
    { account: {} } as never,
    {
      destination: { chain: { id: input.destinationChainId } },
      source: { chain: { id: input.sourceChainId }, token: USDC },
      calls: [],
      signers: { type: 'session', sessions },
    } as never,
  ) as { options?: { quoters?: unknown } }
  return intent.options?.quoters
}

describe('quoter pin derived from a session venue scope', () => {
  test('a 0x-scoped session pins 0x', () => {
    expect(pinFor([zeroEx({ settler: SETTLER })])).toEqual({ include: ['0x'] })
  })

  test('a fynd-scoped session pins fynd', () => {
    expect(pinFor([fynd()])).toEqual({ include: ['fynd'] })
  })

  test('a multi-venue session pins every venue it authorises', () => {
    const pin = pinFor([zeroEx({ settler: SETTLER }), fynd()]) as {
      include: string[]
    }
    expect(pin.include.sort()).toEqual(['0x', 'fynd'])
  })

  test('a 0x venue pins 0x whichever shape fills it', () => {
    // zeroEx() authorises the direct call and the Swapper-wrapped one; the pin
    // names the venue, not the call shape.
    expect(pinFor([zeroEx({ settler: SETTLER })])).toEqual({ include: ['0x'] })
  })

  test('a bare Swapper scope pins NOTHING — any venue may fill it', () => {
    // The Swapper is aggregator-agnostic, so pinning here would reject routes
    // the session actually permits. No pin is the correct answer, not a guess.
    expect(pinFor([rhinestoneSwap()])).toBeUndefined()
  })

  test('one aggregator-agnostic venue suppresses the pin for the whole set', () => {
    // Mixing a pinnable venue with an unpinnable one cannot be expressed as an
    // allow-list without excluding routes the session permits.
    // (zeroEx + rhinestoneSwap is not a legal pairing — zeroEx already covers
    // the Swapper-wrapped shape, so the resolver rejects the overlap. fynd's
    // router is distinct, so this mix is constructible.)
    expect(pinFor([fynd(), rhinestoneSwap()])).toBeUndefined()
  })

  test('an explicit pin NARROWS the derived one, it cannot widen it', () => {
    // The session's venues are what the on-chain policy accepts, so an explicit
    // filter naming something else would route outside them and be rejected at
    // execution. Asking for fynd on a 0x-only session leaves nothing.
    expect(
      pinFor([zeroEx({ settler: SETTLER })], { include: ['fynd'] }),
    ).toEqual({ include: [] })
  })

  test('an explicit pin narrows within what the session permits', () => {
    expect(
      pinFor([zeroEx({ settler: SETTLER }), fynd()], { include: ['fynd'] }),
    ).toEqual({ include: ['fynd'] })
  })

  test('an explicit pin stands alone when there is no session scope', () => {
    expect(pinFor([rhinestoneSwap()], { include: ['1inch'] })).toEqual({
      include: ['1inch'],
    })
  })

  test('source and destination sessions that agree pin the venue they share', () => {
    expect(
      pinForChains({
        sourceChainId: 8453,
        sourceVia: [zeroEx({ settler: SETTLER })],
        destinationChainId: 10,
        destinationVia: [zeroEx({ settler: SETTLER })],
      }),
    ).toEqual({ include: ['0x'] })
  })

  test('source and destination sessions that DISAGREE fail closed rather than unpinned', () => {
    // `options.quoters` is one global filter with no chain dimension, so the
    // union would permit fynd on the 0x-only chain and be rejected on-chain
    // there. No venue satisfies both, so the request is unservable — an empty
    // filter says that, where omitting it would hand the orchestrator back the
    // free choice the pin exists to take away.
    expect(
      pinForChains({
        sourceChainId: 8453,
        sourceVia: [zeroEx({ settler: SETTLER })],
        destinationChainId: 10,
        destinationVia: [fynd()],
      }),
    ).toEqual({ include: [] })
  })

  test('source and destination sessions narrow to the venues both permit', () => {
    // The 0x-only chain is the binding constraint; fynd is unsafe globally.
    expect(
      pinForChains({
        sourceChainId: 8453,
        sourceVia: [zeroEx({ settler: SETTLER }), fynd()],
        destinationChainId: 10,
        destinationVia: [zeroEx({ settler: SETTLER })],
      }),
    ).toEqual({ include: ['0x'] })
  })

  test('an unconstrained destination session does not widen a constrained source', () => {
    // A bare Swapper admits every venue, so it narrows nothing — 0x is still
    // safe for both.
    expect(
      pinForChains({
        sourceChainId: 8453,
        sourceVia: [zeroEx({ settler: SETTLER })],
        destinationChainId: 10,
        destinationVia: [rhinestoneSwap()],
      }),
    ).toEqual({ include: ['0x'] })
  })

  test('a session for a chain the intent never touches does not veto the pin', () => {
    // A per-chain session map is reusable. `prepareIntentSessions` only selects
    // the intent's own chains, so an unrelated entry must not intersect to
    // nothing and fail a quote it would never have signed.
    const sessions = {
      8453: { session: session([zeroEx({ settler: SETTLER })]) },
      10: { session: session([fynd()]) },
    }
    const intent = adaptTransaction(
      { account: {} } as never,
      {
        destination: { chain: base },
        calls: [],
        signers: { type: 'session', sessions },
      } as never,
    ) as { options?: { quoters?: unknown } }
    expect(intent.options?.quoters).toEqual({ include: ['0x'] })
  })

  test('a session with no swap scope sends no pin', () => {
    const intent = adaptTransaction(
      { account: {} } as never,
      {
        destination: { chain: base },
        calls: [],
        signers: {
          type: 'session',
          session: toSession({
            chain: base,
            owners: { type: 'ecdsa', accounts: [accountA] },
          } as never),
        },
      } as never,
    ) as { options?: { quoters?: unknown } }
    expect(intent.options?.quoters).toBeUndefined()
  })
})
