import type { TypedDataDefinition } from 'viem'

// A `SingleChainOps` origin payload binds its chain in the EIP-712 domain, so
// `domain.chainId` names it. A `MultiChainOps` payload is one signature over
// every leg of a multi-leg bundle, and the contract verifies it with
// `_hashTypedDataSansChainId` — the domain deliberately carries no chainId, and
// each leg's chain lives in its own `ChainOps` leaf instead.
//
// The signature is identical on every leg, so any leaf is a valid context for
// resolving a signer; the first is taken because the leaves are in signed order
// and the choice has to be deterministic.

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
  const { chainId } = typedData.domain ?? {}
  return chainId === null ? undefined : chainId
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

/**
 * The chain an origin payload is signed for.
 *
 * Throws rather than yielding `NaN` for a payload that names no chain at all:
 * the value flows into signer and session resolution, and on this path a
 * failure lands after the user has already approved the intent.
 */
export function originChainId(typedData: TypedDataDefinition): number {
  const fromDomain = domainChainId(typedData)
  if (fromDomain !== undefined) {
    const chainId = readChainId(fromDomain)
    if (chainId === undefined) {
      throw new Error(
        `Intent origin payload has an unreadable domain chainId: ${String(fromDomain)}`,
      )
    }
    return chainId
  }

  const [fromLeaf] = leafChainIds(typedData)
  if (fromLeaf !== undefined) return fromLeaf

  throw new Error(
    `Intent origin payload "${String(typedData.primaryType)}" names no chain: it carries neither a domain chainId nor a ChainOps leaf to read one from`,
  )
}

/**
 * The chain whose account runtime signs an intent, read off the last origin
 * payload as the callers here have always done.
 *
 * A `MultiChainOps` quote carries exactly one origin entry however many legs it
 * covers, so first and last are the same payload and the choice only matters
 * for the per-leg shape.
 */
export function accountChainIdFromOrigins(
  origins: readonly TypedDataDefinition[],
): number {
  const last = origins.at(-1)
  if (!last) throw new Error('Intent quote has no origin payloads')
  return originChainId(last)
}

/**
 * True when one signature over this payload has to validate on more than one
 * chain.
 *
 * An absent domain chainId is not the test on its own: `MultiChainOps` does not
 * require its leaves to be on DIFFERENT chains, and same-chain legs with
 * distinct nonces are a valid set — that is how a bundle splits its destination
 * ops across blocks. Such a payload is chainless in the domain yet every leg
 * runs on one chain, so a chain-bound wrapper still validates on all of them.
 *
 * Callers that wrap the digest with anything chain-specific must refuse only
 * the genuinely multi-chain case, where signing against the leg being resolved
 * gives a signature that fails on the rest — on chain, after the user has
 * approved.
 */
export function signatureSpansMultipleChains(
  typedData: TypedDataDefinition,
): boolean {
  if (domainChainId(typedData) !== undefined) return false
  return new Set(leafChainIds(typedData)).size > 1
}
