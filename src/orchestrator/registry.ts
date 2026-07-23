import { type Address, type Chain, isAddress } from 'viem'
import * as viemChains from 'viem/chains'
import { isNonEvmChainId } from './caip2'
import type { NonEvmAddress } from './destinations'
import { UnsupportedChainError } from './error'

// Chain objects (rpc / nativeCurrency / formatters, needed for signing and
// `createPublicClient`) come from viem — not from bundled chain config. The
// supported *set* is gated by the orchestrator; this resolves any known viem
// chain by id.
const allViemChains = (Object.values(viemChains) as unknown as Chain[]).filter(
  (c) => typeof c?.id === 'number',
)

function getChainById(chainId: number): Chain {
  const chain = allViemChains.find((c) => c.id === chainId)
  if (!chain) {
    throw new UnsupportedChainError(chainId)
  }
  return chain
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
