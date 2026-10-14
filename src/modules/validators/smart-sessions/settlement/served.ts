import type { SettlementAddresses, SettlementCatalog } from './types'

type Layer = 'cctp' | 'oft' | 'eco' | 'lz'

const REFUSAL: Record<Layer, string> = {
  cctp: 'CCTP does not route to',
  oft: 'OFT does not route to',
  eco: 'ECO_IE does not route to',
  lz: 'LZ does not route from',
}

/** A layer cannot settle the permit here; `settlementLayers: 'all'` drops it. */
export class SettlementLayerRefusal extends Error {}

/** The chain's served block for a layer; a chain without one does not route it. */
export function served<L extends Layer>(
  settlement: SettlementCatalog,
  chainId: number,
  layer: L,
): NonNullable<SettlementAddresses[L]> {
  const block = settlement[chainId]?.[layer]
  if (block === undefined) {
    throw new SettlementLayerRefusal(
      `crossChainPermits: ${REFUSAL[layer]} chain ${chainId}`,
    )
  }
  return block as NonNullable<SettlementAddresses[L]>
}
