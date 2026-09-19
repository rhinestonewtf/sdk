import { mainnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import type { IntentStatus } from '../transactions/intents/types'
import {
  toOrchestratorSplitRequest,
  toPublicSplitResult,
  toPublicTransactionStatus,
} from './project-mappers'

const address = '0x0000000000000000000000000000000000000001' as const
const BASE = 'eip155:8453'

const base = {
  traceId: 'trace-status',
  intentId: 'intent-1',
  purpose: 'execution',
  status: 'COMPLETED',
  operations: [],
  terminal: true,
} as const satisfies IntentStatus

describe('SDK project boundary adapters', () => {
  test('carries grouped operations and native accounts onto the public shape', () => {
    const status = toPublicTransactionStatus({
      ...base,
      accounts: [
        { vm: 'evm', chainId: BASE, account: { address, type: 'erc7579' } },
      ],
      operations: [
        {
          chainId: BASE,
          items: [
            {
              type: 'CLAIM',
              status: 'COMPLETED',
              transaction: { vm: 'evm', chainId: BASE, txHash: '0x12' },
              timestamp: 1,
            },
          ],
        },
      ],
    })

    expect(status.purpose).toBe('execution')
    expect(status.accounts).toHaveLength(1)
    expect(status.operations[0]?.items[0]).toMatchObject({ type: 'CLAIM' })
  })

  test('omits accounts when the record does not identify them', () => {
    expect('accounts' in toPublicTransactionStatus(base)).toBe(false)
  })

  test('carries a bridge refund onto the public shape, and omits it when absent', () => {
    const refund = {
      transaction: {
        vm: 'evm',
        chainId: BASE,
        txHash:
          '0x8e483d74ff15e79f86e0c23e81444a5db5b2ce31c9ec28f84259dfc83f0bbc28',
      },
    } as const

    expect(
      toPublicTransactionStatus({
        ...base,
        status: 'FAILED',
        refunds: [refund],
      }).refunds,
    ).toEqual([refund])
    // Absent, not `[]`: the orchestrator omits the key when the record does not
    // speak to refunds, and that is not the same fact as "there was none".
    expect('refunds' in toPublicTransactionStatus(base)).toBe(false)
  })

  test('carries recorded details only when they were requested', () => {
    const details = {
      nonce: '1',
      createdAt: 1,
      latencyMs: 2,
      settlementLayer: 'SAME_CHAIN',
      source: [],
      destination: {
        chainId: BASE,
        tokens: [],
        status: 'COMPLETED',
      },
      cost: { sponsored: false },
    } as unknown as NonNullable<IntentStatus['details']>

    expect(toPublicTransactionStatus({ ...base, details }).details).toEqual(
      details,
    )
    expect('details' in toPublicTransactionStatus(base)).toBe(false)
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
