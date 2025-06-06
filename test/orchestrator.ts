import { Address, zeroAddress } from 'viem'
import { vi } from 'vitest'

import type { MetaIntent, OrderPath } from '../src/orchestrator'

export function createOrchestratorMock() {
  const mockOrchestrator = {
    getPortfolio: vi.fn().mockResolvedValue([]),
    getMaxTokenAmount: vi.fn().mockResolvedValue(1000000n),
    getIntentCost: vi.fn().mockResolvedValue({
      hasFulfilledAll: true,
      tokensReceived: [
        {
          tokenAddress: '0x0000000000000000000000000000000000000000',
          targetAmount: 1000000n,
        },
      ],
    }),
    getOrderPath: (intent: MetaIntent, userAddress: Address) => {
      const tokenReceived = intent.tokenTransfers[0].tokenAddress
      const amount = intent.tokenTransfers[0].amount
      const fee = 545326691073n
      const tokenSpent = zeroAddress
      return [
        {
          orderBundle: {
            sponsor: userAddress,
            nonce:
              113668947329772826904946064438792507917844889275831879591619217965062515492663n,
            expires: BigInt(
              Math.round(Date.now() / 1000) + 1000 * 60 * 60 * 24 * 30,
            ),
            segments: [
              {
                arbiter: '0x000000000043ff16d5776c7F0f65Ec485C17Ca04',
                chainId: BigInt(intent.targetChainId),
                idsAndAmounts: [
                  [
                    21847980266613871481014731415167448634647776251198795536684055616834884337664n,
                    545326691074n,
                  ],
                ],
                witness: {
                  recipient: userAddress,
                  tokenOut: [
                    [
                      21847980266613871481014731415167448634647776251198795536684055616834884337664n,
                      1n,
                    ],
                  ],
                  depositId:
                    113668947329772826904946064438792507917844889275831879591619217965062515492663n,
                  targetChain: BigInt(intent.targetChainId),
                  fillDeadline: 1748613118,
                  execs: [],
                  userOpHash:
                    '0x0000000000000000000000000000000000000000000000000000000000000000',
                  maxFeeBps: 0,
                },
              },
            ],
            tokenPrices: [],
            gasPrices: [],
            opGasParams: {},
          },
          intentCost: {
            hasFulfilledAll: true,
            tokensReceived: [
              {
                tokenAddress: tokenReceived,
                hasFulfilled: true,
                amountSpent: amount + fee,
                targetAmount: amount,
                fee: fee,
              },
            ],
            tokensSpent: {
              '10': {
                [tokenSpent]: amount + fee,
              },
            },
          },
          injectedExecutions: [
            {
              to: '0x0000000000f6Ed8Be424d673c63eeFF8b9267420',
              value: 0n,
              data: '0x27c777a9000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000c0191c391bccb0e7c7374d9dcce61c7558261bc1abd80c9ef009c5c62ed2ac12c3000000000000000000000000000000000000000000000000000000006a1aea52304d84c3d9a7be3b28c9453100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000cbb4ac0f0457761779e8c040023e45c468a70896000000000000000000000000000000000000000000000000000000000000004148755a67fdb267e806f88086a8beb41d3993728b6c4c31404702d1b34eca46ce704ea2cb3bad07110a87a7ad6751f9e1bdb0904ae2d61a72ab4ac91a03d79a911b00000000000000000000000000000000000000000000000000000000000000',
            },
          ],
        },
      ] as OrderPath
    },
    postSignedOrderBundle: vi.fn().mockResolvedValue([
      {
        bundleId: 1n,
      },
    ]),
    getBundleStatus: vi.fn().mockResolvedValue({
      status: 'COMPLETED',
    }),
    getPendingBundles: vi.fn().mockResolvedValue({
      pendingBundles: [],
      nextOffset: undefined,
    }),
  }

  return mockOrchestrator
}

// Setup the mock for the orchestrator module
export function setupOrchestratorMock() {
  vi.mock('../src/orchestrator', async (importOriginal) => {
    const actual = await importOriginal()

    return {
      // @ts-ignore
      ...actual,
      getOrchestrator: vi.fn().mockReturnValue(createOrchestratorMock()),
    }
  })
}
