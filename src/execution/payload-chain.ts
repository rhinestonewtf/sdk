import type { TypedDataDefinition } from 'viem'

// MultiChainOps uses _hashTypedDataSansChainId; its first signed leaf supplies
// deterministic signer context. Chainless payloads can still have all legs on
// one chain, where chain-bound wrappers remain valid.
function readChainId(value: unknown): number | undefined {
  if (
    typeof value !== 'bigint' &&
    typeof value !== 'number' &&
    typeof value !== 'string'
  ) {
    return undefined
  }
  const chainId = Number(value)
  return Number.isFinite(chainId) ? chainId : undefined
}

function domainChainId(typedData: TypedDataDefinition): unknown {
  return typedData.domain?.chainId ?? undefined
}

function leafChainIds(typedData: TypedDataDefinition): number[] {
  const ops = (typedData.message as { ops?: unknown } | undefined)?.ops
  if (!Array.isArray(ops)) return []
  const chainIds: number[] = []
  for (const leaf of ops) {
    const chainId = readChainId(
      (leaf as { chainId?: unknown } | undefined)?.chainId,
    )
    if (chainId !== undefined) chainIds.push(chainId)
  }
  return chainIds
}

export function payloadChainId(typedData: TypedDataDefinition): number {
  const fromDomain = domainChainId(typedData)
  if (fromDomain !== undefined) {
    const chainId = readChainId(fromDomain)
    if (chainId === undefined) {
      throw new Error(
        `Intent payload has an unreadable domain chainId: ${String(fromDomain)}`,
      )
    }
    return chainId
  }
  const [fromLeaf] = leafChainIds(typedData)
  if (fromLeaf !== undefined) return fromLeaf
  throw new Error(
    `Intent payload "${String(typedData.primaryType)}" names no chain: it carries neither a domain chainId nor a ChainOps leaf to read one from`,
  )
}

export function payloadChainIds(typedData: TypedDataDefinition): number[] {
  if (domainChainId(typedData) !== undefined) return [payloadChainId(typedData)]
  const chains = [...new Set(leafChainIds(typedData))]
  return chains.length ? chains : [payloadChainId(typedData)]
}

export function signatureSpansMultipleChains(
  typedData: TypedDataDefinition,
): boolean {
  if (domainChainId(typedData) !== undefined) return false
  return new Set(leafChainIds(typedData)).size > 1
}
