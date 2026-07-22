import type { Hex } from 'viem'
import type { EvmChainReference } from '../../chains/types'
import type { BundlerUserOperation } from '../bundler/port'

export interface PaymasterSponsorship {
  readonly paymaster: Hex
  readonly paymasterData: Hex
  readonly paymasterVerificationGasLimit?: bigint
  readonly paymasterPostOpGasLimit?: bigint
}

export interface PaymasterStubSponsorship extends PaymasterSponsorship {
  readonly isFinal: boolean
}

export interface PaymasterPort {
  readonly getStubData: (
    chain: EvmChainReference,
    operation: BundlerUserOperation,
  ) => Promise<PaymasterStubSponsorship>
  readonly getData: (
    chain: EvmChainReference,
    operation: BundlerUserOperation,
  ) => Promise<PaymasterSponsorship>
}
