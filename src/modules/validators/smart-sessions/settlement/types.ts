import type { Address } from 'viem'
import type { SessionPolicy } from '../types'

/** Everything a layer module needs to scope its settlement call on one chain. */
export interface SettlementContext {
  readonly chainId: number
  /** The layer's settlement contract on this chain. */
  readonly target: Address
  /** The account the session is for, when the definition names it. */
  readonly account?: Address
  /** The permit's `from` tokens on this chain. */
  readonly sourceTokens: readonly Address[]
  /**
   * One entry per `to` leg. `recipient` undefined means the recipient is left
   * open (`'any'`).
   */
  readonly destinations: readonly {
    readonly chainId: number
    readonly token: Address
    readonly recipient?: Address
  }[]
  /** Cumulative cap on the amount the layer call moves. */
  readonly cap?: bigint
  /** The permit's validity window, installed on every scoped action. */
  readonly timeFrame: readonly SessionPolicy[]
  /** `ECO` only: the solver's maximum cut, in basis points of the cap. */
  readonly maxFeeBps?: number
  /** The permit's `validUntil`, in seconds. */
  readonly validUntil?: bigint
}
