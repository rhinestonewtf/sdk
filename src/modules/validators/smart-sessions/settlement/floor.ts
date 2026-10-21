import type { Address } from 'viem'
import { refusal } from '../refusals'
import { floorFor } from '../swap/rules'
import type { CrossChainPermit } from '../types'
import { knownDecimals } from './eco'
import type { SettlementCatalog } from './types'

type From = NonNullable<CrossChainPermit['from']>[number]
type To = NonNullable<CrossChainPermit['to']>[number]

/**
 * Whether `minAmount` lies in [maxAmount / 2, maxAmount] of a cap, rescaled
 * between the two USD stablecoins' decimals; undefined when either decimals is
 * not served, so the pair is not judged.
 */
export function floorWithinCap(
  settlement: SettlementCatalog,
  from: { chainId: number; token: Address; maxAmount: bigint },
  to: { chainId: number; token: Address; minAmount: bigint },
): boolean | undefined {
  const fromDecimals = knownDecimals(settlement, from.chainId, from.token)
  const toDecimals = knownDecimals(settlement, to.chainId, to.token)
  if (fromDecimals === undefined || toDecimals === undefined) return undefined
  const at = (num: bigint, den: bigint) =>
    floorFor(from.maxAmount, num, den, fromDecimals, toDecimals)
  return to.minAmount >= at(1n, 2n) && to.minAmount <= at(1n, 1n)
}

/**
 * Every bridged token is a USD stablecoin, so a `to.minAmount` is a units
 * mistake when it lies outside [maxAmount / 2, maxAmount] of a capped `from` leg
 * that funds the same asset to it, or of every capped `from` leg a route can
 * carry to it. It is a hard error, never a dropped layer: 'all' must not keep
 * a floor of dust. `funds` says how a `from` leg reaches the leg, if at all;
 * pairs whose decimals the orchestrator does not serve are not judged.
 */
export function requireFloorsWithinCaps(
  permit: Pick<CrossChainPermit, 'from' | 'to'>,
  settlement: SettlementCatalog,
  funds: (from: From, to: To) => 'same' | 'other' | undefined = () => 'same',
): void {
  for (const to of permit.to ?? []) {
    const minAmount = to.minAmount
    if (minAmount === undefined) continue
    const verdicts = (permit.from ?? []).flatMap((from) => {
      const maxAmount = from.maxAmount
      const route = maxAmount === undefined ? undefined : funds(from, to)
      if (maxAmount === undefined || route === undefined) return []
      const fits = floorWithinCap(
        settlement,
        { chainId: from.chain.id, token: from.token, maxAmount },
        { chainId: to.chain.id, token: to.token, minAmount },
      )
      return fits === undefined ? [] : [{ from, fits, same: route === 'same' }]
    })
    const miss =
      verdicts.find(({ fits, same }) => same && !fits) ??
      (verdicts.some(({ fits }) => fits) ? undefined : verdicts[0])
    if (miss) {
      throw refusal(
        'MIN_AMOUNT_OUTSIDE_CAP',
        `crossChainPermits: \`to.minAmount\` ${minAmount} on chain ${to.chain.id} must be between half of and all of the chain ${miss.from.chain.id} maxAmount; give it in the \`to\` token's smallest units (${knownDecimals(settlement, to.chain.id, to.token)} decimals)`,
        { chainId: to.chain.id, leg: 'to' },
      )
    }
  }
}
