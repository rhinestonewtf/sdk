import type { Hex } from 'viem'
import type {
  UserOperation,
  UserOperationReceipt,
} from 'viem/account-abstraction'
import type { EvmChainReference } from '../../chains/types'

export type BundlerUserOperation = UserOperation<'0.7'>

export interface BundlerGasEstimate {
  readonly callGasLimit: bigint
  readonly verificationGasLimit: bigint
  readonly preVerificationGas: bigint
  readonly paymasterVerificationGasLimit?: bigint
  readonly paymasterPostOpGasLimit?: bigint
}

export interface BundlerGasPrice {
  readonly maxFeePerGas: bigint
  readonly maxPriorityFeePerGas: bigint
}

export interface BundlerPort {
  readonly estimateGas: (
    chain: EvmChainReference,
    operation: BundlerUserOperation,
  ) => Promise<BundlerGasEstimate>
  readonly getGasPrice: (chain: EvmChainReference) => Promise<BundlerGasPrice>
  readonly send: (
    chain: EvmChainReference,
    operation: BundlerUserOperation,
  ) => Promise<Hex>
  readonly getReceipt: (
    chain: EvmChainReference,
    userOperationHash: Hex,
  ) => Promise<UserOperationReceipt<'0.7'> | undefined>
}
