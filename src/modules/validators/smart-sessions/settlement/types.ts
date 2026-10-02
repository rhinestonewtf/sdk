import type { Address } from 'viem'
import type { ServedStablecoin, SessionPolicy } from '../types'

/**
 * The per-chain addresses a settlement-scoped session pins, as the
 * orchestrator's `GET /chains` serves them. A missing block means that layer
 * does not route on the chain.
 */
export interface SettlementAddresses {
  readonly cctp?: {
    readonly domain: number
    readonly tokenMessenger: Address
    readonly usdc: Address
  }
  readonly oft?: {
    readonly adapter: Address
    readonly eid: number
    readonly token: Address
  }
  readonly eco?: {
    readonly portal: Address
    readonly provers: readonly Address[]
    readonly stablecoins: readonly Address[]
  }
  readonly lz?: {
    readonly multiCall: Address
    readonly transferDelegate: Address
    readonly stargateUsdc?: {
      readonly pool: Address
      readonly token: Address
      readonly eid: number
    }
    readonly cctp?: {
      readonly domain: number
      readonly token: Address
      readonly feeReceiver: Address
      readonly feeless?: true
    }
  }
  /** Where an intent's app fee goes and who fronts unsponsored gas. */
  readonly fees?: {
    readonly appFeeCollector: Address
    readonly paymaster: Address
  }
  /** The USD stablecoins the orchestrator serves as 1:1, with their decimals: the ECO_IE floor and `swap.stableFloor` read them. */
  readonly usdStablecoins?: readonly ServedStablecoin[]
}

/** Served settlement addresses by chain id. */
export type SettlementCatalog = Readonly<Record<number, SettlementAddresses>>

/** Everything a layer module needs to scope its settlement call on one chain. */
export interface SettlementContext {
  readonly chainId: number
  /** The orchestrator's settlement addresses, trusted as served. */
  readonly settlement: SettlementCatalog
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
  /** `ECO_IE` only: the solver's maximum cut, in basis points of the cap. */
  readonly maxFeeBps?: number
  /** The permit's `validAfter`, in seconds. */
  readonly validAfter?: bigint
  /** The permit's `validUntil`, in seconds. */
  readonly validUntil?: bigint
}
