import type { PublicKey } from '@solana/web3.js'
import { type Address, encodeFunctionData, erc20Abi } from 'viem'
import { baseSepolia } from 'viem/chains'
import type { Transaction } from '../../../src/index'
import { solanaAddress, solanaDevnet } from '../../../src/solana/index'
import {
  BASE_SEPOLIA_USDC,
  DEVNET_USDC,
  SOLANA_AMOUNTS,
  solTransferInstruction,
  usdcTransferInstruction,
} from './solana'

export const SOLANA_ROWS = [
  'SC-D',
  'SC-I-USDC',
  'SC-I-SOL',
  'IN-D',
  'OUT-D',
  'OUT-C',
] as const
export type SolanaRow = (typeof SOLANA_ROWS)[number]
export const SOLANA_MATRIX = SOLANA_ROWS.flatMap((row) =>
  [false, true].map((gasSponsored) => ({
    row,
    gasSponsored,
    id: `${row}-${gasSponsored ? 'gas-only' : 'unsponsored'}`,
  })),
)
export type SolanaCell = (typeof SOLANA_MATRIX)[number]
export const NATIVE_SOL = solanaAddress('11111111111111111111111111111111')
export const DEVNET_MINT = solanaAddress(DEVNET_USDC.toBase58())

export function matrixTransaction(
  cell: SolanaCell,
  wallet: PublicKey,
  recipient: PublicKey,
  evmRecipient: Address,
): Transaction {
  const sponsored = cell.gasSponsored
    ? { gas: true, bridging: false, swaps: false }
    : false
  const source = {
    chain: solanaDevnet,
    token: DEVNET_MINT,
    maxAmount: SOLANA_AMOUNTS.deliveryCap,
  }
  switch (cell.row) {
    case 'SC-D':
      return {
        source,
        destination: {
          chain: solanaDevnet,
          token: DEVNET_MINT,
          amount: SOLANA_AMOUNTS.sameChainUsdc,
          recipient: solanaAddress(recipient.toBase58()),
        },
        sponsored,
      }
    case 'SC-I-USDC':
    case 'SC-I-SOL': {
      const native = cell.row === 'SC-I-SOL'
      return {
        ...(cell.gasSponsored
          ? {}
          : { source: { token: native ? NATIVE_SOL : DEVNET_MINT } }),
        destination: {
          chain: solanaDevnet,
          instructions: [
            native
              ? solTransferInstruction(wallet, recipient)
              : usdcTransferInstruction(wallet, recipient),
          ],
        },
        sponsored,
      }
    }
    case 'IN-D':
      return {
        source: {
          chain: baseSepolia,
          token: BASE_SEPOLIA_USDC,
          maxAmount: SOLANA_AMOUNTS.deliveryCap,
        },
        destination: {
          chain: solanaDevnet,
          token: DEVNET_MINT,
          amount: SOLANA_AMOUNTS.crossChainUsdc,
          recipient: solanaAddress(recipient.toBase58()),
        },
        sponsored,
      }
    case 'OUT-D':
      return {
        source,
        destination: {
          chain: baseSepolia,
          token: BASE_SEPOLIA_USDC,
          amount: SOLANA_AMOUNTS.crossChainUsdc,
          recipient: evmRecipient,
        },
        sponsored,
      }
    case 'OUT-C':
      return {
        source,
        destination: {
          chain: baseSepolia,
          token: BASE_SEPOLIA_USDC,
          amount: SOLANA_AMOUNTS.crossChainUsdc,
          calls: [
            {
              to: BASE_SEPOLIA_USDC,
              value: 0n,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transfer',
                args: [evmRecipient, SOLANA_AMOUNTS.destinationCallUsdc],
              }),
            },
          ],
        },
        sponsored,
      }
  }
}

// A failure is not a skip: subsequent tests fail before another write is attempted.
export class SolanaSuiteSafety {
  private failure: string | undefined
  private deadline: number | undefined
  assertReady() {
    if (this.failure || this.deadline !== undefined)
      throw new Error(
        `Suite halted after ${this.failure ?? 'unresolved test'}; reconcile existing intent and receipts before another run`,
      )
  }
  begin() {
    this.assertReady()
    this.deadline = Date.now() + 240_000
  }
  assertActive() {
    if (
      this.failure ||
      this.deadline === undefined ||
      Date.now() >= this.deadline
    )
      throw new Error(
        'Suite write deadline expired or previous outcome unresolved',
      )
  }
  complete() {
    this.assertActive()
    this.deadline = undefined
  }
  halt(caseId: string) {
    this.failure ??= caseId
  }
}

export function assertUserDebit(
  actual: bigint,
  transfer: bigint,
  quotedNet: bigint,
) {
  if (quotedNet < 0n || actual < transfer || actual > transfer + quotedNet)
    throw new Error(
      'User debit does not reconcile with transfer and quoted costs',
    )
}
