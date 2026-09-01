import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../test/consts'
import { mapIntentRequestToWire } from '../clients/orchestrator/mappers'
import { toSession } from '../modules/validators/smart-sessions/resolve'
import { fynd, rhinestoneSwap, zeroEx } from '../smart-sessions'
import { buildIntentRequest } from '../transactions/intents/request'
import { adaptTransaction } from './account'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const USDT0 = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb' as const
const SETTLER = '0x5555555555555555555555555555555555555555' as const
const ACCOUNT = '0x1111111111111111111111111111111111111111' as const

/**
 * The consumer half of the quoter-pin contract. `quoterPin.test.ts` covers the
 * derivation and `mappers.test.ts` covers the mapper, but only in isolation —
 * neither runs the whole chain a caller actually goes through, and a pin that is
 * derived correctly and then dropped downstream is indistinguishable from one
 * that was never derived.
 *
 * So these run session scope → adaptTransaction → buildIntentRequest →
 * mapIntentRequestToWire and pin the exact bytes that leave the SDK. The
 * orchestrator counterpart, `test/integration/quoterPin.test.ts`, feeds these
 * same shapes through its real /quotes endpoint and asserts the constraint
 * reaches the quoting service — so if either side changes shape, one goes red.
 */
function wireOptionsFor(via: readonly unknown[] | undefined) {
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
          swap: {
            sell: { token: USDT0, maxTotal: 1_000_000n },
            buy: { token: USDC },
            to: ACCOUNT,
            ...(via ? { via } : {}),
          },
        } as never),
      },
    } as never,
  )

  const request = buildIntentRequest({
    transaction: intent,
    account: { address: ACCOUNT, accountType: 'ERC7579' },
    calls: [],
    sourceCalls: {},
    providedFunds: {},
  } as never)

  const wire = mapIntentRequestToWire(request) as {
    options?: { quoters?: unknown }
  }

  return wire.options?.quoters
}

describe('quoter pin survives the whole SDK chain onto the wire', () => {
  test('a 0x-scoped session puts an include filter on the wire', () => {
    // The exact literal the orchestrator integration test POSTs.
    expect(wireOptionsFor([zeroEx({ settler: SETTLER })])).toEqual({
      include: ['0x'],
    })
  })

  test('a fynd-scoped session puts fynd on the wire', () => {
    expect(wireOptionsFor([fynd()])).toEqual({ include: ['fynd'] })
  })

  test('an aggregator-agnostic session sends no filter at all', () => {
    // Not an empty filter — that means "no venue" server-side and fails closed,
    // which would break a session that in fact permits every venue.
    expect(wireOptionsFor([rhinestoneSwap()])).toBeUndefined()
  })
})
