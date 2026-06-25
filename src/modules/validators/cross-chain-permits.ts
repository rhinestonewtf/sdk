import { type Address, isAddress } from 'viem'
import { getTokenAddress } from '../../orchestrator/registry'
import type {
  CrossChainPermissionInput,
  CrossChainPermit,
  TokenSymbol,
} from '../../types'

function dateToUnixSeconds(input: Date): bigint {
  // Date.getTime() returns milliseconds since epoch; the on-chain policy
  // expects unix-seconds. Integer division matches the Permit2 deadline
  // convention.
  return BigInt(Math.floor(input.getTime() / 1000))
}

function resolveTokenForChain(
  token: Address | TokenSymbol,
  chainId: number,
): Address {
  return isAddress(token) ? token : getTokenAddress(token, chainId)
}

// Normalise the single-object / array / omitted shapes into arrays. An
// omitted side stays `undefined` (no restriction), mirroring how the
// underlying Permit2 policy treats an absent token list.
function normalizeLegs<T>(legs: T | T[] | undefined): T[] | undefined {
  if (legs === undefined) return undefined
  const arr = Array.isArray(legs) ? legs : [legs]
  return arr.length ? arr : undefined
}

/**
 * Resolve a {@link CrossChainPermissionInput} into a {@link CrossChainPermit}:
 * normalise single/array legs, resolve `TokenSymbol`s to per-chain ERC-20
 * addresses, and convert `Date` validity bounds to unix-seconds.
 *
 * @internal Used by `expandCrossChainPermit`; not part of the public API.
 */
function resolveCrossChainPermission(
  input: CrossChainPermissionInput,
): CrossChainPermit {
  const fromLegs = normalizeLegs(input.from)
  const toLegs = normalizeLegs(input.to)

  const from = fromLegs?.map((leg) => ({
    chain: leg.chain,
    token: resolveTokenForChain(leg.token, leg.chain.id),
    maxAmount: leg.maxAmount,
  }))
  const to = toLegs?.map((leg) => ({
    chain: leg.chain,
    token: resolveTokenForChain(leg.token, leg.chain.id),
    recipient: leg.recipient,
  }))

  const validUntil =
    input.validUntil !== undefined
      ? dateToUnixSeconds(input.validUntil)
      : undefined
  const validAfter =
    input.validAfter !== undefined
      ? dateToUnixSeconds(input.validAfter)
      : undefined

  // Detect an obviously-broken time window early. The on-chain policy
  // would reject any intent in this state anyway; surfacing it at build
  // time saves a round-trip to chain.
  if (
    validUntil !== undefined &&
    validAfter !== undefined &&
    validAfter > validUntil
  ) {
    throw new Error(
      `crossChainPermits: validAfter (${validAfter}) is greater than validUntil (${validUntil})`,
    )
  }

  const fillDeadline = input.fillDeadline?.map(({ chain, min, max }) => ({
    chain,
    min: min !== undefined ? dateToUnixSeconds(min) : undefined,
    max: max !== undefined ? dateToUnixSeconds(max) : undefined,
  }))

  return {
    from,
    to,
    validUntil,
    validAfter,
    fillDeadline,
    // Inverted default: callers must opt out of bridge-to-self
    // explicitly. This stops a session key from quietly bridging to an
    // attacker-controlled recipient.
    recipientIsAccount: !input.allowRecipientNotAccount,
    // Passed through verbatim. `getArbitersForSettlementLayers` expands
    // undefined/empty to "all supported layers" at session-data build
    // time.
    settlementLayers: input.settlementLayers,
  }
}

function unixSecondsToDate(seconds: bigint): Date {
  // Inverse of dateToUnixSeconds: on-chain deadlines are unix-seconds; Date
  // expects milliseconds.
  return new Date(Number(seconds) * 1000)
}

/**
 * Convert a resolved {@link CrossChainPermit} back into the
 * {@link CrossChainPermissionInput} shape accepted by
 * `SessionDefinition.crossChainPermits`.
 *
 * Useful when a permit was persisted in its resolved (unix-seconds) form and
 * has to be re-supplied as session input: converts `bigint` deadlines to
 * `Date` and maps `recipientIsAccount` to the inverse `allowRecipientNotAccount`.
 */
function toCrossChainPermissionInput(
  permit: CrossChainPermit,
): CrossChainPermissionInput {
  return {
    from: permit.from,
    to: permit.to,
    validUntil:
      permit.validUntil !== undefined
        ? unixSecondsToDate(permit.validUntil)
        : undefined,
    validAfter:
      permit.validAfter !== undefined
        ? unixSecondsToDate(permit.validAfter)
        : undefined,
    fillDeadline: permit.fillDeadline?.map(({ chain, min, max }) => ({
      chain,
      min: min !== undefined ? unixSecondsToDate(min) : undefined,
      max: max !== undefined ? unixSecondsToDate(max) : undefined,
    })),
    allowRecipientNotAccount:
      permit.recipientIsAccount !== undefined
        ? !permit.recipientIsAccount
        : undefined,
    settlementLayers: permit.settlementLayers,
  }
}

export { resolveCrossChainPermission, toCrossChainPermissionInput }
