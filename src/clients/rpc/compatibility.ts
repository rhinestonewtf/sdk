import type { Chain } from 'viem'
import type { EvmChainReference } from '../../chains/types'
import type { ProviderInput } from '../../config/input'
import { createRpcReadPort } from './client'
import type { RpcReadPort } from './port'
import type { RpcProvider } from './types'

function resolveCompatibilityProvider(
  provider: ProviderInput | undefined,
): RpcProvider {
  if (!provider) return { kind: 'public' }
  return { kind: 'custom', urls: provider.urls }
}

export function materializeRpcReader(input: {
  readonly chain: Chain
  readonly provider?: ProviderInput
}): { readonly chain: EvmChainReference; readonly rpc: RpcReadPort } {
  return {
    chain: {
      kind: 'evm',
      id: input.chain.id,
      caip2: `eip155:${input.chain.id}`,
    },
    rpc: createRpcReadPort(
      input.chain,
      resolveCompatibilityProvider(input.provider),
    ),
  }
}
