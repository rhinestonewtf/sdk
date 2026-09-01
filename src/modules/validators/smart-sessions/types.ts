import type {
  Abi,
  AbiFunction,
  Address,
  Chain,
  Hex,
  TypedData,
  TypedDataDefinition,
  TypedDataDomain,
} from 'viem'
import type { OwnerSet } from '../types'

export type UniversalActionPolicyParamCondition =
  | 'equal'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'notEqual'
  | 'inRange'

export interface UniversalActionPolicyParamRule {
  readonly condition: UniversalActionPolicyParamCondition
  readonly calldataOffset: bigint
  readonly usageLimit?: bigint
  readonly referenceValue: Hex | bigint
}

export type ArgPolicyExpression =
  | { readonly type: 'rule'; readonly rule: UniversalActionPolicyParamRule }
  | { readonly type: 'not'; readonly child: ArgPolicyExpression }
  | {
      readonly type: 'and' | 'or'
      readonly left: ArgPolicyExpression
      readonly right: ArgPolicyExpression
    }

export type SessionPolicy =
  | { readonly type: 'sudo' }
  | {
      readonly type: 'universal-action'
      readonly valueLimitPerUse?: bigint
      readonly rules: [
        UniversalActionPolicyParamRule,
        ...UniversalActionPolicyParamRule[],
      ]
    }
  | {
      readonly type: 'arg-policy'
      readonly valueLimitPerUse?: bigint
      readonly expression: ArgPolicyExpression
    }
  | {
      readonly type: 'spending-limits'
      readonly limits: {
        readonly token: Address
        readonly amount: bigint
      }[]
    }
  | {
      readonly type: 'time-frame'
      readonly validUntil: number
      readonly validAfter: number
    }
  | { readonly type: 'usage-limit'; readonly limit: bigint }
  | { readonly type: 'value-limit'; readonly limit: bigint }
  | { readonly type: 'intent-execution' }

/**
 * A swap venue, produced by the `zeroEx()` / `fynd()` builders. Callers never
 * construct these literally — router addresses, selectors and calldata offsets
 * are resolved from the venue id inside `swap-venues.ts`.
 */
export interface ZeroExVenue {
  readonly id: '0x'
  readonly settler?: Address
  readonly anySettler?: boolean
  readonly maxSpend?: bigint
}

export interface FyndVenue {
  readonly id: 'fynd'
  readonly maxSpend?: bigint
}

/**
 * The Rhinestone Swapper — aggregator-agnostic, and the route the orchestrator
 * actually uses for same-chain smart-account swaps.
 */
export interface RhinestoneSwapVenue {
  readonly id: 'rhinestone'
  readonly maxSpend?: bigint
  /**
   * Pin which aggregator the Swapper's `calls[]` tail may route through. Omit
   * to leave the route unconstrained (bounded only by the sell cap).
   */
  readonly route?: 'zeroEx' | 'fynd'
  /**
   * Several aggregators authorised for the same wrapped call. Composed by
   * `resolveSwapScope`, not written by callers: the tail is pinned to any ONE
   * of them rather than left free, which is what keeps a multi-venue session no
   * broader than the venues it names.
   */
  readonly routes?: readonly ('zeroEx' | 'fynd')[]
  /**
   * 0x's Settler, when known. Pins the nested `AllowanceHolder.exec` inside
   * `calls[1].data`; without it that call's operator/target stay free.
   */
  readonly settler?: Address
}

export type SwapVenue = RhinestoneSwapVenue | ZeroExVenue | FyndVenue

/** Loose (chain-unaware) swap scope. The public config type narrows `via` by chain. */
export interface SwapScopeInput {
  readonly sell: { readonly token: Address; readonly maxTotal?: bigint }
  readonly buy: { readonly token: Address }
  /** Swap output recipient — pinned, so a compromised key cannot redirect output. */
  readonly to: Address
  /**
   * Venues this session may route through. Defaults to the Rhinestone Swapper,
   * which covers whichever aggregator the orchestrator picks. Name aggregators
   * explicitly only for flows where the account calls a router directly.
   */
  readonly via?: readonly SwapVenue[]
}

export interface FallbackAction {
  readonly policies?: SessionPolicy[]
}

export interface ScopedAction {
  readonly target: Address
  readonly selector: Hex
  readonly policies?: SessionPolicy[]
}

export type SessionAction = FallbackAction | ScopedAction

export interface Permission {
  readonly abi: Abi
  readonly address: Address
  readonly functions: Readonly<
    Record<
      string,
      | {
          readonly valueLimitPerUse?: bigint
          readonly params?: Readonly<Record<string, unknown>>
          readonly maxUses?: bigint
          readonly validUntil?: Date
          readonly validAfter?: Date
          readonly valueLimit?: bigint
          readonly spendingLimit?: {
            readonly token: Address
            readonly amount: bigint
          }
        }
      | undefined
    >
  >
}

export interface SessionPolicyAddresses {
  readonly sudo?: Address
  readonly universalAction?: Address
  readonly argPolicy?: Address
  readonly spendingLimits?: Address
  readonly timeFrame?: Address
  readonly usageLimit?: Address
  readonly valueLimit?: Address
}

export type CrossChainSettlementLayer = 'SAME_CHAIN' | 'ECO' | 'ACROSS'

