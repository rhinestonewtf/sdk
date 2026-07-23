import type { Hex } from 'viem'
import {
  entryPoint07Address,
  getUserOperationHash,
} from 'viem/account-abstraction'
import type { EvmChainReference } from '../../chains/types'
import type { BundlerUserOperation } from '../../clients/bundler/port'

export function hashUserOperation(
  chain: EvmChainReference,
  operation: BundlerUserOperation,
): Hex {
  return getUserOperationHash({
    userOperation: operation,
    chainId: chain.id,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: '0.7',
  })
}
