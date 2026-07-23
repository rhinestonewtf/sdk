import type { CrossChainPermissionInput, CrossChainPermit } from './types'

function seconds(input: Date): bigint {
  return BigInt(Math.floor(input.getTime() / 1000))
}

function normalizeLegs<T>(
  legs: T | readonly T[] | undefined,
): readonly T[] | undefined {
  if (legs === undefined) return undefined
  const values = Array.isArray(legs) ? (legs as readonly T[]) : [legs as T]
  return values.length === 0 ? undefined : values
}

// Token fields are per-chain ERC-20 addresses (v2 no longer accepts symbols),
// so legs pass through directly; only the `Date` bounds are converted.
export function resolveCrossChainPermission(
  input: CrossChainPermissionInput,
): CrossChainPermit {
  const from = normalizeLegs(input.from)?.map((leg) => ({
    chain: leg.chain,
    token: leg.token,
    ...(leg.maxAmount === undefined ? {} : { maxAmount: leg.maxAmount }),
  }))
  const to = normalizeLegs(input.to)?.map((leg) => ({
    chain: leg.chain,
    token: leg.token,
    ...(leg.recipient === undefined ? {} : { recipient: leg.recipient }),
  }))
  const validUntil = input.validUntil ? seconds(input.validUntil) : undefined
  const validAfter = input.validAfter ? seconds(input.validAfter) : undefined
  if (
    validUntil !== undefined &&
    validAfter !== undefined &&
    validAfter > validUntil
  ) {
    throw new Error(
      `crossChainPermits: validAfter (${validAfter}) is greater than validUntil (${validUntil})`,
    )
  }
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(validUntil === undefined ? {} : { validUntil }),
    ...(validAfter === undefined ? {} : { validAfter }),
    ...(input.fillDeadline
      ? {
          fillDeadline: input.fillDeadline.map(({ chain, min, max }) => ({
            chain,
            ...(min ? { min: seconds(min) } : {}),
            ...(max ? { max: seconds(max) } : {}),
          })),
        }
      : {}),
    recipientIsAccount: !input.allowRecipientNotAccount,
    ...(input.settlementLayers
      ? { settlementLayers: input.settlementLayers }
      : {}),
  }
}

export function toCrossChainPermissionInput(
  permit: CrossChainPermit,
): CrossChainPermissionInput {
  const date = (value: bigint): Date => new Date(Number(value) * 1000)
  return {
    ...(permit.from ? { from: permit.from } : {}),
    ...(permit.to ? { to: permit.to } : {}),
    ...(permit.validUntil === undefined
      ? {}
      : { validUntil: date(permit.validUntil) }),
    ...(permit.validAfter === undefined
      ? {}
      : { validAfter: date(permit.validAfter) }),
    ...(permit.fillDeadline
      ? {
          fillDeadline: permit.fillDeadline.map(({ chain, min, max }) => ({
            chain,
            ...(min === undefined ? {} : { min: date(min) }),
            ...(max === undefined ? {} : { max: date(max) }),
          })),
        }
      : {}),
    ...(permit.recipientIsAccount === undefined
      ? {}
      : { allowRecipientNotAccount: !permit.recipientIsAccount }),
    ...(permit.settlementLayers
      ? { settlementLayers: permit.settlementLayers }
      : {}),
  }
}