export interface CrossChainPermit {
  from?: { chain: Chain; token: Address; maxAmount?: bigint }[]
  to?: { chain: Chain; token: Address; recipient?: Address | 'any' }[]
  validUntil?: bigint
  validAfter?: bigint
  fillDeadline?: { chain: Chain; min?: bigint; max?: bigint }[]
  recipientIsAccount?: boolean
  settlementLayers?: CrossChainSettlementLayer[]
}

export interface FromLeg {
  chain: Chain
  token: Address
  maxAmount?: bigint
}

export interface ToLeg {
  chain: Chain
  token: Address
  recipient?: Address | 'any'
}

export interface CrossChainPermissionInput {
  from?: FromLeg | FromLeg[]
  to?: ToLeg | ToLeg[]
  validUntil?: Date
  validAfter?: Date
  fillDeadline?: { chain: Chain; min?: Date; max?: Date }[]
  allowRecipientNotAccount?: boolean
  settlementLayers?: CrossChainSettlementLayer[]
}

export interface Permit2ClaimPolicy {
  type: 'permit2'
  spenders?: Address[]
  sourceTokens?: { chain: Chain; address: Address }[]
  destinationTokens?: { chain: Chain; address: Address }[]
  recipients?: { chain: Chain; address: Address | 'any' }[]
  recipientIsAccount?: boolean
  permitDeadline?: { min?: bigint; max?: bigint }
  fillDeadline?: { chain: Chain; min?: bigint; max?: bigint }[]
}

export interface SessionSigningContent {
  readonly domain: TypedDataDomain
  readonly types: TypedData
  readonly primaryType: string
}

export type SessionSigning =
  | { readonly mode: 'disabled' }
  | {
      readonly mode: 'unrestricted'
      readonly validAfter?: Date
      readonly validUntil?: Date
    }
  | {
      readonly mode: 'scoped'
      readonly allowedContents: readonly SessionSigningContent[]
      readonly validAfter?: Date
      readonly validUntil?: Date
    }

export interface SessionDefinition {
  chain: Chain
  owners: OwnerSet
  permissions?: Permission[]
  claimPolicies?: Permit2ClaimPolicy[]
  crossChainPermits?: CrossChainPermissionInput[]
  signing?: SessionSigning
  policyAddresses?: SessionPolicyAddresses
  // Drops the wildcard intent-execution fallback so the session's explicit
  // permissions are the ONLY ops it can run — any other (target, selector)
  // reverts instead of passing via the global intent-execution target whitelist.
  // Required to make a session provably restricted, e.g. to a specific swap
  // aggregator (RHI-6286). Requires at least one permission or action.
  restrictToActions?: boolean
  /**
   * Venue-scoped swap permissions. Compiles to a merged approve plus one scoped
   * swap action per venue, and implies `restrictToActions`.
   */
  swap?: SwapScopeInput
  // Raw scoped actions (target + selector + policies) for calls that can't be
  // addressed by the ABI-name `permissions` sugar — e.g. a fynd swap scoped by
  // its raw selector with no ABI (RHI-6286). ScopedAction only (never a fallback
  // action) so a raw entry can't map back to the wildcard fallback target.
  actions?: ScopedAction[]
}

export interface ResolvedPolicy {
  policy: Address
  initData: Hex
}

export interface ResolvedAction {
  actionTargetSelector: Hex
  actionTarget: Address
  actionPolicies: readonly ResolvedPolicy[]
}

export interface ResolvedERC7739Content {
  appDomainSeparator: Hex
  contentNames: readonly string[]
}

export interface ResolvedERC7739Policies {
  allowedERC7739Content: readonly ResolvedERC7739Content[]
  erc1271Policies: readonly ResolvedPolicy[]
}

export interface Session {
  chain: Chain
  owners: OwnerSet
  hasExplicitPermissions: boolean
  permissionId: Hex
  sessionValidator: Address
  sessionValidatorInitData: Hex
  salt: Hex
  erc7739Policies: ResolvedERC7739Policies
  actions: readonly ResolvedAction[]
  claimPolicies: readonly Permit2ClaimPolicy[]
  /** The venue scope this session was built from, carried through resolution so
   *  a caller can derive the matching quoter pin at transact time. Metadata
   *  only — it is not part of the permission id. */
  swap?: SwapScopeInput
}

export interface SessionData {
  sessionValidator: Address
  sessionValidatorInitData: Hex
  salt: Hex
  erc7739Policies: ResolvedERC7739Policies
  actions: readonly ResolvedAction[]
  claimPolicies: readonly ResolvedPolicy[]
}

export interface SessionEnableData {
  readonly userSignature: Hex
  readonly hashesAndChainIds: readonly ChainDigest[]
  readonly sessionToEnableIndex: number
}

export interface ChainDigest {
  chainId: bigint
  sessionDigest: Hex
}

export interface SessionDetails {
  nonces: bigint[]
  hashesAndChainIds: ChainDigest[]
  data: TypedDataDefinition<
    typeof import('./authorization').types,
    'MultiChainSession'
  >
}

export interface ResolvedSessionSignerSet {
  readonly kind: 'smart-session'
  readonly session: Session
  readonly enableData?: SessionEnableData
  readonly verifyExecutions: boolean
  readonly claimPolicyData?: Hex
}

export type SmartSessionMockShape = 'enable' | 'use' | 'erc1271'

export type RawFunctionConfig = NonNullable<Permission['functions'][string]>
export type RawAbiFunction = AbiFunction
