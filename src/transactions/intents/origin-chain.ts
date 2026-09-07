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

type ChainOpsLeaf = { chainId: bigint | number | string }

function isChainOpsLeaf(value: unknown): value is ChainOpsLeaf {
  if (typeof value !== 'object' || value === null) return false
  const { chainId } = value as { chainId?: unknown }
  return (
    typeof chainId === 'bigint' ||
    typeof chainId === 'number' ||
    typeof chainId === 'string'
  )
}

function firstLeafChainId(typedData: TypedDataDefinition): number | undefined {
  const ops = (typedData.message as { ops?: unknown } | undefined)?.ops
  if (!Array.isArray(ops)) return undefined
  const [first] = ops
  return isChainOpsLeaf(first) ? Number(first.chainId) : undefined
}

/**
 * The chain an origin payload is signed for.
 *
 * Throws rather than yielding `NaN` for a payload that names no chain at all:
 * the value flows into signer and session resolution, and on this path a
 * failure lands after the user has already approved the intent.
 */
export function originChainId(typedData: TypedDataDefinition): number {
  const fromDomain = typedData.domain?.chainId
  if (fromDomain !== undefined && fromDomain !== null) {
    const chainId = Number(fromDomain)
    if (!Number.isFinite(chainId)) {
      throw new Error(
        `Intent origin payload has an unreadable domain chainId: ${String(fromDomain)}`,
      )
    }
    return chainId
  }

  const fromLeaf = firstLeafChainId(typedData)
  if (fromLeaf !== undefined && Number.isFinite(fromLeaf)) return fromLeaf

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
