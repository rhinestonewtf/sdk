import { arbitrumSepolia, baseSepolia } from 'viem/chains'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
  vi,
} from 'vitest'
import { accountA } from '../../test/consts'
import { RhinestoneSDK } from '../index'
import type { Quote } from '../orchestrator/types'
import { type BlancRoute, quoteFromBlanc } from '../orchestrator/wire-quote'
import multichainRoute from './__fixtures__/multichain-route.json'
import type { PreparedTransactionData, SignedTransactionData } from './utils'

// The prepared and signed transaction shapes are public: `intentRoute` was
// replaced by `quote` when v1 moved to the blanc API version.

beforeEach(() => {
  vi.stubGlobal('fetch', async (input: unknown) => {
    throw new Error(`network blocked: ${String(input)}`)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prepared transaction shape', () => {
  test('types carry the quote instead of the intent route', () => {
    expectTypeOf<PreparedTransactionData['quote']>().toEqualTypeOf<Quote>()
    expectTypeOf<PreparedTransactionData>().not.toHaveProperty('intentRoute')
    expectTypeOf<SignedTransactionData>().not.toHaveProperty('intentRoute')
    expectTypeOf<SignedTransactionData['permitSignatures']>().toEqualTypeOf<
      Record<number, Record<`0x${string}`, `0x${string}`>> | undefined
    >()
  })

  test('a signed transaction holds the quote and the signatures', async () => {
    const prepared: PreparedTransactionData = {
      quote: quoteFromBlanc(multichainRoute as unknown as BlancRoute),
      intentInput: {},
      transaction: {
        sourceChains: [baseSepolia],
        targetChain: arbitrumSepolia,
      },
    }
    const account = await new RhinestoneSDK({
      apiKey: 'offline',
    }).createAccount({ owners: { type: 'ecdsa', accounts: [accountA] } })
    expect(Object.keys(account.getTransactionMessages(prepared))).toEqual([
      'origin',
      'destination',
    ])
    const signed = await account.signTransaction(prepared)
    expect(Object.keys(signed).sort()).toEqual(
      [
        'quote',
        'intentInput',
        'transaction',
        'originSignatures',
        'destinationSignature',
        'targetExecutionSignature',
        'permitSignatures',
      ].sort(),
    )
    expect(signed.quote).toBe(prepared.quote)
  })
})
