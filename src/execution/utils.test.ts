import { zeroAddress } from 'viem'
import { arbitrum, base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../../test/consts'
import type { IntentInput } from '../orchestrator/types'
import { prepareTransactionAsIntent } from './utils'

const mockGetIntentRoute = vi.fn()

vi.mock('../orchestrator', () => ({
  getOrchestrator: () => ({
    getIntentRoute: mockGetIntentRoute,
  }),
}))

describe('prepareTransactionAsIntent', () => {
  beforeEach(() => {
    mockGetIntentRoute.mockReset()
  })

  test('includes auxiliaryFunds in options when provided', async () => {
    const auxiliaryFunds = {
      [arbitrum.id]: {
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': 500000000n,
      } as Record<`0x${string}`, bigint>,
    }

    mockGetIntentRoute.mockResolvedValue({
      intentOp: {},
      intentCost: {},
    })

    await prepareTransactionAsIntent(
      {
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        apiKey: 'test',
      },
      [arbitrum],
      base,
      [],
      undefined,
      [{ address: zeroAddress, amount: 1n }],
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      auxiliaryFunds,
      undefined,
      undefined,
    )

    expect(mockGetIntentRoute).toHaveBeenCalledOnce()
    const intentInput: IntentInput = mockGetIntentRoute.mock.calls[0][0]
    expect(intentInput.options.auxiliaryFunds).toEqual(auxiliaryFunds)
  })

  test('does not include auxiliaryFunds in options when not provided', async () => {
    mockGetIntentRoute.mockResolvedValue({
      intentOp: {},
      intentCost: {},
    })

    await prepareTransactionAsIntent(
      {
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        apiKey: 'test',
      },
      [arbitrum],
      base,
      [],
      undefined,
      [{ address: zeroAddress, amount: 1n }],
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    )

    expect(mockGetIntentRoute).toHaveBeenCalledOnce()
    const intentInput: IntentInput = mockGetIntentRoute.mock.calls[0][0]
    expect(intentInput.options.auxiliaryFunds).toBeUndefined()
  })
})
