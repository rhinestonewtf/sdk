import { mainnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import {
  toOrchestratorSplitRequest,
  toPublicSplitResult,
  toPublicTransactionStatus,
} from './project-mappers'

const address = '0x0000000000000000000000000000000000000001' as const

describe('SDK project boundary adapters', () => {
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

  test('carries a bridge refund onto the public shape, and omits it when absent', () => {
    const failed = {
      traceId: 'trace-status',
      intentId: 'intent-1',
      status: 'FAILED',
      account: address,
      operations: [],
      terminal: true,
    } as const
    const refund = {
      chain: 8453,
      txHash:
        '0x8e483d74ff15e79f86e0c23e81444a5db5b2ce31c9ec28f84259dfc83f0bbc28',
    }

    expect(
      toPublicTransactionStatus({ ...failed, refunds: [refund] }).refunds,
    ).toEqual([refund])
    // Absent, not `[]`: the orchestrator omits the key when it knows of no
    // refund, and that is not the same fact as "there was none".
    expect('refunds' in toPublicTransactionStatus(failed)).toBe(false)
  })

  test('maps public split requests with and without settlement filters', () => {
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

    expect(
      toOrchestratorSplitRequest({
        chain: mainnet,
        tokens: { [address]: 2n },
      }),
    ).toEqual({ chainId: 1, tokens: { [address]: 2n } })
  })

  test('returns mutable public split results', () => {
    const internalIntent = { [address]: 2n }
    const result = toPublicSplitResult({
      traceId: 'trace-split',
      intents: [internalIntent],
    })

    expect(result).toEqual({
      traceId: 'trace-split',
      intents: [{ [address]: 2n }],
    })
    expect(result.intents[0]).not.toBe(internalIntent)
  })
})
