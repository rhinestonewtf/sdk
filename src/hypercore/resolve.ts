// Turns the declarative `hyperCore` on a transaction into the concrete action
// the orchestrator quotes against.
//
// This runs inside `prepareTransaction`, before the quote, because that is the
// last moment it can: the agent authorising the action is derived from the
// action's own bytes, and the quote's `signData` carries a registration for that
// agent. Nothing about the action — the price included — can be chosen after.

import type { Address } from 'viem'
import type { HyperCoreAction } from '../clients/orchestrator/public'
import { NoOpenPerpPositionError } from './errors'
import {
  getPerpMarket,
  getPerpPosition,
  type HyperliquidConfig,
} from './market'
import { buildClosePerpOrder, buildOpenPerpOrder } from './orders'
import type { HyperCoreOptions } from './types'

export async function resolveHyperCoreAction(input: {
  readonly options: HyperCoreOptions | undefined
  readonly account: Address
  readonly hyperliquid?: HyperliquidConfig
}): Promise<HyperCoreAction | undefined> {
  const { options } = input
  if (!options) return undefined
  if (options.action) return options.action

  if (options.openPerp) {
    const market = await getPerpMarket(
      options.openPerp.asset,
      input.hyperliquid,
    )
    return buildOpenPerpOrder(market, options.openPerp)
  }

  const request = options.closePerp
  const [market, position] = await Promise.all([
    getPerpMarket(request.asset, input.hyperliquid),
    getPerpPosition(input.account, request.asset, input.hyperliquid),
  ])
  if (!position) {
    throw new NoOpenPerpPositionError(request.asset, input.account)
  }
  return buildClosePerpOrder(market, position, request)
}
