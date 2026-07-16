import type { Address, Hex } from 'viem'
import type { EvmChainReference } from '../../chains/types'

export interface BundlerUserOperation {
  readonly sender: Address
  readonly nonce: bigint
  readonly callData: Hex
  readonly signature: Hex
  readonly fields: Readonly<Record<string, unknown>>
}

export interface BundlerReceipt {
  readonly userOperationHash: Hex
  readonly success: boolean
  readonly receipt: unknown
}

export interface BundlerPort {
  readonly send: (
    chain: EvmChainReference,
    operation: BundlerUserOperation,
  ) => Promise<Hex>
  readonly getReceipt: (
    chain: EvmChainReference,
    userOperationHash: Hex,
  ) => Promise<BundlerReceipt | undefined>
}
