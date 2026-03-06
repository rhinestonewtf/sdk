import type { IntentOp } from '../../../orchestrator/types'

// Minimal signedMetadata stub
const signedMetadata: IntentOp['signedMetadata'] = {
  fees: null,
  quotes: {},
  tokenPrices: { ETH: 2500, USDC: 1 },
  opGasParams: { estimatedCalldataSize: 1000 } as any,
  gasPrices: { '8453': '5000000' },
  account: {
    address: '0x7a07d9cc408dd92165900c302d31d914d26b3827' as const,
    accountType: 'ERC7579' as const,
    setupOps: [],
    accountContext: {},
  },
}

/**
 * Compact intent: fundingMethod = COMPACT, settlementLayer = SAME_CHAIN
 * Should produce MultichainCompact typed data.
 */
export const compactIntent: IntentOp = {
  sponsor: '0x7a07d9cc408dd92165900c302d31d914d26b3827',
  nonce: '12345',
  targetExecutionNonce: '0',
  expires: '1700000000',
  elements: [
    {
      arbiter: '0x306ba68E347D83E6171389E80E0B7Be978a5303A',
      chainId: '8453',
      // Token ID: 0x000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913
      // lockTag (first 12 bytes): 0x000000000000000000000000
      // token (last 20 bytes): 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
      idsAndAmounts: [
        ['749071750893463290574776461331093852760741783827', '1000000'],
      ] as [[string, string]],
      spendTokens: [
        ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '1000000'],
      ] as [[string, string]],
      beforeFill: false,
      mandate: {
        recipient: '0x7a07d9cc408dd92165900c302d31d914d26b3827',
        tokenOut: [
          ['749071750893463290574776461331093852760741783827', '500000'],
        ] as [[string, string]],
        destinationChainId: '8453',
        fillDeadline: '1700001000',
        destinationOps: {
          vt: '0x0000000000000000000000000000000000000000000000000000000000000000',
          ops: [],
        },
        preClaimOps: {
          vt: '0x0000000000000000000000000000000000000000000000000000000000000000',
          ops: [],
        },
        qualifier: {
          settlementContext: {
            settlementLayer: 'SAME_CHAIN' as any,
            fundingMethod: 'COMPACT' as any,
            using7579: false,
          },
          encodedVal: '0xdeadbeef',
        },
        minGas: '21000',
      },
    },
  ],
  serverSignature: '0x',
  signedMetadata,
}

/**
 * Permit2 intent: fundingMethod = PERMIT2, settlementLayer = ACROSS
 * Should produce PermitBatchWitnessTransferFrom typed data.
 */
export const permit2Intent: IntentOp = {
  sponsor: '0x7a07d9cc408dd92165900c302d31d914d26b3827',
  nonce: '99999',
  targetExecutionNonce: '0',
  expires: '1700000000',
  elements: [
    {
      arbiter: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      chainId: '1',
      idsAndAmounts: [
        ['749071750893463290574776461331093852760741783827', '2000000'],
      ] as [[string, string]],
      spendTokens: [
        ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '2000000'],
      ] as [[string, string]],
      beforeFill: false,
      mandate: {
        recipient: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        tokenOut: [
          ['749071750893463290574776461331093852760741783827', '1000000'],
        ] as [[string, string]],
        destinationChainId: '8453',
        fillDeadline: '1700001000',
        destinationOps: {
          vt: '0x0000000000000000000000000000000000000000000000000000000000000000',
          ops: [],
        },
        preClaimOps: {
          vt: '0x0000000000000000000000000000000000000000000000000000000000000000',
          ops: [],
        },
        qualifier: {
          settlementContext: {
            settlementLayer: 'ACROSS' as any,
            fundingMethod: 'PERMIT2' as any,
            using7579: false,
          },
          encodedVal: '0x',
        },
        minGas: '100000',
      },
    },
  ],
  serverSignature: '0x',
  signedMetadata,
}

/**
 * SingleChainOps intent: settlementLayer = INTENT_EXECUTOR
 * Should produce SingleChainOps typed data with gasRefund.
 */
export const singleChainIntent: IntentOp = {
  sponsor: '0x7a07d9cc408dd92165900c302d31d914d26b3827',
  nonce: '55555',
  targetExecutionNonce: '55556',
  expires: '1700000000',
  elements: [
    {
      arbiter: '0xcccccccccccccccccccccccccccccccccccccccc',
      chainId: '8453',
      idsAndAmounts: [
        ['749071750893463290574776461331093852760741783827', '3000000'],
      ] as [[string, string]],
      spendTokens: [
        ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '3000000'],
      ] as [[string, string]],
      beforeFill: true,
      mandate: {
        recipient: '0x7a07d9cc408dd92165900c302d31d914d26b3827',
        tokenOut: [
          ['749071750893463290574776461331093852760741783827', '2500000'],
        ] as [[string, string]],
        destinationChainId: '8453',
        fillDeadline: '1700001000',
        destinationOps: {
          vt: '0x0203000000000000000000000000000000000000000000000000000000000000',
          ops: [
            {
              to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
              value: BigInt(3),
              data: '0x',
            },
          ],
        },
        preClaimOps: {
          vt: '0x0000000000000000000000000000000000000000000000000000000000000000',
          ops: [],
        },
        qualifier: {
          settlementContext: {
            settlementLayer: 'INTENT_EXECUTOR' as any,
            fundingMethod: 'NO_FUNDING' as any,
            using7579: false,
            gasRefund: {
              token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
              exchangeRate: BigInt('1000000000000000000'),
              overhead: BigInt('50000'),
            },
          },
          encodedVal: '0xabcdef',
        },
        minGas: '500000',
      },
    },
  ],
  serverSignature: '0x',
  signedMetadata,
}
