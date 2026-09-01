import { base, mainnet, plasma } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../test/consts'
import type { Session, SignerSet, SwapVenue } from '../types'
import {
  narrowQuoterPin,
  quoterPinFromSession,
  venuesForSession,
} from './quoters'

const session = (
  chain: Session['chain'],
  via?: readonly SwapVenue[],
): Session => ({
  chain,
  owners: { type: 'ecdsa', accounts: [accountA] },
  swap: {
    sell: { token: '0x1111111111111111111111111111111111111111' },
    buy: { token: '0x2222222222222222222222222222222222222222' },
    to: '0x3333333333333333333333333333333333333333',
    ...(via ? { via } : {}),
  },
})

describe('session quoter pins', () => {
  test('derives named venues and leaves the bare Swapper unconstrained', () => {
    expect(
      venuesForSession(
        session(base, [{ id: '0x', settler: accountA.address }]),
      ),
    ).toEqual(new Set(['0x']))
    expect(venuesForSession(session(base, [{ id: 'fynd' }]))).toEqual(
      new Set(['fynd']),
    )
    expect(venuesForSession(session(base, [{ id: 'rhinestone' }]))).toBeNull()
    expect(venuesForSession(session(base))).toBeNull()
  })

  test('intersects only sessions for chains touched by the intent', () => {
    const signers: SignerSet = {
      type: 'experimental_session',
      sessions: {
        [base.id]: {
          session: session(base, [{ id: '0x', settler: accountA.address }]),
        },
        [mainnet.id]: {
          session: session(mainnet, [{ id: '0x', settler: accountA.address }]),
        },
        [plasma.id]: { session: session(plasma, [{ id: 'fynd' }]) },
      },
    }

    expect(quoterPinFromSession(signers, [base.id, mainnet.id])).toEqual({
      include: ['0x'],
    })
    expect(quoterPinFromSession(signers, [base.id, plasma.id])).toEqual({
      include: [],
    })
  })

  test('an unconstrained chain does not erase another chain constraint', () => {
    const signers: SignerSet = {
      type: 'experimental_session',
      sessions: {
        [base.id]: {
          session: session(base, [{ id: '0x', settler: accountA.address }]),
        },
        [mainnet.id]: { session: session(mainnet, [{ id: 'rhinestone' }]) },
      },
    }
    expect(quoterPinFromSession(signers, [base.id, mainnet.id])).toEqual({
      include: ['0x'],
    })
  })

  test('explicit filters can narrow but never widen a derived include', () => {
    expect(
      narrowQuoterPin(
        { include: ['0x', 'fynd'] },
        { include: ['fynd', 'relay'] },
      ),
    ).toEqual({ include: ['fynd'] })
    expect(
      narrowQuoterPin({ include: ['0x', 'fynd'] }, { exclude: ['fynd'] }),
    ).toEqual({ include: ['0x'] })
    expect(
      narrowQuoterPin({ include: ['0x'] }, { include: ['relay'] }),
    ).toEqual({ include: [] })
  })

  test('an explicit filter stands alone without a session constraint', () => {
    expect(narrowQuoterPin(undefined, { exclude: ['relay'] })).toEqual({
      exclude: ['relay'],
    })
    expect(narrowQuoterPin(undefined, { include: [] })).toEqual({ include: [] })
  })
})
