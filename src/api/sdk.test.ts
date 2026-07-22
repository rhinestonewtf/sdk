import { mainnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { OwnersFieldRequiredError } from '../accounts/error'
import {
  RhinestoneSDK,
  toOrchestratorSplitRequest,
  toPublicSplitResult,
  toPublicTransactionStatus,
} from './sdk'

const address = '0x0000000000000000000000000000000000000001' as const

describe('SDK project boundary adapters', () => {
  test('rejects missing owners asynchronously during account creation', async () => {
    const result = new RhinestoneSDK({ apiKey: 'offline' }).createAccount({
      account: { type: 'safe' },
    })

    expect(result).toBeInstanceOf(Promise)
    await expect(result).rejects.toThrowError(OwnersFieldRequiredError)
  })

  test('maps internal intent status to the public accountAddress shape', () => {
    expect(
      toPublicTransactionStatus({
        traceId: 'trace-status',
        intentId: 'intent-1',
        status: 'COMPLETED',
        account: address,
        operations: [
          { chain: 1, status: 'COMPLETED', txHash: '0x12', timestamp: 1 },
        ],
        terminal: true,
      }),
    ).toEqual({
      traceId: 'trace-status',
      status: 'COMPLETED',
      accountAddress: address,
      operations: [
        { chain: 1, status: 'COMPLETED', txHash: '0x12', timestamp: 1 },
      ],
    })
  })

  test('maps public split chains and returns mutable public results', () => {
    expect(
      toOrchestratorSplitRequest({
        chain: mainnet,
        tokens: { [address]: 2n },
        settlementLayers: { include: ['RELAY'] },
      }),
    ).toEqual({
      chainId: 1,
      tokens: { [address]: 2n },
      settlementLayers: { include: ['RELAY'] },
    })

    const result = toPublicSplitResult({
      traceId: 'trace-split',
      intents: [{ [address]: 2n }],
    })
    expect(result).toEqual({
      traceId: 'trace-split',
      intents: [{ [address]: 2n }],
    })
  })
})
