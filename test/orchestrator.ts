import type { TypedDataDefinition } from 'viem'
import { vi } from 'vitest'

const SAME_CHAIN_QUOTE_TYPED_DATA: TypedDataDefinition = {
  domain: {
    name: 'RhinestoneIntent',
    version: '1',
    chainId: 8453,
    verifyingContract: '0x0000000000000000000000000000000000000001',
  },
  types: {
    Intent: [
      { name: 'sponsor', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'expiresAt', type: 'uint256' },
    ],
  },
  primaryType: 'Intent',
  message: {
    sponsor: '0x0000000000000000000000000000000000000000',
    nonce: '0',
    expiresAt: '9999999999',
  },
}

export function createOrchestratorMock() {
  return {
    getPortfolio: vi.fn().mockResolvedValue([]),
    createQuote: vi.fn().mockResolvedValue({
      routes: [
        {
          intentId: 'mock-intent-id',
          expiresAt: 9999999999,
          estimatedFillTime: { seconds: 5 },
          settlementLayer: 'SAME_CHAIN',
          signData: {
            origin: [SAME_CHAIN_QUOTE_TYPED_DATA],
            destination: SAME_CHAIN_QUOTE_TYPED_DATA,
          },
          cost: {
            input: [],
            output: [],
            fees: {
              total: { usd: 0 },
              breakdown: {
                gas: { usd: 0 },
                bridge: { usd: 0 },
                protocol: { usd: 0 },
                swap: { usd: 0 },
                settlement: { usd: 0 },
              },
            },
          },
        },
      ],
    }),
    getSplit: vi.fn().mockResolvedValue({ intents: [] }),
    createIntent: vi.fn().mockResolvedValue({ intentId: 'mock-intent-id' }),
    getIntent: vi.fn().mockResolvedValue({
      status: 'COMPLETED',
      claims: [
        {
          depositId: 0n,
          chainId: 8453,
          status: 'CLAIMED',
          claimTransactionHash:
            '0x7b9d7ae83a09c7e6d37472f43112600fd3c7a1eb78f9a0788cf53366dda31d58',
          claimTimestamp: 1751907747,
        },
      ],
      destinationChainId: 8453,
      accountAddress: '0x7a07d9cc408dd92165900c302d31d914d26b3827',
      fillTimestamp: 1751907747,
      fillTransactionHash:
        '0x7b9d7ae83a09c7e6d37472f43112600fd3c7a1eb78f9a0788cf53366dda31d58',
    }),
  }
}

export function setupOrchestratorMock() {
  vi.mock('../src/orchestrator', async (importOriginal) => {
    const actual = await importOriginal()

    return {
      // @ts-expect-error
      ...actual,
      getOrchestrator: vi.fn().mockReturnValue(createOrchestratorMock()),
    }
  })
}
