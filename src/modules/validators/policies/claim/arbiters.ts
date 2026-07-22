import {
  contractAddresses,
  contractAddressesDev,
} from '@rhinestone/shared-configs'
import type { Address } from 'viem'
import type { CrossChainSettlementLayer } from '../../../../types'

/**
 * The contract registry keys (per `shared-configs/contracts.{,dev}.js`)
 * that each settlement layer expands to. `ACROSS` whitelists both arbiter
 * impls so a session is permissioned for the 7579 and multicall paths
 * regardless of which one the orchestrator picks at intent time.
 */
const SETTLEMENT_LAYER_CONTRACT_KEYS: Record<
  CrossChainSettlementLayer,
  readonly string[]
> = {
  SAME_CHAIN: ['samechainArbiter'],
  ECO: ['ecoArbiter'],
  ACROSS: ['across7579Arbiter', 'acrossMulticallArbiter'],
}

/**
 * Every settlement layer without a dedicated arbiter — CCTP, RELAY, RHINO,
 * OFT, and any future layer — settles through the IntentExecutor, so it acts
 * as the Permit2 claim arbiter for those routes. It's included in the "all
 * layers" default and used as the fallback for any layer not present in
 * {@link SETTLEMENT_LAYER_CONTRACT_KEYS}, so a newly-added settlement layer
 * never silently fails the on-chain arbiter check.
 */
const FALLBACK_CONTRACT_KEYS: readonly string[] = ['intentExecutor']

/**
 * Collects every distinct arbiter address that any chain in the registry
 * has deployed for the given settlement layers. The resulting whitelist
 * is what the Permit2 claim policy enforces on-chain — a session signed
 * once with this whitelist is valid against any of those arbiters.
 *
 * **"Any" means any of the *supported* settlement layers**, not any
 * address on earth. When `layers` is empty or undefined, this resolver
 * expands to the union of every layer in
 * {@link SETTLEMENT_LAYER_CONTRACT_KEYS}, so the on-chain arbiter check
 * stays meaningful (the worst case is still a Rhinestone-blessed
 * arbiter). To get a truly unrestricted whitelist a caller would have
 * to bypass this helper entirely.
 *
 * @param layers   Settlement layers the session is permitted to use.
 *                 Empty/undefined ⇒ all supported layers.
 * @param useDevContracts  Pull from the dev address book instead of mainnet.
 */
export function getArbitersForSettlementLayers(
  layers: readonly CrossChainSettlementLayer[] | undefined,
  useDevContracts?: boolean,
): Address[] | undefined {
  const registry = useDevContracts ? contractAddressesDev : contractAddresses

  // Unknown/empty ⇒ permission every mechanism: all dedicated arbiters PLUS
  // the IntentExecutor (the universal settler). Named layers resolve to their
  // dedicated arbiter, falling back to the IntentExecutor when they have none.
  const layerKeys = SETTLEMENT_LAYER_CONTRACT_KEYS as Record<
    string,
    readonly string[] | undefined
  >
  const keys =
    !layers || layers.length === 0
      ? [
          ...Object.values(SETTLEMENT_LAYER_CONTRACT_KEYS).flat(),
          ...FALLBACK_CONTRACT_KEYS,
        ]
      : layers.flatMap((l) => layerKeys[l] ?? FALLBACK_CONTRACT_KEYS)
  const seen = new Set<string>()
  const addresses: Address[] = []

  // shared-configs is shaped Record<chainId, Record<contractKey, Address>>.
  // The same logical arbiter often shares an address across chains, but a
  // given key may also have multiple addresses live in the wild (e.g.
  // post-redeploy). We collect every unique address we see for the keys
  // the caller asked for, deduplicated case-insensitively.
  for (const chainContracts of Object.values(registry)) {
    for (const key of keys) {
      const addr = (chainContracts as Record<string, Address | undefined>)[key]
      if (!addr) continue
      const norm = addr.toLowerCase()
      if (seen.has(norm)) continue
      seen.add(norm)
      addresses.push(addr)
    }
  }

  return addresses.length ? addresses : undefined
}
