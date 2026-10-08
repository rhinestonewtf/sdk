import { floorFor } from '../swap/rules'
import type { CrossChainPermit } from '../types'
import { knownDecimals } from './eco'
import type { SettlementCatalog } from './types'

/**
 * Every bridged token is a USD stablecoin, so a `to.minAmount` outside
 * [maxAmount / 2, maxAmount] of any capped `from` leg is a units mistake. It is
 * a hard error, never a dropped layer: 'all' must not keep a floor of dust.
 * Pairs whose decimals the orchestrator does not serve are not judged.
 */
export function requireFloorsWithinCaps(
  permit: Pick<CrossChainPermit, 'from' | 'to'>,
  settlement: SettlementCatalog,
): void {
  for (const to of permit.to ?? []) {
    const toDecimals = knownDecimals(settlement, to.chain.id, to.token)
    for (const from of permit.from ?? []) {
      const fromDecimals = knownDecimals(settlement, from.chain.id, from.token)
      if (
        to.minAmount === undefined ||
        from.maxAmount === undefined ||
        toDecimals === undefined ||
        fromDecimals === undefined
      ) {
        continue
      }
      const cap = from.maxAmount
      const at = (num: bigint, den: bigint) =>
        floorFor(cap, num, den, fromDecimals, toDecimals)
      if (to.minAmount < at(1n, 2n) || to.minAmount > at(1n, 1n)) {
        throw new Error(
          `crossChainPermits: \`to.minAmount\` ${to.minAmount} on chain ${to.chain.id} must be between half of and all of the chain ${from.chain.id} maxAmount; give it in the \`to\` token's smallest units (${toDecimals} decimals)`,
        )
      }
    }
  }
}
