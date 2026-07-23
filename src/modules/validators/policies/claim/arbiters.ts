import type { Address } from 'viem'
import type { CrossChainSettlementLayer } from '../../smart-sessions/types'

/**
 * The arbiter contract keys that each settlement layer expands to. `ACROSS`
 * whitelists both arbiter impls so a session is permissioned for the 7579 and
 * multicall paths regardless of which one the orchestrator picks at intent time.
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
 * Bundled arbiter allow-set — the deployed arbiter addresses per key, per
 * environment (the union across chains).
 *
 * v2: this is a small, signed-path **constant** bundled in the SDK rather than
 * read from `@rhinestone/shared-configs`. The arbiter is baked into the user's
 * Permit2 session signature, so it must stay **client-trusted** — never sourced
 * from the orchestrator you transact against. Rhinestone's arbiters are CREATE2
 * and near-uniform across chains, so this is a handful of addresses per key
 * (e.g. `ecoArbiter` has a mainnet and a testnet address). A new *chain* reuses
 * these; only a contract redeploy or a new settlement layer changes them.
 */
const ARBITER_ADDRESSES: Record<
  'prod' | 'dev',
  Record<string, readonly Address[]>
> = {
  prod: {
    samechainArbiter: ['0x000000000006e2569CaF8Ff021810790e0A0D740'],
    ecoArbiter: [
      '0x2e7627CCfAe4eDb336eEb5a70f08415B0F1a2b8C',
      '0xA212A6ACCC8db0e4cdf4394D0A851c70Fc27A8F0',
    ],
    across7579Arbiter: ['0x28a4D41776968c1201A807ec51fFB405362B8882'],
    acrossMulticallArbiter: ['0xA162fabb9a0EeF2736485A587aAAB3d015e14224'],
  },
  dev: {
    samechainArbiter: ['0x8fA7720Eee299223f25De8DC03C68A28541dCD10'],
    ecoArbiter: [
      '0x1BeBAfb3D05d84A5Bfd94800c88d1342f755d8AB',
      '0x8A061029AE4c5Cf69b5368119B3b0C80B31F55fE',
    ],
    across7579Arbiter: ['0x1b19973F7a29E950ad4FaF8872745B6378005517'],
    acrossMulticallArbiter: ['0x8343FBBA0526deC1c952A098057021027648bcf9'],
  },
}

/**
 * Collects every distinct arbiter address for the given settlement layers. The
 * resulting whitelist is what the Permit2 claim policy enforces on-chain — a
 * session signed once with this whitelist is valid against any of those
 * arbiters.
 *
 * **"Any" means any of the *supported* settlement layers**, not any address on
 * earth. When `layers` is empty or undefined, this expands to the union of
 * every layer in {@link SETTLEMENT_LAYER_CONTRACT_KEYS}, so the on-chain arbiter
 * check stays meaningful (the worst case is still a Rhinestone-blessed arbiter).
 *
 * @param layers   Settlement layers the session is permitted to use.
 *                 Empty/undefined ⇒ all supported layers.
 * @param useDevContracts  Pull from the dev address book instead of mainnet.
 */
export function getArbitersForSettlementLayers(
  layers: readonly CrossChainSettlementLayer[] | undefined,
  useDevContracts?: boolean,
): Address[] | undefined {
  const effectiveLayers: readonly CrossChainSettlementLayer[] =
    !layers || layers.length === 0
      ? (Object.keys(
          SETTLEMENT_LAYER_CONTRACT_KEYS,
        ) as CrossChainSettlementLayer[])
      : layers

  const book = ARBITER_ADDRESSES[useDevContracts ? 'dev' : 'prod']
  const keys = effectiveLayers.flatMap((l) => SETTLEMENT_LAYER_CONTRACT_KEYS[l])
  const seen = new Set<string>()
  const addresses: Address[] = []

  // The same logical arbiter often shares an address across chains, but a given
  // key may have multiple addresses live (e.g. a mainnet + testnet deployment).
  // Collect every unique address for the requested keys, deduped
  // case-insensitively.
  for (const key of keys) {
    for (const addr of book[key] ?? []) {
      const norm = addr.toLowerCase()
      if (seen.has(norm)) continue
      seen.add(norm)
      addresses.push(addr)
    }
  }

  return addresses.length ? addresses : undefined
}
