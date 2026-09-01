import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../test/consts'
import { toSession } from '../modules/validators/smart-sessions/resolve'
import { fynd, rhinestoneSwap, swapperZeroEx, zeroEx } from '../smart-sessions'
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
      chain: base,
      calls: [],
      signers: { type: 'session', session: session(via) },
      ...(quoters ? { quoters } : {}),
    } as never,
  ) as { options?: { quoters?: unknown } }
  return intent.options?.quoters
}

function pinForChains(
  viaByChain: Record<number, readonly unknown[] | undefined>,
) {
  const sessions = Object.fromEntries(
    Object.entries(viaByChain).map(([chainId, via]) => [
      Number(chainId),
      { session: session(via) },
    ]),
  )
  const intent = adaptTransaction(
    { account: {} } as never,
    { chain: base, calls: [], signers: { type: 'session', sessions } } as never,
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

  test('the Swapper pinned to a 0x route still pins 0x', () => {
    expect(pinFor([swapperZeroEx()])).toEqual({ include: ['0x'] })
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

  test('an explicit pin on the transaction wins over the derived one', () => {
    expect(
      pinFor([zeroEx({ settler: SETTLER })], { include: ['fynd'] }),
    ).toEqual({
      include: ['fynd'],
    })
  })

  test('per-chain sessions that agree pin the venue they share', () => {
    expect(
      pinForChains({
        8453: [zeroEx({ settler: SETTLER })],
        10: [zeroEx({ settler: SETTLER })],
      }),
    ).toEqual({ include: ['0x'] })
  })

  test('per-chain sessions that DISAGREE send no pin at all', () => {
    // `options.quoters` is one global filter with no chain dimension, so the
    // union would permit fynd on the 0x-only chain and be rejected on-chain
    // there. No venue satisfies both and no global filter can say "0x here,
    // fynd there", so there is nothing safe to send.
    expect(
      pinForChains({ 8453: [zeroEx({ settler: SETTLER })], 10: [fynd()] }),
    ).toBeUndefined()
  })

  test('per-chain sessions narrow to the venues every one of them permits', () => {
    // The 0x-only chain is the binding constraint; fynd is unsafe globally.
    expect(
      pinForChains({
        8453: [zeroEx({ settler: SETTLER }), fynd()],
        10: [zeroEx({ settler: SETTLER })],
      }),
    ).toEqual({ include: ['0x'] })
  })

  test('an unconstrained chain session does not widen a constrained one', () => {
    // A bare Swapper admits every venue, so it narrows nothing — 0x is still
    // safe for both.
    expect(
      pinForChains({
        8453: [zeroEx({ settler: SETTLER })],
        10: [rhinestoneSwap()],
      }),
    ).toEqual({ include: ['0x'] })
  })

  test('a session with no swap scope sends no pin', () => {
    const intent = adaptTransaction(
      { account: {} } as never,
      {
        chain: base,
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
