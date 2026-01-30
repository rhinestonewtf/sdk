import { zeroHash } from 'viem'
import { vi } from 'vitest'

export function createOrchestratorMock() {
  const mockOrchestrator = {
    getPortfolio: vi.fn().mockResolvedValue([]),
    getMaxTokenAmount: vi.fn().mockResolvedValue(1000000n),
    getIntentCost: vi.fn().mockResolvedValue({
      hasFulfilledAll: true,
      tokensReceived: [
        {
          tokenAddress: '0x0000000000000000000000000000000000000000',
          hasFulfilled: true,
          amountSpent: '94399862304431',
          destinationAmount: '87263036938424',
          fee: '7136825366007',
        },
      ],
      tokensSpent: {
        '8453': {
          '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': {
            locked: '240003',
            unlocked: '0',
          },
        },
      },
    }),
    getIntentRoute: vi.fn().mockResolvedValue({
      intentOp: {
        sponsor: '0x7a07d9cc408dd92165900c302d31d914d26b3827',
        nonce:
          '5155984005891081751907744166694346796440695583636245585396069902646285172736',
        targetExecutionNonce:
          '5155984005891081751907744166694346796440695583636245585396069902646285172737',
        expires: '1783443744',
        elements: [
          {
            smartAccountStatus: 'ERC7579',
            arbiter: '0x306ba68E347D83E6171389E80E0B7Be978a5303A',
            chainId: '8453',
            idsAndAmounts: [
              [
                '21854126412662723981022530371960153272591467524068739237857809954054699231507',
                '4296',
              ],
            ],
            beforeFill: true,
            mandate: {
              recipient: '0x7a07d9cc408dd92165900c302d31d914d26b3827',
              tokenOut: [
                [
                  '21854126412662723981022530371211081521698004233493962776526716101293957447680',
                  '3',
                ],
              ],
              destinationChainId: '8453',
              fillDeadline: '1751908044',
              destinationOps: {
                vt: '0x0203000000000000000000000000000000000000000000000000000000000000',
                ops: [
                  {
                    to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
                    value: '3',
                    data: '0x',
                  },
                ],
              },
              minGas: 1000000000000000000n,
              preClaimOps: { vt: zeroHash, ops: [] },
              qualifier: {
                settlementContext: {
                  settlementLayer: 'SAME_CHAIN',
                  fundingMethod: 'COMPACT',
                  using7579: false,
                },
                encodedVal: '0x',
              },
            },
          },
        ],
        serverSignature:
          'd48ef04a5c0a0e2df550dfb0f6217b0fac3290f6466be85a9661090d8c5ac566',
        signedMetadata: {
          quotes: {},
          tokenPrices: {
            ETH: 2524.2183513701,
            USDC: 0.9998442693,
            POL: 0.1839796602,
            WETH: 2524.2183513701,
          },
          opGasParams: {
            '8453': {
              l1BaseFee: '3061762750',
              l1BlobBaseFee: '1',
              baseFeeScalar: '2269',
              blobFeeScalar: '1055762',
            },
            estimatedCalldataSize: 1670,
          },
          gasPrices: {
            '8453': '5804299',
          },
          smartAccount: {
            accountType: 'ERC7579',
          },
        },
      },
      intentCost: {
        hasFulfilledAll: true,
        tokensReceived: [
          {
            tokenAddress: '0x0000000000000000000000000000000000000000',
            hasFulfilled: true,
            amountSpent: '1689878675566',
            destinationAmount: '3',
            fee: '1689878675563',
          },
        ],
        tokensSpent: {
          '8453': {
            '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': {
              locked: '4296',
              unlocked: '0',
            },
          },
        },
      },
    }),
    submitIntent: vi.fn().mockResolvedValue({
      result: {
        id: '5155984005891081751907744166694346796440695583636245585396069902646285172736',
        status: 'PENDING',
      },
    }),
    getIntentOpStatus: vi.fn().mockResolvedValue({
      status: 'COMPLETED',
      claims: [
        {
          chainId: 8453,
          status: 'CLAIMED',
          claimTransactionHash:
            '0x7b9d7ae83a09c7e6d37472f43112600fd3c7a1eb78f9a0788cf53366dda31d58',
          claimTimestamp: 1751907747,
        },
      ],
      fillTimestamp: 1751907747,
      fillTransactionHash:
        '0x7b9d7ae83a09c7e6d37472f43112600fd3c7a1eb78f9a0788cf53366dda31d58',
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
