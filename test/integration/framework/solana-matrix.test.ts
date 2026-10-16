import { Keypair } from '@solana/web3.js'
import { decodeFunctionData, erc20Abi } from 'viem'
import { baseSepolia } from 'viem/chains'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { solanaDevnet } from '../../../src/solana/index'
import {
  BASE_SEPOLIA_USDC,
  SOLANA_AMOUNTS,
  solTransferInstruction,
  usdcTransferInstruction,
  waitForTerminalIntent,
} from './solana'
import {
  assertGasSponsorship,
  assertUserDebit,
  DEVNET_MINT,
  matrixTransaction,
  NATIVE_SOL,
  SOLANA_MATRIX,
  SolanaSuiteSafety,
} from './solana-matrix'

const wallet = Keypair.generate().publicKey
const recipient = Keypair.generate().publicKey
const evmRecipient = '0x1234567890123456789012345678901234567890'
afterEach(() => vi.useRealTimers())

describe('Solana acceptance matrix', () => {
  it('contains exactly twelve unique cells, one of each sponsorship per required row', () => {
    const expectedRows = [
      'SC-D',
      'SC-I-USDC',
      'SC-I-SOL',
      'IN-D',
      'OUT-D',
      'OUT-C',
    ]
    expect(SOLANA_MATRIX).toHaveLength(12)
    expect(new Set(SOLANA_MATRIX.map((cell) => cell.id)).size).toBe(12)
    expect([...new Set(SOLANA_MATRIX.map((cell) => cell.row))]).toEqual(
      expectedRows,
    )
    for (const row of expectedRows) {
      expect(
        SOLANA_MATRIX.filter((cell) => cell.row === row).map(
          (cell) => cell.gasSponsored,
        ),
      ).toEqual([false, true])
    }
  })

  for (const cell of SOLANA_MATRIX) {
    it(`${cell.id} uses the exact public shape without uncapped deliveries`, () => {
      const transaction = matrixTransaction(
        cell,
        wallet,
        recipient,
        evmRecipient,
      )
      expect(transaction.sponsored).toEqual(
        cell.gasSponsored
          ? { gas: true, bridging: false, swaps: false }
          : false,
      )
      const destination = transaction.destination
      if ('instructions' in destination && destination.instructions) {
        expect(destination.chain).toBe(solanaDevnet)
        expect(destination.instructions).toHaveLength(1)
        expect(transaction.source).toEqual(
          cell.gasSponsored
            ? undefined
            : { token: cell.row === 'SC-I-SOL' ? NATIVE_SOL : DEVNET_MINT },
        )
        expect(destination).not.toHaveProperty('token')
        expect(destination).not.toHaveProperty('recipient')
        expect(destination.instructions[0]).toEqual(
          cell.row === 'SC-I-SOL'
            ? solTransferInstruction(
                wallet,
                recipient,
                SOLANA_AMOUNTS.solTransfer,
              )
            : usdcTransferInstruction(
                wallet,
                recipient,
                SOLANA_AMOUNTS.sameChainUsdc,
              ),
        )
      } else {
        expect(transaction.source).toMatchObject({
          maxAmount: SOLANA_AMOUNTS.deliveryCap,
        })
        if (cell.row === 'IN-D') {
          expect(transaction.source).toMatchObject({
            chain: baseSepolia,
            token: BASE_SEPOLIA_USDC,
          })
          expect(destination).toMatchObject({
            chain: solanaDevnet,
            token: DEVNET_MINT,
            amount: SOLANA_AMOUNTS.crossChainUsdc,
            recipient: recipient.toBase58(),
          })
        } else if (cell.row === 'SC-D') {
          expect(destination).toMatchObject({
            chain: solanaDevnet,
            token: DEVNET_MINT,
            amount: SOLANA_AMOUNTS.sameChainUsdc,
            recipient: recipient.toBase58(),
          })
        } else {
          expect(destination).toMatchObject({
            chain: baseSepolia,
            token: BASE_SEPOLIA_USDC,
            amount: SOLANA_AMOUNTS.crossChainUsdc,
          })
          if (cell.row === 'OUT-C') {
            expect(destination).not.toHaveProperty('recipient')
            if (!('calls' in destination) || !destination.calls)
              throw new Error('Missing destination calls')
            expect(destination.calls).toHaveLength(1)
            const call = destination.calls[0]
            if (!('data' in call) || !call.data)
              throw new Error('Missing ERC20 transfer data')
            expect(call.to).toBe(BASE_SEPOLIA_USDC)
            expect(
              decodeFunctionData({ abi: erc20Abi, data: call.data }),
            ).toEqual({
              functionName: 'transfer',
              args: [evmRecipient, SOLANA_AMOUNTS.destinationCallUsdc],
            })
          } else expect(destination).toHaveProperty('recipient', evmRecipient)
        }
      }
    })
  }
})

