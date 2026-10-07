// Public account/transaction/session configuration types relocated verbatim
// from the legacy `src/types.ts` so the published surface no longer depends on
// the legacy tree. Internal resolved config shapes live in `./resolved`.

import type {
  Abi,
  AbiFunction,
  Account,
  Address,
  Chain,
  Hex,
  TypedData,
  TypedDataDomain,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { AccountType } from '../accounts/types'
import type {
  HyperCoreChain,
  NonEvmAddress,
  SolanaAddress,
  SolanaChain,
  SolanaInstructionInput,
  StellarChain,
  TronChain,
} from '../chains/non-evm'
import type {
  AppFeeRate,
  ProtocolFeeRate,
  SerializedIntentInput,
  SettlementLayerFilter,
  SwapQuoter,
  SwapQuoterFilter,
} from '../clients/orchestrator/public'
import type { HyperliquidConfig } from '../hypercore/market'
import type {
  ClosePerpRequest,
  HyperCoreOptions,
  OpenPerpRequest,
} from '../hypercore/types'
import type { SwapVenueFor } from '../modules/validators/smart-sessions/swap/scope'

// Module type discriminator relocated verbatim from the legacy
// `src/modules/common.ts` to preserve the exact published declaration closure.
const MODULE_TYPE_VALIDATOR = 'validator'
const MODULE_TYPE_EXECUTOR = 'executor'
const MODULE_TYPE_FALLBACK = 'fallback'
const MODULE_TYPE_HOOK = 'hook'

type ModuleType =
  | typeof MODULE_TYPE_VALIDATOR
  | typeof MODULE_TYPE_EXECUTOR
  | typeof MODULE_TYPE_FALLBACK
  | typeof MODULE_TYPE_HOOK

// Resolved auth provider shape relocated verbatim from the legacy
// `src/auth/provider.ts`; referenced only by the internal `_authProvider` slot.
interface AuthProvider {
  getHeaders(): Promise<Record<string, string>>
  getSubmitHeaders(
    intentInput: SerializedIntentInput,
    isSponsored: boolean,
  ): Promise<Record<string, string>>
}

interface SafeAccount {
  type: 'safe'
  version?: '1.4.1'
  adapter?: '1.0.0' | '2.0.0'
  nonce?: bigint
}

interface NexusAccount {
  type: 'nexus'
  version?: '1.2.0' | '1.2.1'
  salt?: Hex
}

interface KernelAccount {
  type: 'kernel'
  version?: '3.3'
  salt?: Hex
}

interface StartaleAccount {
  type: 'startale'
  version?: '1.0.0' | '1.0.1'
  salt?: Hex
}

interface HcaAccount {
  type: 'hca'
  // Custom HCA factory. Defines the CREATE3 deploy address and, via its
  // implementation, the account's default validator (the HCA module).
  // Defaults to the canonical HCA factory.
  factory?: Address
}

interface EoaAccount {
  type: 'eoa'
}

type AccountProviderConfig =
  | SafeAccount
  | NexusAccount
  | KernelAccount
  | StartaleAccount
  | HcaAccount
  | EoaAccount

interface OwnableValidatorConfig {
  type: 'ecdsa'
  accounts: Account[]
  threshold?: number
  module?: Address
}

/** One Quorum Signer owner and its non-zero voting weight. */
interface QuorumOwner {
  /** Viem account used to sign this owner's raw operation digest. */
  account: Account
  /** Weight contributed by a valid signature from this owner. */
  weight: bigint
}

/** Configure a weighted Quorum Signer validator deployed at `module`. */
interface QuorumValidatorConfig {
  type: 'quorum'
  /** Weighted EOA or EIP-1271 owners. The SDK can sign configured EOA accounts. */
  owners: QuorumOwner[]
  /** Minimum combined owner weight required to authorize an operation. */
  thresholdWeight: bigint
  /** Deployed Quorum Signer validator address shared by the account's chains. */
  module: Address
}

interface ENSValidatorConfig {
  type: 'ens'
  /** Each owner with an optional expiry. Omit `expiration` to never expire. */
  owners: { account: Account; expiration?: Date }[]
  threshold?: number
}

interface WebauthnValidatorConfig {
  type: 'passkey'
  accounts: WebAuthnAccount[]
  threshold?: number
  module?: Address
}

interface MultiFactorValidatorConfig {
  type: 'multi-factor'
  validators: (
    | OwnableValidatorConfig
    | ENSValidatorConfig
    | WebauthnValidatorConfig
  )[]
  threshold?: number
  module?: Address
}

type ProviderConfig = {
  type: 'custom'
  urls: Record<number, string>
}

type BundlerConfig =
  | {
      type: 'pimlico' | 'biconomy'
      apiKey: string
    }
  | {
      type: 'custom'
      url: string | Record<number, string>
    }

type PaymasterConfig =
  | {
      type: 'pimlico' | 'biconomy'
      apiKey: string
    }
  | {
      type: 'custom'
      url: string | Record<number, string>
    }

type OwnerSet =
  | OwnableValidatorConfig
  | QuorumValidatorConfig
  | ENSValidatorConfig
  | WebauthnValidatorConfig
  | MultiFactorValidatorConfig

interface SudoPolicy {
  type: 'sudo'
}

interface UniversalActionPolicy {
  type: 'universal-action'
  valueLimitPerUse?: bigint
  rules: [UniversalActionPolicyParamRule, ...UniversalActionPolicyParamRule[]]
}

interface UniversalActionPolicyParamRule {
  condition: UniversalActionPolicyParamCondition
  calldataOffset: bigint
  usageLimit?: bigint
  referenceValue: Hex | bigint
}

type UniversalActionPolicyParamCondition =
  | 'equal'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'notEqual'
  | 'inRange'

// ArgPolicy is the expression-tree successor to UniversalActionPolicy. Same
// per-rule leaf semantics, but rules are composed with AND/OR/NOT nodes and
// arbitrary nesting instead of an implicit all-AND fixed array. Use when a
// session needs disjunction (e.g. "recipient == alice OR recipient == bob") —
// for plain AND-of-rules, UniversalActionPolicy is simpler and cheaper to init.
type ArgPolicyExpression =
  | { type: 'rule'; rule: UniversalActionPolicyParamRule }
  | { type: 'not'; child: ArgPolicyExpression }
  | { type: 'and'; left: ArgPolicyExpression; right: ArgPolicyExpression }
  | { type: 'or'; left: ArgPolicyExpression; right: ArgPolicyExpression }

interface ArgPolicy {
  type: 'arg-policy'
  valueLimitPerUse?: bigint
  expression: ArgPolicyExpression
}

interface SpendingLimitsPolicy {
  type: 'spending-limits'
  limits: {
    token: Address
    amount: bigint
  }[]
}

interface TimeFramePolicy {
  type: 'time-frame'
  validUntil: number
  validAfter: number
}

interface UsageLimitPolicy {
  type: 'usage-limit'
  limit: bigint
}

interface ValueLimitPolicy {
  type: 'value-limit'
  limit: bigint
}

interface IntentExecutionPolicy {
  type: 'intent-execution'
}

interface Permit2ClaimPolicy {
  type: 'permit2'
  /** Whitelisted Permit2 spender addresses */
  spenders?: Address[]
  /** Permitted input tokens per origin chain */
  sourceTokens?: { chain: Chain; address: Address }[]
  /** Permitted output tokens per destination chain */
  destinationTokens?: { chain: Chain; address: Address }[]
  /** Permitted recipients per destination chain (use `'any'` to allow all) */
  recipients?: { chain: Chain; address: Address | 'any' }[]
  /** Enforce that the destination recipient is the smart account */
  recipientIsAccount?: boolean
  /** Bounds for the Permit2 signature deadline */
  permitDeadline?: { min?: bigint; max?: bigint }
  /** Bounds for the mandate target fill deadline, per destination chain */
  fillDeadline?: { chain: Chain; min?: bigint; max?: bigint }[]
}

/**
 * Settlement layers supported by the cross-chain session abstraction.
 * Each value maps to one or more Permit2 arbiter addresses from the SDK's
 * bundled arbiter allow-set — devs pick a layer, the SDK resolves it to the
 * on-chain arbiter whitelist.
 *
 * The set is intentionally narrower than the orchestrator's broader
 * `SettlementLayer` union (which also names intent-executor-backed
 * bridges like `CCTP`, `RHINO`, ...). Once the params-bearing
 * intent-executor policy lands in smart-sessions-v2 (see
 * `rhinestonewtf/smart-sessions-v2#46`), this union grows to cover those
 * layers via the same selector interface.
 */
type CrossChainSettlementLayer = 'SAME_CHAIN' | 'ECO' | 'ACROSS'

/**
 * A high-level permit that authorises a session key to move funds
 * between two chains via Permit2 arbiter settlement. The SDK expands
 * one `CrossChainPermit` into a {@link Permit2ClaimPolicy} (claim-side)
 * plus optional `SpendingLimitsPolicy` / `TimeFramePolicy`
 * entries on the fallback action — the claim policy itself doesn't
 * enforce amounts or expiry on-chain, so we lift those guarantees into
 * action-level policies that do.
 *
 * Resolved from {@link CrossChainPermissionInput} by the SDK; consumers
 * normally set `SessionDefinition.crossChainPermits` with the input shape,
 * not this one. Exported as a low-level escape hatch.
 */
interface CrossChainPermit {
  /**
   * Allowed source legs: chain + token (+ optional max amount cap).
   * Omit for no source-token restriction (any token on any chain may be
   * pulled) — only the arbiter whitelist, deadline, and bridge-to-self
   * flag then constrain the source side.
   */
  from?: { chain: Chain; token: Address; maxAmount?: bigint }[]
  /**
   * Allowed destination legs: chain + token (+ optional recipient pin).
   * Omit for no destination-token restriction. Note `recipientIsAccount`
   * still constrains the destination recipient even when `to` is absent.
   */
  to?: { chain: Chain; token: Address; recipient?: Address | 'any' }[]
  /** Upper bound on the permit deadline (Permit2 deadline) — unix seconds */
  validUntil?: bigint
  /** Lower bound on the permit deadline — unix seconds */
  validAfter?: bigint
  /** Per-destination fill-deadline windows — unix seconds */
  fillDeadline?: { chain: Chain; min?: bigint; max?: bigint }[]
  /**
   * Enforce bridge-to-self (the destination recipient must be the smart
   * account). Defaults to `true` when resolved from
   * {@link CrossChainPermissionInput}.
   */
  recipientIsAccount?: boolean
  /**
   * Settlement layers this session is permitted to use. Omit (or pass
   * `[]`) for any supported layer — the SDK resolves to the union of
   * every arbiter in its bundled allow-set.
   *
   * **Smart Session limitation:** the built-in `ECO` permission currently
   * authorizes only the legacy Standard ECO arbiter. Eco solver-network routes
   * remain blocked by this allow-set until a route-aware claim policy can
   * safely inspect their encoded delivery terms.
   */
  settlementLayers?: CrossChainSettlementLayer[]
}

interface FromLeg {
  chain: Chain
  token: Address
  maxAmount?: bigint
}

interface ToLeg {
  chain: Chain
  token: Address
  recipient?: Address | 'any'
}

/**
 * Ergonomic input for a cross-chain session permit. Set on
 * `SessionDefinition.crossChainPermits`; token fields are per-chain ERC-20
 * addresses (v2 no longer accepts symbols) and the SDK resolves `Date`s to
 * on-chain deadlines, then expands
 * each entry into a {@link Permit2ClaimPolicy} (claim-side) plus optional
 * `SpendingLimitsPolicy` / `TimeFramePolicy` guardrails.
 */
interface CrossChainPermissionInput {
  /**
   * Source chain + token (+ optional max amount cap). Pass a single leg
   * or an array for multi-leg permits. Omit for no source-token
   * restriction (any token on any chain may be pulled) — the arbiter
   * whitelist, deadline, and bridge-to-self flag still apply.
   */
  from?: FromLeg | FromLeg[]
  /**
   * Destination chain + token (+ optional recipient pin). Pass a single
   * leg or an array for fan-out destinations. Omit for no
   * destination-token restriction; `recipientIsAccount` still constrains
   * the recipient.
   */
  to?: ToLeg | ToLeg[]
  /** Upper bound on the permit deadline. */
  validUntil?: Date
  /** Lower bound on the permit deadline. */
  validAfter?: Date
  /** Per-destination fill-deadline windows. */
  fillDeadline?: { chain: Chain; min?: Date; max?: Date }[]
  /**
   * Allow the destination recipient to differ from the smart account
   * (the sponsor funding the cross-chain transfer). Defaults to
   * `false`, which enforces bridge-to-self on-chain — the safer default
   * since it prevents a compromised session key from routing funds to
   * an attacker-controlled address. Set to `true` to opt out explicitly.
   */
  allowRecipientNotAccount?: boolean
  /**
   * Settlement layers this session is permitted to use. Omit (or pass
   * `[]`) to allow **any of the supported settlement layers** — the SDK
   * resolves to the union of every arbiter in its bundled allow-set. Pass
   * a subset (e.g. `['ECO']`) to narrow.
   *
   * **Smart Session limitation:** the built-in `ECO` permission currently
   * authorizes only the legacy Standard ECO arbiter. Eco solver-network routes
   * remain blocked by this allow-set until a route-aware claim policy can
   * safely inspect their encoded delivery terms.
   */
  settlementLayers?: CrossChainSettlementLayer[]
}

type Policy =
  | SudoPolicy
  | UniversalActionPolicy
  | ArgPolicy
  | SpendingLimitsPolicy
  | TimeFramePolicy
  | UsageLimitPolicy
  | ValueLimitPolicy
  | IntentExecutionPolicy

/** @internal */
interface FallbackAction {
  policies?: Policy[]
}

/** @internal */
interface ScopedAction {
  target: Address
  selector: Hex
  policies?: Policy[]
}

/** @internal */
type Action = FallbackAction | ScopedAction

/** Extract function names from an ABI. */
type FunctionNames<TAbi extends Abi> = Extract<
  TAbi[number],
  { type: 'function' }
>['name']

/** Pull the AbiFunction entry for a given name (union if overloaded). */
type GetFunction<TAbi extends Abi, TName extends string> = Extract<
  TAbi[number],
  { type: 'function'; name: TName }
>

/**
 * Map a Solidity type string to the TypeScript value a developer provides as
 * `value` in a param constraint. Dynamic types resolve to `never` so the
 * compiler prevents rules on params the on-chain policy cannot compare.
 */
type AbiTypeToValue<T extends string> = T extends `${string}[${string}]`
  ? // Arrays (fixed or dynamic) occupy more than one word or live behind an
    // offset pointer, so a single 32-byte `ref` comparison cannot address them.
    // Checked FIRST: `uint256[]` would otherwise match `uint${string}` and be
    // typed `bigint`, compiling fine and only failing at runtime.
    never
  : T extends 'address'
    ? Address
    : T extends 'bool'
      ? boolean
      : T extends `uint${string}`
        ? bigint
        : T extends `int${string}`
          ? bigint
          : T extends `bytes${infer N}`
            ? N extends ''
              ? never
              : Hex
            : never

type ParamValue<
  TFn extends AbiFunction,
  TParamName extends string,
> = AbiTypeToValue<Extract<TFn['inputs'][number], { name: TParamName }>['type']>

type NamedInputs<TFn extends AbiFunction> = Extract<
  TFn['inputs'][number],
  { name: string }
>

/**
 * Conditions expressible with a single reference value. `inRange` is excluded
 * deliberately: it needs two bounds packed into one 32-byte `ref`, which this
 * shape cannot express — use the `{ min, max }` form below instead.
 */
type SingleValueCondition = Exclude<
  UniversalActionPolicyParamCondition,
  'inRange'
>

// A constraint on a single named parameter. Three shapes:
//   - { condition, value, usageLimit? } : single comparison (AND-conjunctive,
//     emits universal-action when every param uses this form)
//   - { min, max }                       : inclusive bounds — compiles to
//     AND(greaterThanOrEqual, lessThanOrEqual), forces arg-policy
//   - { anyOf: [v1, v2, ...] }           : OR of EQUAL rules (allowlist) —
//     forces the function to emit arg-policy
type ParamConstraint<TValue> =
  | {
      condition: SingleValueCondition
      value: TValue
      usageLimit?: bigint
      min?: never
      max?: never
      anyOf?: never
    }
  | {
      /** Inclusive lower bound. Pairs with `max`. */
      min: TValue
      /** Inclusive upper bound. Pairs with `min`. */
      max: TValue
      usageLimit?: bigint
      condition?: never
      value?: never
      anyOf?: never
    }
  | {
      anyOf: readonly [TValue, ...TValue[]]
      condition?: never
      value?: never
      usageLimit?: never
      min?: never
      max?: never
    }

// Compile-time gates for sugar fields that only make sense on certain ABIs.
// Match the on-chain selector dispatch in ERC20SpendingLimitPolicy: name must
// be one of the four ERC-20 transfer/approve selectors AND shape must match.
type IsERC20TransferLike<TFn extends AbiFunction> = TFn['name'] extends
  | 'approve'
  | 'increaseAllowance'
  | 'transfer'
  ? TFn['inputs'] extends readonly [{ type: 'address' }, { type: 'uint256' }]
    ? true
    : false
  : TFn['name'] extends 'transferFrom'
    ? TFn['inputs'] extends readonly [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
      ]
      ? true
      : false
    : false

type IsPayable<TFn extends AbiFunction> =
  TFn['stateMutability'] extends 'payable' ? true : false

// `never` on the sugar field rejects any user-supplied value at the call site,
// turning a footgun (e.g. spendingLimit on vault.deposit) into a compile error.
type SpendingLimitField<TFn extends AbiFunction> =
  IsERC20TransferLike<TFn> extends true
    ? { spendingLimit?: { token: Address; amount: bigint } }
    : { spendingLimit?: never }

type ValueLimitField<TFn extends AbiFunction> = IsPayable<TFn> extends true
  ? { valueLimit?: bigint }
  : { valueLimit?: never }

type PermissionFunctionConfig<TFn extends AbiFunction> = {
  /** `valueLimitPerUse` embedded in universal/arg-policy `ActionConfig`. */
  valueLimitPerUse?: bigint
  params?: {
    [K in NamedInputs<TFn>['name']]?: ParamConstraint<ParamValue<TFn, K>>
  }
  /**
   * Per-action call cap. Emits a standalone `usage-limit` policy.
   * Counter is scoped to this single action — `transfer.maxUses=10` and
   * `approve.maxUses=10` are independent counters.
   */
  maxUses?: bigint
  /**
   * Upper bound on `block.timestamp`. Pairs with `validAfter` into one
   * `time-frame` policy. If only one of the two is set, the other defaults to
   * "always passes" (validAfter=0 / validUntil=year-2100).
   */
  validUntil?: Date
  /** Lower bound on `block.timestamp`. See `validUntil`. */
  validAfter?: Date
} & SpendingLimitField<TFn> &
  ValueLimitField<TFn>

interface Permission<TAbi extends Abi = Abi> {
  abi: TAbi
  address: Address
  functions: {
    [K in FunctionNames<TAbi>]?: PermissionFunctionConfig<
      GetFunction<TAbi, K> & AbiFunction
    >
  }
}

type PermissionsForAbis<TAbis extends readonly Abi[]> = {
  [K in keyof TAbis]: TAbis[K] extends Abi ? Permission<TAbis[K]> : never
}

/**
 * Per-session override for SmartSession policy singleton addresses.
 *
 * Defaults are the latest canonical V2 deployments. Provide a partial map to
 * pin one or more policies to non-default addresses — primarily for backwards
 * compatibility with accounts that already enabled sessions against the
 * previous V1 deployments.
 *
 * Resolved addresses are baked into `Session.actions[i].actionPolicies[j].policy`
 * at construction time, so this only needs to be set on `SessionDefinition` —
 * downstream consumers read the already-resolved values off the `Session`.
 */
interface SessionPolicyAddresses {
  sudo?: Address
  universalAction?: Address
  argPolicy?: Address
  spendingLimits?: Address
  timeFrame?: Address
  usageLimit?: Address
  valueLimit?: Address
}

/** An EIP-712 domain and canonical schema that a scoped session may sign. */
interface SessionSigningContent {
  /** The exact application domain. Omitted fields are not inferred. */
  domain: TypedDataDomain
  /** The primary type and every custom type reachable from it. */
  types: TypedData
  primaryType: string
}

/**
 * ERC-1271 signing capability for a Smart Session.
 *
 * Omitting this field preserves the legacy unrestricted behavior. Scoped
 * signing matches the domain and schema only, not message field values, and
 * uses one validity window for every allowed schema. The production SDK does
 * not yet emit scoped ERC-7739 signatures, so scoped direct signing fails
 * locally until the deployed nested-signing path is remediated.
 */
type SessionSigning =
  | { mode: 'disabled' }
  | {
      mode: 'unrestricted'
      validAfter?: Date
      validUntil?: Date
    }
  | {
      mode: 'scoped'
      allowedContents: readonly SessionSigningContent[]
      validAfter?: Date
      validUntil?: Date
    }

/**
 * Restrict a session to swapping one token for another through named venues.
 *
 * The only ops such a session can run are: approve the sell token to a listed
 * venue's spender, and call that venue's swap entrypoint with the sell token,
 * buy token and recipient pinned. Declaring `swap` implies `restrictToActions`,
 * so the wildcard intent-execution fallback is dropped.
 *
 * Venues are named, not addressed — `via: [fynd()]`, not a router address. Every
 * router, selector and calldata offset lives inside the SDK, so callers need no
 * knowledge of how the swap is encoded on-chain.
 *
 * Which venue to name depends on who calls the aggregator. For orchestrator-
 * routed swaps the account calls the Rhinestone Swapper and the aggregator sits
 * inside its route. `zeroEx()` and `fynd()` authorise BOTH that wrapped shape
 * and a DIRECT router call by the account, because which one the orchestrator
 * emits depends on the swap's direction and the winning quoter — decided after
 * the session is signed.
 *
 * What a swap scope bounds: the ops runnable, the tokens, the recipient, and
 * total sell-side spend. What it does not bound on its own is the QUALITY of
 * the swap — `minAmountOut` is not pinned, so an unrouted scope can spend up to
 * the cap and receive little or nothing. Name a venue rather than taking the
 * unrouted default when that matters.
 *
 * `chain` is what narrows `via`: the same `swap` block naming `fynd()` compiles
 * on Plasma and fails to compile on Optimism, where no TychoRouter is deployed.
 * Token addresses are per-chain too, so it is never inferrable.
 *
 * @example
 * ```ts
 * const session = await sdk.createSession({
 *   chain: plasma,
 *   owners: { type: 'ecdsa', accounts: [sessionKey] },
 *   swap: {
 *     sell: { token: usdc, maxTotal: parseUnits('1000', 6) },
 *     buy: { token: usdt0 },
 *     to: account.address,
 *     via: [zeroEx({ settler })],
 *   },
 * })
 * ```
 */
/**
 * Cumulative cap on sell-token spend, enforced on two surfaces so a
 * pre-existing allowance cannot be used to exceed it: as a spending-limit on
 * the approve, and as an accumulating bound on each swap's own sell amount.
 * Omit for no cap.
 *
 * With a single `sell.token` it is what it reads as: one lifetime cap on that
 * token. With `sell.tokens` it is a cap PER SURFACE, not one budget shared
 * across everything, because neither surface can express a shared counter:
 *
 * - approve — one permission per token, each carrying its own `maxTotal`
 *   spending limit. A permission's `address` IS the token, so N tokens are N
 *   counters, and the approve surface therefore admits up to N × `maxTotal`.
 * - swap — one accumulating counter per authorised call shape, shared by every
 *   token (with several sell tokens the token pins sit in one action's
 *   alternatives). Distinct venues are distinct actions, so each carries its
 *   own counter.
 *
 * So `maxTotal` bounds any one token's approvals and any one call shape's swap
 * volume; it is not a single ceiling on the session's total spend. Size it as
 * the per-token bound you are willing to grant, and treat the aggregate as
 * that times the number of tokens.
 */
type SwapSellCap = { maxTotal?: bigint }

interface SwapScope<TChainId extends number = number> {
  /**
   * The token this session may spend, or `tokens` for several — one session
   * then serves an account that may receive any of a set, which is the case
   * when the sender chooses what arrives.
   *
   * A single `token` is not `tokens` of length one: it keeps the rule shape and
   * policy type it has always produced, so sessions already signed against it
   * are unaffected.
   *
   * Several tokens are authorised as alternatives, so the rules grow with
   * tokens x named venues and the policy has a hard ceiling of 128. Three
   * tokens across two named aggregators encodes; four does not, and fails when
   * the session is built rather than silently dropping anything. Name fewer
   * venues if you need more tokens.
   */
  sell:
    | ({ token: Address; tokens?: never } & SwapSellCap)
    | ({
        tokens: readonly [Address, ...Address[]]
        token?: never
      } & SwapSellCap)
  buy: { token: Address }
  /**
   * Swap output recipient, normally the account itself. Pinned on-chain as an
   * argument rule, so a swap delivering elsewhere is rejected — verified live
   * against the production orchestrator.
   */
  to: Address
  /**
   * Venues this session may route through. Defaults to the Rhinestone Swapper,
   * which is the route the orchestrator emits for same-chain smart-account
   * swaps and covers whichever aggregator wins the quote. Name aggregators
   * explicitly only for flows where the account calls a router directly.
   */
  via?: readonly SwapVenueFor<TChainId>[]
}

interface SessionDefinition<
  TAbis extends readonly Abi[] = readonly Abi[],
  TChain extends Chain = Chain,
> {
  chain: TChain
  /**
   * Venue-scoped swap permissions. See {@link SwapScope}. Implies
   * `restrictToActions`, and is mutually exclusive with
   * `crossChainPermits`/`claimPolicies`.
   */
  swap?: SwapScope<TChain['id']>
  owners: OwnerSet
  permissions?: readonly [...PermissionsForAbis<TAbis>]
  claimPolicies?: readonly Permit2ClaimPolicy[]
  /**
   * Cross-chain permits expanded by the SDK into matching
   * {@link Permit2ClaimPolicy} (claim-side) plus action-level
   * `SpendingLimitsPolicy` / `TimeFramePolicy` guardrails.
   * See {@link CrossChainPermissionInput}.
   */
  crossChainPermits?: readonly CrossChainPermissionInput[]
  /**
   * Raw scoped actions (target + selector + policies) for calls that can't be
   * addressed by the ABI-name `permissions` sugar. Scoped actions only.
   */
  actions?: readonly ScopedAction[]
  /**
   * Drop the wildcard intent-execution fallback so the session's explicit
   * permissions/actions are the ONLY ops it can run — any other (target,
   * selector) reverts. Requires at least one permission or action, and is
   * mutually exclusive with `crossChainPermits`/`claimPolicies` (which rely on
   * the fallback for their guardrails).
   */
  restrictToActions?: boolean
  /**
   * Configure ERC-1271 signing. Omission is unrestricted for backwards
   * compatibility; use `disabled` to remove signing capability explicitly.
   */
  signing?: SessionSigning
  /**
   * Override one or more SmartSession policy addresses. Defaults to the latest
   * V2 deployments. Use to pin to V1 deployments for an account that already
   * has sessions enabled against them.
   */
  policyAddresses?: SessionPolicyAddresses
  /**
   * How a restricted session's salt is derived, which decides its permissionId.
   *
   * The permissionId is `keccak(validator, initData, salt)` — the actions are
   * not in it. On-chain, `enable` ADDS to the policy list rather than replacing
   * it, so two sessions for one signer that share a permissionId union: the
   * earlier one's actions stay authorised and the later restriction buys
   * nothing.
   *
   * - `'none'` (default) leaves the salt at `zeroHash`, which is what stored
   *   signatures already cover. Restricted sessions for one signer therefore
   *   share a permissionId.
   * - `'v1'` reproduces a session the 1.x SDK built: the salt hashes the
   *   actions in build order, and a permission-derived action's policies are
   *   emitted in 1.x's order rather than this one's. Both are digest inputs.
   *   A raw `actions` entry is left in the order you gave it, which is what
   *   1.x does with one too.
   * - `'strict'` hashes every field enabled under the permissionId — actions,
   *   ERC-1271 policies, ERC-7739 content and claim policies — with actions
   *   ordered by value.
   *
   * Opt-in: anything other than `'none'` moves the permissionId and digest, so
   * an existing session's stored signature no longer covers it. Unrestricted
   * sessions stay on `zeroHash` in every mode.
   */
  saltMode?: 'none' | 'v1' | 'strict'
}

type SessionInput<TAbis extends readonly Abi[] = readonly Abi[]> = Omit<
  SessionDefinition<TAbis>,
  'chain'
>

interface ResolvedERC7739Content {
  appDomainSeparator: Hex
  contentNames: readonly string[]
}

interface ResolvedPolicy {
  policy: Address
  initData: Hex
}

interface ResolvedERC7739Policies {
  allowedERC7739Content: readonly ResolvedERC7739Content[]
  erc1271Policies: readonly ResolvedPolicy[]
}

interface ResolvedAction {
  actionTargetSelector: Hex
  actionTarget: Address
  actionPolicies: readonly ResolvedPolicy[]
}

interface Session {
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
  /** The venue scope this session was built from. Metadata only — it lets the
   *  SDK derive the matching quoter pin when transacting with the session. */
  swap?: SwapScope
}

interface ModuleInput {
  type: ModuleType
  address: Address
  initData?: Hex
  deInitData?: Hex
  additionalContext?: Hex
}

/**
 * Social recovery configuration.
 *
 * Guardians can rotate the account's validator configuration without the
 * current owner's approval, and there is no timelock. Prefer several trusted
 * guardians with a `threshold` above 1.
 */
interface Recovery {
  guardians: Account[]
  /** Guardian signatures required to recover. Defaults to `1`. */
  threshold?: number
}

/** Managed EVM account configuration used by the existing EVM account engine. */
interface EvmAccountConfig {
  account?: AccountProviderConfig
  owners?: OwnerSet
  sessions?: {
    enabled: boolean
    module?: Address
    compatibilityFallback?: Address
  }
  recovery?: Recovery
  eoa?: Account
  modules?: ModuleInput[]
  initData?:
    | {
        address: Address
        factory: Address
        factoryData: Hex
        intentExecutorInstalled: boolean
      }
    | {
        address: Address
      }
  address?: never
}

/** Address-only EVM destination without management or signing authority. */
interface EvmReceiverAccountConfig {
  address: Address
  account?: never
  owners?: never
  sessions?: never
  recovery?: never
  eoa?: never
  modules?: never
  initData?: never
}

/**
 * Authority of a managed Solana account: an ECDSA key, or a passkey registered
 * as the Swig's secp256r1 authority.
 */
type SolanaOwner =
  | { type: 'ecdsa'; account: Account }
  | { type: 'passkey'; account: WebAuthnAccount }

/**
 * Managed Solana account identified by its Swig.
 *
 * The wallet is independent from any EVM entry in the composite account. Save
 * the Swig state address when the account is provisioned and supply the matching
 * private-key or passkey owner when attaching it; the wallet PDA is derived.
 * A Swig that does not exist yet is created with `account.deploy('solana', solanaChain)`.
 */
interface SolanaManagedAccountConfig {
  owner: SolanaOwner
  /** Swig state account. Its asset-holding wallet PDA is derived. */
  swig: SolanaAddress
  address?: never
}

/** Backwards-compatible name for an explicitly identified managed Solana account. */
type SolanaStandaloneAccountConfig = SolanaManagedAccountConfig

/** Address-only Solana destination without spending authority. */
interface SolanaReceiverAccountConfig {
  address: SolanaAddress
  owner?: never
  swig?: never
}

type EvmAccountEntry = EvmAccountConfig | EvmReceiverAccountConfig
type SolanaAccountConfig =
  | SolanaManagedAccountConfig
  | SolanaReceiverAccountConfig

/** Independent EVM and Solana account entries. At least one VM is required. */
type RhinestoneAccountConfig =
  | Readonly<{ evm: EvmAccountEntry; solana?: SolanaAccountConfig }>
  | Readonly<{ evm?: EvmAccountEntry; solana: SolanaAccountConfig }>

interface ApiKeyAuth {
  mode: 'apiKey'
  apiKey: string
}

interface JwtAuth {
  mode: 'experimental_jwt'
  /** Static access token, or async getter for refreshable tokens. */
  accessToken: string | (() => Promise<string>)
  /**
   * Called when preparing a sponsored transaction, before it is quoted, so it
   * runs for quotes that are never submitted. Receives the approval input —
   * the quote request under the `sdk-3.0.0-caucasus` contract,
   * with CAIP-2 chain ids — and must return a signed intent_extension_token
   * JWT whose sponsorship digest covers it. Submission never calls it again.
   * A request outside the contract fails with
   * `UnsupportedSponsorshipApprovalError` before this is called.
   */
  getIntentExtensionToken?: (
    intentInput: SerializedIntentInput,
  ) => Promise<string>
}

type AuthConfig = ApiKeyAuth | JwtAuth

interface RhinestoneSDKConfigBase {
  provider?: ProviderConfig
  bundler?: BundlerConfig
  paymaster?: PaymasterConfig
  /**
   * Where and how to reach Hyperliquid, for the reads that resolve a
   * `hyperCore` transaction option and back `getPerpMarket` and friends.
   * Defaults to Hyperliquid mainnet over the global `fetch`.
   */
  hyperliquid?: HyperliquidConfig
  /**
   * @internal
   * Optional orchestrator URL override for internal testing - do not use
   */
  endpointUrl?: string
  /**
   * @internal
   * Optional intent executor address override for internal testing - do not use
   */
  useDevContracts?: boolean
  /**
   * Optional custom headers sent with every orchestrator request.
   */
  headers?: Record<string, string>
}

type RhinestoneSDKConfig = RhinestoneSDKConfigBase &
  (
    | {
        /** @deprecated Use `auth` instead. Still supported for backward compatibility. */
        apiKey: string
      }
    | {
        auth: AuthConfig
      }
  )

/** EVM invocation context used by existing call builders and helpers. */
type RhinestoneConfig = EvmAccountConfig &
  Partial<RhinestoneSDKConfig> & {
    /** @internal Resolved auth provider — set by RhinestoneSDK, not by users. */
    _authProvider?: AuthProvider
  }

type TokenSymbol = 'ETH' | 'WETH' | 'USDC' | 'USDT' | 'USDT0'

interface CalldataInput {
  to: Address
  data?: Hex
  value?: bigint
}

interface CallResolveContext {
  config: RhinestoneConfig
  chain: Chain
  accountAddress: Address
}

interface LazyCallInput {
  resolve: (
    context: CallResolveContext,
  ) => Promise<CalldataInput | CalldataInput[]>
}

type CallInput = CalldataInput | LazyCallInput

interface Call {
  to: Address
  data: Hex
  value: bigint
}

type SourceCallProvidedFunds = {
  token: Address
  amount: bigint
}

type SourceCallInput = CallInput & {
  provides?: SourceCallProvidedFunds[]
}

type OwnerSignerSet =
  | {
      type: 'owner'
      kind: 'ecdsa'
      accounts: Account[]
      module?: Address
    }
  | {
      type: 'owner'
      kind: 'quorum'
      accounts: Account[]
    }
  | {
      type: 'owner'
      kind: 'passkey'
      accounts: WebAuthnAccount[]
      module?: Address
    }
  | {
      type: 'owner'
      kind: 'multi-factor'
      validators: (
        | {
            type: 'ecdsa'
            id: number | Hex
            accounts: Account[]
          }
        | {
            type: 'passkey'
            id: number | Hex
            accounts: WebAuthnAccount[]
          }
      )[]
      module?: Address
    }

interface SessionEnableData {
  userSignature: Hex
  hashesAndChainIds: {
    chainId: bigint
    sessionDigest: Hex
  }[]
  sessionToEnableIndex: number
}

interface ChainSessionConfig {
  session: Session
  enableData?: SessionEnableData
}

interface SingleSessionSignerSet {
  type: 'session'
  session: Session
  enableData?: SessionEnableData
}

interface PerChainSessionSignerSet {
  type: 'session'
  sessions: Record<number, ChainSessionConfig>
}

type SessionSignerSet = SingleSessionSignerSet | PerChainSessionSignerSet

/**
 * Signs with the account's recovery guardians instead of its owners.
 *
 * Only valid for UserOperations: the social recovery validator rejects
 * ERC-1271 signatures and the intent flow entirely, and it accepts a single
 * `execute` call targeting an installed validator.
 */
interface GuardiansSignerSet {
  type: 'guardians'
  guardians: Account[]
}

type SignerSet = OwnerSignerSet | SessionSignerSet | GuardiansSignerSet

type Sponsorship =
  | boolean
  | {
      gas: boolean
      bridging: boolean
      swaps: boolean
      /**
       * Sponsor the Rhinestone protocol fee (`protocolFees`) from the
       * integrator's sponsorship balance instead of charging the user, without
       * the sponsorship surcharge. Defaults to `false` in the object form; the
       * `sponsored: true` shorthand enables it along with the other categories.
       */
      protocolFees?: boolean
    }

/**
 * Top-level fields of the flat transaction shape, replaced by the nested
 * `source` and `destination`. Each is refused by name at runtime too.
 */
interface ObsoleteTransactionFields {
  /** Replaced by `destination.chain`; `source.chain` defaults to it. */
  chain?: never
  /** Replaced by `destination.chain`. */
  targetChain?: never
  /** Replaced by `source.chain`. A transaction spends from one source. */
  sourceChains?: never
  /** Replaced by `source.token` and `source.maxAmount`. */
  sourceAssets?: never
  /** Replaced by `source.token`. */
  sourceTokens?: never
  /** Replaced by `source.calls`, which run on the source chain. */
  sourceCalls?: never
  /** Replaced by `source.auxiliaryFunds`, in `source.token`. */
  auxiliaryFunds?: never
  /** Replaced by `destination.token` and `destination.amount`. */
  tokenRequests?: never
  /** Replaced by `destination.recipient`. */
  recipient?: never
  /** Replaced by `destination.calls`. */
  calls?: never
  /** Replaced by `destination.gasLimit`. */
  gasLimit?: never
  /** Replaced by `destination.hyperCore`. */
  hyperCore?: never
  /** Replaced by `destination.instructions`. */
  instructions?: never
  /** Replaced by `destination.addressLookupTables`. */
  addressLookupTables?: never
  /** Replaced by `destination.authority`. */
  authority?: never
}

/**
 * The one chain and token an EVM-origin transaction spends.
 *
 * Omit `chain` to spend on the destination chain; a cross-chain transaction
 * names it. The token is an address on that chain — the SDK neither resolves
 * symbols nor searches other chains or tokens for funds.
 */
interface TransactionSource {
  /** The chain to spend on. Defaults to `destination.chain`. */
  chain?: Chain
  /** The token to spend, as an address on the source chain. */
  token: Address
  /**
   * Most of `token` the route may take from the account's balance, in base
   * units. Omit for no cap.
   */
  maxAmount?: bigint
  /**
   * Extra `token` balance, in base units, that the source can count on beyond
   * what it holds, such as funds arriving before the claim. Positive when set.
   */
  auxiliaryFunds?: bigint
  /**
   * Calls to run on the source chain before the claim, covered by the user's
   * signature. A call's `provides` must name `token`; those amounts add to
   * `auxiliaryFunds`.
   */
  calls?: SourceCallInput[]
}

/** A {@link TransactionSource} that names its chain, as a cross-chain transaction must. */
type CrossChainTransactionSource = TransactionSource & { chain: Chain }

/**
 * The token a delivery asks for: `token` alone takes everything the source
 * yields, and `token` with `amount` asks for exactly that amount. Omit both for
 * an execution that delivers nothing.
 */
type TransactionDelivery<Token extends string> =
  | {
      /** The token to receive, as an address on the destination chain. */
      token: Token
      /** Exact amount of `token` to receive, in base units. Omit to receive the most the source yields. */
      amount?: bigint
    }
  | { token?: undefined; amount?: undefined }

/** Destination-only fields that do not apply to a destination kind. */
interface ForeignDestinationFields {
  hyperCore?: never
  instructions?: never
  addressLookupTables?: never
  authority?: never
}

/** Where an EVM transaction lands: a token, calls, or both, on an EVM chain. */
type EvmTransactionDestination = TransactionDelivery<Address> &
  ForeignDestinationFields & {
    /** The EVM chain to deliver to and execute on. */
    chain: Chain
    /**
     * Who receives `token`. Omit to deliver to the account itself; a
     * recipient cannot run `calls`.
     */
    recipient?: EvmAccountConfig | Address
    /** Calls the account runs on `chain` once the delivery lands, in order. */
    calls?: CallInput[]
    /** Gas limit for `calls`. */
    gasLimit?: bigint
  }

/** A HyperCore venue: a delivery, a HyperCore action, and settlement calls. */
type HyperCoreTransactionDestination = TransactionDelivery<NonEvmAddress> &
  Omit<ForeignDestinationFields, 'hyperCore'> & {
    /** `hyperCorePerp` or `hyperCoreSpot`. */
    chain: HyperCoreChain
    recipient?: EvmAccountConfig | Address
    /** HyperEVM calls that settle the HyperCore action. */
    calls?: CallInput[]
    /** Gas limit for `calls`. */
    gasLimit?: bigint
    /**
     * What this transaction does on HyperCore: `openPerp`, `closePerp`, or a
     * raw `action`.
     *
     * `openPerp` and `closePerp` are resolved while the transaction is
     * prepared — the asset index, the price and size grids, and the mark to
     * price against are read from Hyperliquid then, because the action has to
     * be concrete before the quote commits to it.
     */
    hyperCore?: HyperCoreOptions
  }

/** A Tron or Stellar delivery. The account holds no identity there, so it names a recipient. */
interface NonEvmTransactionDestination extends ForeignDestinationFields {
  chain: TronChain | StellarChain
  /** The token to receive, in the chain's native address format. */
  token: NonEvmAddress
  /** Exact amount of `token` to receive, in base units. Omit to receive the most the source yields. */
  amount?: bigint
  /** Who receives `token`, in the chain's native address format. */
  recipient: NonEvmAddress
  calls?: never
  gasLimit?: never
}

/** A delivery from EVM to Solana. */
interface SolanaDeliveryTransactionDestination
  extends ForeignDestinationFields {
  chain: SolanaChain
  /** The SPL mint (or native SOL) to receive. */
  token: SolanaAddress
  /** Exact amount of `token` to receive, in base units. Omit to receive the most the source yields. */
  amount?: bigint
  /** Who receives `token`. Defaults to the account's Solana address. */
  recipient?: SolanaAddress
  calls?: never
  gasLimit?: never
}

/**
 * Where an EVM-origin transaction lands. Narrow on `chain` for the fields each
 * destination takes.
 */
type TransactionDestination =
  | EvmTransactionDestination
  | HyperCoreTransactionDestination
  | NonEvmTransactionDestination
  | SolanaDeliveryTransactionDestination

/** Options every EVM-origin transaction takes. */
interface EvmTransactionOptions extends ObsoleteTransactionFields {
  signers?: SignerSet
  /**
   * Requested sponsorship. A transaction that delivers nothing may omit
   * `source` only when gas is sponsored; the orchestrator decides what it
   * actually covers and refuses the rest.
   */
  sponsored?: Sponsorship
  eip7702InitSignature?: Hex
  appFees?: AppFeeRate
  /**
   * Rhinestone protocol fee rate in basis points of the input value (0–10000 =
   * 0–100%). Collected alongside `appFees` in one batched transfer and always
   * accrues to Rhinestone. Sponsor it via `sponsored.protocolFees` to charge
   * the integrator's sponsorship balance instead of the user.
   */
  protocolFees?: ProtocolFeeRate
  settlementLayers?: SettlementLayerFilter
  /**
   * Restricts which swap venues may serve this transaction's swaps. Use it to
   * keep a swap on the venue an on-chain smart-session policy is scoped to —
   * the orchestrator otherwise picks the venue after the session is signed, and
   * a route through a venue the session does not permit is rejected on-chain.
   * Omit for any venue the chain supports. An EMPTY filter is not the same as
   * omitting it: `{ include: [] }` (or an exclude covering every venue) means no
   * venue may serve the swap, and the request fails rather than falling back to
   * an unconstrained route.
   */
  quoters?: SwapQuoterFilter
  experimental_accountOverride?: {
    setupOps?: {
      to: Address
      data: Hex
    }[]
  }
}

/**
 * A transaction that lands on an EVM chain, funded from the managed EVM
 * account.
 *
 * `source` is required for a delivery, and for any execution that is not
 * gas-sponsored. Without `source.chain` it spends on the destination chain.
 */
interface EvmTransaction extends EvmTransactionOptions {
  source?: TransactionSource
  destination: EvmTransactionDestination
  /**
   * Absolute unix timestamp (seconds) overriding the on-chain fill deadline
   * (default 2 min). Same-chain only: a transaction whose `source.chain`
   * differs from `destination.chain` is refused. Must be between
   * `now + 120s` and `now + 86400s` (24h); out-of-range values are rejected
   * by the orchestrator with a `400`. When honored, the quoted `expiresAt`
   * and the bundle claim/nonce expiry track this value automatically.
   */
  customDeadline?: number
}

/**
 * A HyperCore action, delivery or both, funded from an EVM chain. HyperCore
 * hosts no account, so the source names its chain.
 */
interface HyperCoreTransaction extends EvmTransactionOptions {
  source: CrossChainTransactionSource
  destination: HyperCoreTransactionDestination
  customDeadline?: never
}

/** A delivery to Tron or Stellar, funded from an EVM chain. */
interface CrossChainNonEvmTransaction extends EvmTransactionOptions {
  source: CrossChainTransactionSource
  destination: NonEvmTransactionDestination
  customDeadline?: never
}

/** A delivery to Solana, funded from an EVM chain. */
interface CrossChainSolanaTransaction extends EvmTransactionOptions {
  source: CrossChainTransactionSource
  destination: SolanaDeliveryTransactionDestination
  customDeadline?: never
}

/**
 * The Solana token a Solana-origin transaction spends, on one cluster, with an
 * optional ceiling on how much of it the wallet may debit.
 *
 * The ceiling is the most the route may take from the wallet in that token,
 * not the amount delivered. With a destination amount the route is exact-out
 * and must fit under it; without one the route spends the smaller of the
 * balance and the ceiling. A quote whose source input exceeds the ceiling is
 * refused before anything is signed.
 *
 * @remarks
 * For native SOL the wallet's rent-exempt reserve is never spendable, so
 * spending the whole balance or a ceiling takes at most the lamports above it.
 */
interface SolanaTransactionSource {
  /** The cluster to spend on. Defaults to `destination.chain`. */
  chain?: SolanaChain
  /**
   * The SPL mint, or `11111111111111111111111111111111` for native SOL where
   * the transaction allows it.
   */
  token: SolanaAddress
  /** Most of `token` the wallet may debit, in base units. Omit for no ceiling. */
  maxAmount?: bigint
  auxiliaryFunds?: never
  calls?: never
}

/** Fields no Solana-origin transaction takes. */
interface SolanaOriginExcludedFields extends ObsoleteTransactionFields {
  signers?: never
  customDeadline?: never
  settlementLayers?: never
  quoters?: never
  experimental_accountOverride?: never
}

/**
 * Requested sponsorship, in the same shape an EVM transaction takes. Which
 * categories a Solana route actually bills is the orchestrator's decision — it
 * serves what it can cover and refuses the rest by name.
 */
type SolanaSponsorship = Sponsorship

/**
 * One same-chain SPL transfer from a managed Solana account.
 *
 * `source.token` names the mint the transfer sends, which must be
 * `destination.token`; only SPL mints are supported, and native SOL is refused
 * before anything is quoted. Omit `destination.amount` to send the whole
 * balance of the mint, or up to `source.maxAmount`.
 */
interface SameChainSolanaTransaction extends SolanaOriginExcludedFields {
  source: SolanaTransactionSource
  destination: ForeignDestinationFields & {
    chain: SolanaChain
    /** The SPL mint to send, the same as `source.token`. */
    token: SolanaAddress
    /** Amount of the mint to send, in base units. Omit to send the whole balance. */
    amount?: bigint
    /** The Solana wallet that receives the mint. */
    recipient: SolanaAddress
    calls?: never
    gasLimit?: never
  }
  appFees?: AppFeeRate
  protocolFees?: ProtocolFeeRate
  sponsored?: SolanaSponsorship
  eip7702InitSignature?: never
}

/**
 * One cross-chain delivery funded from a managed Solana account: spend an SPL
 * mint or native SOL on a Solana cluster, receive a token on an EVM chain.
 *
 * `source` names the cluster and token explicitly — the route spends exactly
 * one source token. Omit `destination.amount` to spend the whole balance of
 * that token, or up to `source.maxAmount`. Omit `destination.recipient` to
 * deliver to the account's own EVM address. An account with no EVM entry has
 * none, so it must name a recipient.
 *
 * `destination.calls` run on the account's own EVM account once the delivery
 * lands, which needs an EVM entry and no explicit recipient.
 */
interface CrossChainSolanaOriginTransaction extends SolanaOriginExcludedFields {
  source: SolanaTransactionSource & { chain: SolanaChain }
  destination: ForeignDestinationFields & {
    /** The EVM chain to deliver to. */
    chain: Chain
    /** The token to receive, as an address on `chain`. */
    token: Address
    /** Exact amount of `token` to receive, in base units. Omit to receive the most the source yields. */
    amount?: bigint
    recipient?: Address
    /**
     * Calls the account's EVM account runs on `chain` after the delivery
     * lands, in order. The quote then also asks the EVM account to sign them,
     * and to sign any EIP-7702 delegation it needs there.
     */
    calls?: CallInput[]
    /** Gas limit for `calls`. */
    gasLimit?: bigint
  }
  /**
   * The init signature an EIP-7702 account needs to run `destination.calls`,
   * from `signEip7702InitData()`.
   */
  eip7702InitSignature?: Hex
  appFees?: AppFeeRate
  protocolFees?: ProtocolFeeRate
  sponsored?: SolanaSponsorship
}

/**
 * Solana instructions run out of a managed Solana account's own wallet, on the
 * cluster the account holds them on.
 *
 * The wallet executes the instructions, so the destination names no token and
 * no recipient: a payee is encoded inside the instructions themselves. A
 * gas-sponsored execution needs no `source`; otherwise `source.token` names the
 * SPL mint or native SOL the execution's charge is paid in.
 */
interface SameChainSolanaInstructionsTransaction
  extends SolanaOriginExcludedFields {
  source?: Omit<SolanaTransactionSource, 'maxAmount'> & { maxAmount?: never }
  destination: {
    chain: SolanaChain
    /** The instructions to run, in order. Between 1 and 32. */
    instructions: readonly SolanaInstructionInput[]
    /**
     * Address lookup tables the instructions resolve accounts through, base58,
     * as Jupiter's `/swap-instructions` returns them. At most 8.
     */
    addressLookupTables?: readonly string[]
    token?: never
    amount?: never
    recipient?: never
    authority?: never
    calls?: never
    gasLimit?: never
    hyperCore?: never
  }
  sponsored?: SolanaSponsorship
  appFees?: never
  protocolFees?: never
  eip7702InitSignature?: never
}

/**
 * What a Swig authority role may do:
 *
 * - `all` — every action: spend, run instructions, and add or remove the
 *   Swig's non-root authorities.
 * - `allButManageAuthority` — spend and run instructions, but never add or
 *   remove an authority.
 * - `manageAuthority` — add and remove the Swig's non-root authorities, but
 *   never spend or run instructions. It can grant `all` to any key, so treat
 *   it as takeover power over the wallet, not as a limited or add-only right.
 */
type SolanaAuthorityPermission =
  | 'all'
  | 'allButManageAuthority'
  | 'manageAuthority'

/**
 * What a Swig passkey role may do.
 * @deprecated Use `SolanaAuthorityPermission`, which covers every key kind.
 */
type SolanaPasskeyPermission = SolanaAuthorityPermission

/**
 * A key on a Swig role, named by its SEC1-compressed public key (33 bytes,
 * lowercase hex):
 *
 * - `passkey` — a P-256 key. `addPasskey` and `removePasskey` build it from a
 *   viem WebAuthn account or any P-256 key encoding.
 * - `ecdsa` — a secp256k1 public key, never an EVM address. An account acting
 *   through it is configured with `{ type: 'ecdsa', account }` whose address
 *   derives from this key. `addEcdsaKey` and `removeEcdsaKey` build it.
 */
type SolanaAuthorityKey =
  | { type: 'passkey'; publicKey: Hex }
  | { type: 'ecdsa'; publicKey: Hex }

/**
 * A change to a managed Solana account's Swig authorities: add a passkey or
 * ECDSA key with a permission, or remove one by its key. Build it with
 * `addPasskey`, `addEcdsaKey`, `removePasskey` or `removeEcdsaKey` from
 * `@rhinestone/sdk/solana`.
 */
type SolanaAuthorityChange =
  | {
      action: 'add'
      key: SolanaAuthorityKey
      permission: SolanaAuthorityPermission
    }
  | { action: 'remove'; key: SolanaAuthorityKey; permission?: never }

/**
 * Whether a Swig authority change is already in place, from
 * `getAuthorityStatus`:
 *
 * - `applied` — an add: a role carries the key with exactly the requested
 *   permission, on `roleId`. A remove: no role carries the key.
 * - `notApplied` — an add: no role carries the key. A remove: a removable role
 *   still carries it.
 * - `conflict` — an add only: a role (`roleId`) carries the key with another
 *   permission, or one the orchestrator could not read (`permission` absent).
 *   Never treat it as ready.
 */
type SolanaAuthorityStatus =
  | { status: 'applied'; roleId?: number }
  | { status: 'notApplied' }
  | {
      status: 'conflict'
      roleId: number
      permission?: SolanaAuthorityPermission
    }

/**
 * Adds or removes a passkey or ECDSA key on a managed Solana account's Swig, on
 * the cluster the Swig lives on. One change per transaction.
 *
 * The configured owner signs the change, and must sit on a role holding `All`
 * or `ManageAuthority`. The change is always gas-sponsored and billed to the
 * integrator's sponsorship, like `deploy('solana', …)`, so it names no
 * `source`; the sponsor also funds the rent a new role locks, and a removal
 * returns it to the wallet.
 *
 * Granting `manageAuthority` or `all` hands over control of the wallet: either
 * can add a key with `all`.
 *
 * The orchestrator refuses a change the Swig's current roles do not allow —
 * adding a key already present, removing a missing key, the root role, or the
 * last role able to manage authorities — with
 * `SolanaAuthorityChangeRefusedError` from `@rhinestone/sdk/errors`.
 */
interface SameChainSolanaAuthorityTransaction
  extends SolanaOriginExcludedFields {
  source?: never
  destination: {
    chain: SolanaChain
    /** The change to make, from `addPasskey`, `addEcdsaKey`, `removePasskey` or `removeEcdsaKey`. */
    authority: SolanaAuthorityChange
    token?: never
    amount?: never
    recipient?: never
    instructions?: never
    addressLookupTables?: never
    calls?: never
    gasLimit?: never
    hyperCore?: never
  }
  sponsored?: never
  appFees?: never
  protocolFees?: never
  eip7702InitSignature?: never
}

interface UserOperationTransaction {
  calls: CallInput[]
  gasLimit?: bigint
  signers?: SignerSet
  chain: Chain
}

/** Transactions funded from a managed EVM account. */
type EvmOriginTransaction =
  | EvmTransaction
  | HyperCoreTransaction
  | CrossChainNonEvmTransaction
  | CrossChainSolanaTransaction

/**
 * An intent transaction: a `destination` to reach, and the one `source` that
 * funds it.
 */
type Transaction =
  | EvmOriginTransaction
  | SameChainSolanaTransaction
  | SameChainSolanaInstructionsTransaction
  | SameChainSolanaAuthorityTransaction
  | CrossChainSolanaOriginTransaction

type RequiredAccountBranch<
  C extends RhinestoneAccountConfig,
  Vm extends 'evm' | 'solana',
> = [C] extends [Readonly<Record<Vm, infer Branch>>] ? Branch : never

type ManagedEvmTransactions<C extends RhinestoneAccountConfig> = [
  RequiredAccountBranch<C, 'evm'>,
] extends [never]
  ? never
  : [RequiredAccountBranch<C, 'evm'>] extends [EvmAccountConfig]
    ? EvmOriginTransaction
    : never

type RestrictedSolanaDelivery = Omit<
  CrossChainSolanaOriginTransaction,
  'destination' | 'eip7702InitSignature'
> & {
  destination: Omit<
    CrossChainSolanaOriginTransaction['destination'],
    'calls' | 'gasLimit'
  > & { calls?: never; gasLimit?: never }
  eip7702InitSignature?: never
}

type WithDeliveryRecipient<T extends { destination: object }> = Omit<
  T,
  'destination'
> & { destination: T['destination'] & { recipient: Address } }

type SolanaDeliveryFor<C extends RhinestoneAccountConfig> = [
  RequiredAccountBranch<C, 'evm'>,
] extends [never]
  ? WithDeliveryRecipient<RestrictedSolanaDelivery>
  : [RequiredAccountBranch<C, 'evm'>] extends [EvmAccountConfig]
    ? CrossChainSolanaOriginTransaction
    : [RequiredAccountBranch<C, 'evm'>] extends [EvmReceiverAccountConfig]
      ? RestrictedSolanaDelivery
      : WithDeliveryRecipient<RestrictedSolanaDelivery>

type ManagedSolanaTransactions<C extends RhinestoneAccountConfig> = [
  RequiredAccountBranch<C, 'solana'>,
] extends [never]
  ? never
  : [RequiredAccountBranch<C, 'solana'>] extends [SolanaManagedAccountConfig]
    ?
        | SameChainSolanaTransaction
        | SameChainSolanaInstructionsTransaction
        | SameChainSolanaAuthorityTransaction
        | SolanaDeliveryFor<C>
    : never

/** Transactions available from every definitely managed source VM. */
type AccountTransaction<C extends RhinestoneAccountConfig> =
  | ManagedEvmTransactions<C>
  | ManagedSolanaTransactions<C>

export type {
  AccountProviderConfig,
  AccountTransaction,
  AccountType,
  Action,
  ApiKeyAuth,
  ArgPolicyExpression,
  AuthConfig,
  BundlerConfig,
  Call,
  CalldataInput,
  CallInput,
  CallResolveContext,
  ChainSessionConfig,
  ClosePerpRequest,
  CrossChainPermissionInput,
  CrossChainPermit,
  CrossChainSettlementLayer,
  ENSValidatorConfig,
  EoaAccount,
  EvmAccountConfig,
  EvmAccountEntry,
  EvmReceiverAccountConfig,
  FallbackAction,
  FromLeg,
  GuardiansSignerSet,
  HcaAccount,
  HyperCoreOptions,
  HyperliquidConfig,
  JwtAuth,
  KernelAccount,
  LazyCallInput,
  ModuleInput,
  ModuleType,
  MultiFactorValidatorConfig,
  NexusAccount,
  OpenPerpRequest,
  OwnableValidatorConfig,
  OwnerSet,
  ParamConstraint,
  PaymasterConfig,
  PerChainSessionSignerSet,
  Permission,
  PermissionFunctionConfig,
  PermissionsForAbis,
  Permit2ClaimPolicy,
  Policy,
  ProviderConfig,
  QuorumOwner,
  QuorumValidatorConfig,
  Recovery,
  ResolvedAction,
  ResolvedERC7739Content,
  ResolvedERC7739Policies,
  ResolvedPolicy,
  RhinestoneAccountConfig,
  RhinestoneConfig,
  RhinestoneSDKConfig,
  SafeAccount,
  ScopedAction,
  Session,
  SessionDefinition,
  SessionEnableData,
  SessionInput,
  SessionPolicyAddresses,
  SessionSignerSet,
  SessionSigning,
  SessionSigningContent,
  SignerSet,
  SolanaAccountConfig,
  SolanaAuthorityChange,
  SolanaAuthorityKey,
  SolanaAuthorityPermission,
  SolanaAuthorityStatus,
  SolanaManagedAccountConfig,
  SolanaOwner,
  SolanaPasskeyPermission,
  SolanaReceiverAccountConfig,
  SolanaTransactionSource,
  SolanaStandaloneAccountConfig,
  SingleSessionSignerSet,
  SourceCallInput,
  SourceCallProvidedFunds,
  Sponsorship,
  StartaleAccount,
  SwapQuoter,
  SwapQuoterFilter,
  SwapScope,
  TokenSymbol,
  ToLeg,
  CrossChainNonEvmTransaction,
  CrossChainSolanaOriginTransaction,
  CrossChainSolanaTransaction,
  EvmOriginTransaction,
  EvmTransaction,
  EvmTransactionDestination,
  HyperCoreTransaction,
  HyperCoreTransactionDestination,
  NonEvmTransactionDestination,
  SolanaDeliveryTransactionDestination,
  TransactionDestination,
  TransactionSource,
  SameChainSolanaAuthorityTransaction,
  SameChainSolanaInstructionsTransaction,
  SameChainSolanaTransaction,
  Transaction,
  UniversalActionPolicyParamCondition,
  UserOperationTransaction,
  WebauthnValidatorConfig,
}
