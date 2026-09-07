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
    const chainId = readChainId(fromDomain)
    if (chainId === undefined) {
      throw new Error(
        `Intent origin payload has an unreadable domain chainId: ${String(fromDomain)}`,
      )
    }
    return chainId
  }

  const ops = (typedData.message as { ops?: unknown } | undefined)?.ops
  const fromLeaf = Array.isArray(ops)
    ? readChainId((ops[0] as { chainId?: unknown } | undefined)?.chainId)
    : undefined
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
 * True when the payload's chain is not bound into the signature — a
 * `MultiChainOps` set, which one signature has to satisfy on every leg.
 *
 * Callers that wrap the digest with anything chain-specific must refuse such a
 * payload rather than sign it against the leg they happen to be resolving: the
 * resulting signature validates on that chain and fails on the rest, on chain,
 * after the user has approved.
 */
export function isChainAgnosticPayload(
  typedData: TypedDataDefinition,
): boolean {
  const { chainId } = typedData.domain ?? {}
  return chainId === undefined || chainId === null
}
