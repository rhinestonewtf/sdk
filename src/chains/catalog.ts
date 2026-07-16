import {
  type ChainEntry,
  chainRegistry,
  chains,
} from '@rhinestone/shared-configs'
import type { Chain } from 'viem'
import { formatCaip2 } from './caip2'
import type { ChainReference } from './types'

export interface ChainCatalog {
  readonly getChain: (chainId: number) => Chain | undefined
  readonly getEntry: (chainId: number) => ChainEntry | undefined
  readonly getSupportedChainIds: () => readonly number[]
}

export const sharedChainCatalog: ChainCatalog = Object.freeze({
  getChain: (chainId: number) =>
    chains.find((chain: Chain) => chain.id === chainId),
  getEntry: (chainId: number) => chainRegistry[chainId.toString()],
  getSupportedChainIds: () => chains.map((chain) => chain.id),
})

export function getSupportedChain(
  catalog: ChainCatalog,
  chainId: number,
): Chain {
  const chain = catalog.getChain(chainId)
  if (!chain) throw new Error(`Unsupported chain ${chainId}`)
  return chain
}

export function getChainReference(
  catalog: ChainCatalog,
  chainId: number,
): ChainReference {
  getSupportedChain(catalog, chainId)
  const caip2 = formatCaip2(chainId)
  if (caip2.startsWith('eip155:') || chainId === 1337) {
    return {
      kind: 'evm',
      id: chainId,
      caip2: caip2 as `eip155:${number}`,
    }
  }
  const separator = caip2.indexOf(':')
  return {
    kind: 'non-evm',
    namespace: caip2.slice(0, separator),
    reference: caip2.slice(separator + 1),
    caip2: caip2 as `${string}:${string}`,
  }
}

export function isTestnet(catalog: ChainCatalog, chainId: number): boolean {
  return getSupportedChain(catalog, chainId).testnet ?? false
}
