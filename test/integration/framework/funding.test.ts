import { baseSepolia } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import type { RhinestoneAccount } from '../../../src/index'
import { waitForOrchestratorNative } from './funding'

describe('integration funding visibility', () => {
  test('waits for the chain native token in the testnet portfolio', async () => {
    const account = {
      getAddress: () => '0x0000000000000000000000000000000000000001',
      getPortfolio: vi.fn(async () => [
        {
          symbol: baseSepolia.nativeCurrency.symbol,
          chains: [
            {
              chain: baseSepolia.id,
              address: '0x0000000000000000000000000000000000000000',
              decimals: baseSepolia.nativeCurrency.decimals,
              amount: 100n,
            },
          ],
        },
      ]),
    } as unknown as RhinestoneAccount

    await waitForOrchestratorNative(account, baseSepolia, 100n)

    expect(account.getPortfolio).toHaveBeenCalledWith(true)
  })
})
