import { type Address, type Chain, defineChain, isAddress } from 'viem'
import * as viemChains from 'viem/chains'
import { isNonEvmChainId } from './caip2'
import type { NonEvmAddress } from './destinations'

// Chain objects (rpc / nativeCurrency / formatters, needed for signing and
// `createPublicClient`) come from viem — not from bundled chain config. The
// supported *set* is gated by the orchestrator; this resolves any known viem
// chain by id.
const allViemChains = (Object.values(viemChains) as unknown as Chain[]).filter(
  (c) => typeof c?.id === 'number',
)

function getChainById(chainId: number): Chain {
  const known = allViemChains.find((c) => c.id === chainId)
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

function isTestnet(chainId: number): boolean {
  const chain = getChainById(chainId)
  return chain.testnet ?? false
}

function resolveTokenAddress(
  token: Address | NonEvmAddress,
  chainId: number,
): Address | NonEvmAddress {
  if (isAddress(token)) {
    return token
  }
  // Non-EVM destinations carry SPL mints (base58) / Tron T-prefixed
  // addresses that don't satisfy viem's `isAddress`. The orchestrator's
  // wire schema accepts the raw string for non-EVM chains, so pass it
  // through unchanged. HyperCore is descriptor-addressed too but its tokens
  // are EVM hex addresses (returned above), so it is intentionally absent
  // from `isNonEvmChainId`.
  if (isNonEvmChainId(chainId)) {
    return token
  }
  // v2: token symbols are no longer accepted. An EVM input that isn't a hex
  // address is invalid — callers must pass the token's address.
  throw new Error(
    `Expected a token address on EVM chain ${chainId}, got: ${token}`,
  )
}

export { getChainById, isTestnet, resolveTokenAddress }
