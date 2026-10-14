import { describe, expect, it } from 'vitest'
import type {
  IntentOperationGroup,
  PreparedTransactionData,
  SignedTransactionData,
  TransactionReference,
} from '../../../src/index'
import type { TransactionStatus } from '../../../src/transactions/intents/types'
import {
  expectCompletedOperation,
  expectNoFailedOperations,
  expectNoOperationOnChain,
  formatIntentDiagnostics,
  getOperations,
} from './runner'

const txHash = `0x${'ab'.repeat(32)}` as const

function status(operations: IntentOperationGroup[]): TransactionStatus {
  return {
    traceId: 'trace',
    purpose: 'execution',
    status: 'COMPLETED',
    operations,
  }
}

const completed = status([
  {
    chainId: 'eip155:84532',
    items: [
      { type: 'CLAIM', status: 'PENDING' },
      {
        type: 'FILL',
        status: 'COMPLETED',
        transaction: { vm: 'evm', chainId: 'eip155:84532', txHash },
      },
    ],
  },
])

describe('integration operation assertions', () => {
  it('flattens every item while retaining its chain identity', () => {
    expect(getOperations(completed)).toEqual(
      completed.operations[0].items.map((item) => ({
        ...item,
        chainId: 'eip155:84532',
      })),
    )
    expect(getOperations(undefined)).toEqual([])
    expect(getOperations(status([]))).toEqual([])
  })

  it('matches numeric EVM chain expectations against CAIP-2 groups', () => {
    expect(() => expectCompletedOperation(completed, 84532)).not.toThrow()
    expect(() => expectCompletedOperation(completed, 421614)).toThrow(
      'Expected a COMPLETED operation on chain 421614',
    )
    expect(() => expectNoOperationOnChain(completed, 421614)).not.toThrow()
    expect(() => expectNoOperationOnChain(completed, 84532)).toThrow(
      'Expected no operation on chain 84532',
    )
  })

  it('still rejects missing, pending, and failed operations', () => {
    for (const items of [
      [],
      [{ type: 'FILL', status: 'PENDING' }],
      [{ type: 'FILL', status: 'FAILED' }],
    ] satisfies IntentOperationGroup['items'][]) {
      expect(() =>
        expectCompletedOperation(
          status([{ chainId: 'eip155:84532', items }]),
          84532,
        ),
      ).toThrow('Expected a COMPLETED operation')
    }
    expect(() => expectCompletedOperation(undefined, 84532)).toThrow(
      'Expected a COMPLETED operation',
    )
  })

  it('checks failures across all groups and items, including offchain execution', () => {
    const failed = status([
      ...completed.operations,
      {
        chainId: 'eip155:421614',
        items: [
          { type: 'CLAIM', status: 'COMPLETED' },
          { type: 'FILL', status: 'FAILED' },
          {
            type: 'EXECUTION',
            status: 'FAILED',
            result: { outcome: 'refused' },
          },
        ],
      },
    ])
    expect(() => expectNoFailedOperations(completed)).not.toThrow()
    expect(() => expectNoFailedOperations(failed)).toThrow(
      'Expected no failed operations, but 2 failed.',
    )
  })

  it('supports legacy numeric chain groups', () => {
    const legacy = status([
      { chainId: 84532, items: [{ type: 'FILL', status: 'COMPLETED' }] },
    ])
    expect(() => expectCompletedOperation(legacy, 84532)).not.toThrow()
    expect(() => expectNoOperationOnChain(legacy, 84532)).toThrow()
  })

  it('includes nested operation details in assertion failures', () => {
    expect(() => expectCompletedOperation(completed, 421614)).toThrow(
      `chain=eip155:84532 status=COMPLETED type=FILL tx=${txHash}`,
    )
  })

  it.each([
    { vm: 'evm', chainId: 'eip155:84532', txHash },
    { vm: 'svm', chainId: 'solana:devnet', signature: 'solana-signature' },
    { vm: 'tvm', chainId: 'tron:mainnet', txId: 'tron-transaction' },
    { vm: 'stellar', chainId: 'stellar:pubnet', txHash: 'stellar-transaction' },
    { vm: 'unknown', chainId: 999, id: 'legacy-transaction' },
  ] satisfies TransactionReference[])(
    'reports $vm transaction references in diagnostics',
    (transaction) => {
      const diagnostics = formatIntentDiagnostics({
        phase: 'success',
        durationMs: 1,
        prepared: {} as PreparedTransactionData,
        signed: {} as SignedTransactionData,
        status: status([
          {
            chainId: transaction.chainId,
            items: [{ type: 'FILL', status: 'COMPLETED', transaction }],
          },
        ]),
      })
      const id =
        'txHash' in transaction
          ? transaction.txHash
          : 'signature' in transaction
            ? transaction.signature
            : 'txId' in transaction
              ? transaction.txId
              : transaction.id
      expect(diagnostics).toContain(
        `chain=${transaction.chainId} status=COMPLETED type=FILL tx=${id}`,
      )
    },
  )
})
