import type { Hex } from 'viem'
import type { EvmChainReference } from '../../chains/types'
import type { BundlerUserOperation } from '../bundler/port'

export interface PaymasterSponsorship {
  readonly paymasterFields: Readonly<Record<string, unknown>>
  readonly paymasterSignature?: Hex
}

export interface PaymasterPort {
  readonly sponsor: (
    chain: EvmChainReference,
    operation: BundlerUserOperation,
  ) => Promise<PaymasterSponsorship>
}
