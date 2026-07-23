// Runtime chain catalog, sourced from the orchestrator's `GET /chains`.
//
// This replaces the SDK's bundled `@rhinestone/shared-configs` chain data: the
// orchestrator is authoritative for chain *facts* (which chains are supported,
// their tokens, and the wrapped-native token), so the SDK reads them at runtime
// instead of baking them in at build time. That's what lets a new chain go live
// without an SDK release.
//
// `Chain` objects themselves (rpc/nativeCurrency/formatters, needed for signing
// and `createPublicClient`) still come from viem — `/chains` can't carry those.
// The catalog only owns the chain *facts*.

import { chainIdFromCaip2, isCaip2 } from '../../chains/caip2'
import type { WireChainsResponse } from './wire'

export type CatalogToken = {
  symbol: string
  address: string
  decimals: number
}

export type ChainInfo = {
  name: string
  testnet: boolean
  // `'all'` for swap-quoter chains — the orchestrator supports any token there,
  // so no explicit list is returned.
  supportedTokens: 'all' | CatalogToken[]
  wrappedNativeToken?: CatalogToken
}

export type ChainInfoMap = Record<number, ChainInfo>

/**
 * Read-only view over the chain facts returned by `GET /chains`. Built once per
 * client (fetched lazily) and read synchronously thereafter.
 */
export class ChainCatalog {
  constructor(private readonly chains: ChainInfoMap) {}

  getSupportedChainIds(): number[] {
    return Object.keys(this.chains).map(Number)
  }

  isSupported(chainId: number): boolean {
    return chainId in this.chains
  }

  getChainInfo(chainId: number): ChainInfo | undefined {
    return this.chains[chainId]
  }

  /**
   * Whether the chain is a testnet, per the orchestrator's `/chains`. Uses the
   * catalog's own flag so it is authoritative for every supported chain
   * (including non-EVM and chains newer than the SDK's viem), rather than
   * viem's local chain list.
   */
  isTestnet(chainId: number): boolean {
    return this.chains[chainId]?.testnet ?? false
  }

  /** The wrapped-native (e.g. WETH) token for the chain, if advertised. */
  getWrappedNativeToken(chainId: number): CatalogToken | undefined {
    return this.chains[chainId]?.wrappedNativeToken
  }

  getSupportedTokens(chainId: number): 'all' | CatalogToken[] | undefined {
    return this.chains[chainId]?.supportedTokens
  }
}

// Adapter boundary: decode the CAIP-2-keyed wire response into a numeric-keyed
// `ChainInfoMap`. Entries whose id can't be mapped are skipped rather than
// failing the whole catalog.
export function parseChains(json: WireChainsResponse): ChainInfoMap {
  const out: ChainInfoMap = {}
  for (const [key, entry] of Object.entries(json)) {
    const id = isCaip2(key) ? chainIdFromCaip2(key) : Number(key)
    if (id === undefined || !Number.isFinite(id)) continue
    out[id] = {
      name: entry.name,
      testnet: entry.testnet,
      supportedTokens: entry.supportedTokens,
      ...(entry.wrappedNativeToken
        ? { wrappedNativeToken: entry.wrappedNativeToken }
        : {}),
    }
  }
  return out
}
