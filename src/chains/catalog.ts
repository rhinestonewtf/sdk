import { type Chain, defineChain } from 'viem'
import * as viemChains from 'viem/chains'
import { formatCaip2 } from './caip2'
import type { ChainReference } from './types'

// Chain objects (rpc / nativeCurrency / formatters, needed for signing and
// `createPublicClient`) come from viem — not from bundled chain config. The
// supported *set* is gated by the orchestrator; this resolves any known viem
// chain by id.
const allViemChains = (Object.values(viemChains) as unknown as Chain[]).filter(
  (chain) => typeof chain?.id === 'number',
)

export function getChainById(chainId: number): Chain {
  const known = allViemChains.find((chain) => chain.id === chainId)
  if (known) return known
  // The SDK must not gate signing/execution on its bundled viem version: a chain
  // the orchestrator supports before viem knows it must still resolve. Fall back
  // to a minimal chain carrying the id — the field EIP-712 signing needs. Richer
  // metadata (formatters, default RPC) is only available for viem-known chains;
  // RPC-needing paths already accept a caller-supplied transport.
  return defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [] } },
  })
}

export function getChainReference(chainId: number): ChainReference {
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
