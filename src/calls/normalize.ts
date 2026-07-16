import { getAddress, isAddress } from 'viem'
import type { Call } from './types'

export interface CallInput {
  readonly target: string
  readonly value?: bigint
  readonly data?: `0x${string}`
}

export function normalizeCall(input: CallInput): Call {
  if (!isAddress(input.target)) {
    throw new Error(`Invalid call target: ${input.target}`)
  }
  if (input.value !== undefined && input.value < 0n) {
    throw new Error('Call value cannot be negative')
  }
  return {
    target: getAddress(input.target),
    value: input.value ?? 0n,
    data: input.data ?? '0x',
  }
}

export function normalizeCalls(inputs: readonly CallInput[]): readonly Call[] {
  return inputs.map(normalizeCall)
}