describe('gas sponsorship validation', () => {
  it.each([0, 0.01])('requires gas coverage at quoted gas cost %s', (usd) => {
    const fees = {
      total: { usd },
      breakdown: {
        gas: { usd, sponsored: false },
        bridge: { usd: 0, sponsored: true },
        swap: { usd: 0, sponsored: true },
        app: { usd: 0, sponsored: true },
        protocol: { usd: 0, sponsored: true },
        sponsorSurcharge: { usd: 0, sponsored: false },
      },
    }
    for (const cell of SOLANA_MATRIX) {
      if (cell.gasSponsored)
        expect(() => assertGasSponsorship(cell, fees)).toThrow(
          'must sponsor gas',
        )
      else expect(() => assertGasSponsorship(cell, fees)).not.toThrow()
      fees.breakdown.gas.sponsored = true
      expect(() => assertGasSponsorship(cell, fees)).not.toThrow()
      fees.breakdown.gas.sponsored = false
    }
  })
})

describe('fail-closed suite safety', () => {
  it('records pending execution failure before the test deadline and blocks the next cell', async () => {
    vi.useFakeTimers()
    const safety = new SolanaSuiteSafety()
    const pending = {
      status: 'PENDING',
      purpose: 'execution',
      operations: [],
    } as const
    const sdk = { getIntentStatus: vi.fn().mockResolvedValue(pending) }
    const record = vi.fn(async (_entry: unknown) => {})
    const nextWrite = vi.fn()
    const run = safety.guard(
      'SC-D-gas-only',
      async () => {
        await record({
          stage: 'settlement',
          intentId: 'execution-id',
          traceId: 'trace-id',
        })
        await waitForTerminalIntent(sdk, 'execution-id', 'execution', {
          timeoutMs: 60_000,
        })
        nextWrite()
      },
      async (error) => {
        expect(() => safety.assertActive()).toThrow()
        await record({
          stage: 'settlement',
          errorCode: error instanceof Error ? error.name : 'UNKNOWN',
        })
      },
    )
    const rejected = expect(run).rejects.toThrow('visibility timeout')
    await vi.advanceTimersByTimeAsync(60_000)
    await rejected
    expect(record.mock.calls.map(([entry]) => entry)).toEqual([
      { stage: 'settlement', intentId: 'execution-id', traceId: 'trace-id' },
      { stage: 'settlement', errorCode: 'Error' },
    ])
    expect(nextWrite).not.toHaveBeenCalled()
    await expect(
      safety.guard(
        'next',
        async () => {
          nextWrite()
        },
        record,
      ),
    ).rejects.toThrow('SC-D-gas-only')
    expect(nextWrite).not.toHaveBeenCalled()
    const reads = sdk.getIntentStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(300_000)
    expect(sdk.getIntentStatus).toHaveBeenCalledTimes(reads)
  })
  it('allows sequential confirmed cells only', () => {
    const safety = new SolanaSuiteSafety()
    safety.begin()
    expect(() => safety.begin()).toThrow(/unresolved/)
    safety.assertActive()
    safety.complete()
    safety.begin()
    safety.complete()
  })
  it('blocks all subsequent work after even a prepare/assertion failure', () => {
    const safety = new SolanaSuiteSafety()
    safety.begin()
    safety.halt('SC-D-unsponsored')
    expect(() => safety.assertActive()).toThrow()
    expect(() => safety.complete()).toThrow()
    expect(() => safety.begin()).toThrow(/SC-D-unsponsored/)
  })
  it('blocks late writes and the next cell after a timed-out test', () => {
    vi.useFakeTimers()
    const safety = new SolanaSuiteSafety()
    safety.begin()
    vi.advanceTimersByTime(240_000)
    expect(() => safety.assertActive()).toThrow(/deadline/)
    expect(() => safety.complete()).toThrow()
    expect(() => safety.begin()).toThrow(/unresolved/)
  })
})

describe('quoted user fee reconciliation', () => {
  it('does not require unsponsored plain transfers to spend wallet SOL', () => {
    expect(() => assertUserDebit(100_000n, 100_000n, 0n)).not.toThrow()
    expect(() => assertUserDebit(10_200n, 10_000n, 200n)).not.toThrow()
  })
  it.each([
    [9_999n, 10_000n, 0n],
    [10_201n, 10_000n, 200n],
    [10_000n, 10_000n, -1n],
  ])(
    'refuses unquoted debit or missing transfer (%s)',
    (actual, transfer, net) => {
      expect(() => assertUserDebit(actual, transfer, net)).toThrow(/reconcile/)
    },
  )
})
