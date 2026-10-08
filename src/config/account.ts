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
import type { NonEvmAddress, NonEvmChain } from '../chains/non-evm'
import type {
  AppFeeRate,
  AuxiliaryFunds,
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
import type {
  IntentExecutorSettlementLayer,
  StableSwapFloor,
} from '../modules/validators/smart-sessions/types'

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

/**
 * A raw action's time window. Optional: bound a session with
 * `oneTimeUse.validUntil`. On a `oneTimeUse` session, `validUntil` (unix ms)
 * can only shorten that one session-wide deadline (the earliest applies), and
 * `validAfter` must be `0`. Any other use throws.
 */
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
 *
 * - `SAME_CHAIN`, `ECO`, `ACROSS` settle through Permit2: each maps to one or
 *   more arbiter addresses from the SDK's bundled allow-set (`ECO` is the
 *   retired Standard Eco arbiter).
 *   `SAME_CHAIN` and `ECO` are deprecated: their arbiter paths are retired, so
 *   use `SAME_CHAIN_IE` and `ECO_IE` instead.
 * - `CCTP` (USDC), `OFT` (USDT0, with an optional `to.minAmount` floor), `ECO_IE` (Eco's solver network: the USD stablecoins the orchestrator
 *   serves for it), `SAME_CHAIN_IE` (a transfer, or a Rhinestone Swapper swap with
 *   a `to.minAmount` floor, on the session's own chain) and `LZ` (USDC through
 *   the LayerZero Value Transfer API, over Stargate or CCTP) settle by the
 *   account executing the call. Naming any of them makes the permit
 *   **settlement-scoped**: the session is restricted to those layers' calls
 *   and their approve, with the `from` token, the `to` chains and recipients,
 *   and `maxAmount` pinned in the calldata.
 *
 *   Such a permit may name several of `CCTP`, `OFT`, `ECO_IE` and `LZ`, and
 *   each must be able to settle it on the session's chain, or the session is
 *   refused. The session then allows each named layer's call and one approve
 *   of the `from` token to any of their contracts, with `maxAmount` one
 *   budget across those approves. Each layer's call is capped at `maxAmount`
 *   on its own, so an allowance the account already gave one of those
 *   contracts can move more than `maxAmount` in total. `OFT` and `LZ` cannot
 *   be combined (each pays a native LayerZero fee), `SAME_CHAIN_IE` cannot be
 *   combined with another layer, and `maxFeeBps` needs `ECO_IE` among the
 *   layers. A `to.minAmount` binds every layer in the permit: `ECO_IE` and
 *   `OFT` floor their own delivery, and naming a layer that cannot (`CCTP`
 *   never can) is refused. With `ECO_IE` among several layers, an intent settles over
 *   Eco only when it delivers at least its floor: the higher of
 *   `maxAmount × (1 − maxFeeBps / 10000)`, rescaled to the `to` token's
 *   decimals, and `to.minAmount`. Both are fixed against `maxAmount`, so the
 *   orchestrator may route a smaller intent through another layer, or the
 *   intent fails if Eco is picked.
 *
 *   `settlementLayers: 'all'` names every one of `CCTP`, `OFT`, `ECO_IE` and
 *   `LZ` that can settle the permit on the session's chain, and silently
 *   drops the rest: a layer that does not route there, does not move the
 *   `from` token, or lacks or rejects a field it needs (`ECO_IE`'s
 *   `maxFeeBps` and `validUntil`, `OFT`'s and `LZ`'s `oneTimeUse`), or cannot
 *   enforce a `to.minAmount` (always `CCTP`). Setting `maxFeeBps` or
 *   `to.minAmount` asks for `ECO_IE`, so a dropped `ECO_IE` is then refused
 *   with its reason; `maxFeeBps` floors only the `ECO_IE` call. `'all'` never includes `SAME_CHAIN_IE`, and is refused when
 *   no layer qualifies. It resolves against the orchestrator's `GET /chains`
 *   and the clock when the session is created, so store the created session
 *   (its `settlementLayers` lists the layers kept) and reuse it rather than
 *   rebuilding it from `'all'`, which can keep a different set of layers.
 *
 *   A settlement-scoped permit cannot be combined with the Permit2 layers,
 *   `maxAmount` requires `oneTimeUse`, and only sponsored intents without an
 *   app fee can settle
 *   through it unless the permit sets `allowFees`. `ECO_IE` also requires
 *   `maxAmount`, a delivery floor and `validUntil`; `validUntil` at least 7 days
 *   from now, since the session pins Eco's reward deadline under it and Eco
 *   quotes that ~7 days out. Both tokens must be ones the orchestrator serves
 *   for `ECO_IE`. The floor is `maxFeeBps`, which also needs their decimals
 *   served, or a `to.minAmount` on every leg, for any two such tokens; given
 *   both, the higher applies. Without `maxFeeBps`, every `from` leg must give
 *   the same `maxAmount`: each source chain's session pins the same
 *   `to.minAmount` against its own cap. `OFT` and `LZ` require `oneTimeUse`.
 *   `CCTP`, `OFT`, `ECO_IE` and `LZ` pin
 *   addresses the orchestrator serves on `GET /chains`, so create their
 *   sessions with `sdk.createSession`.
 */
type CrossChainSettlementLayer =
  | 'SAME_CHAIN'
  | 'ECO'
  | 'ACROSS'
  | 'CCTP'
  | 'OFT'
  | 'ECO_IE'
  | 'SAME_CHAIN_IE'
  | 'LZ'

/**
 * A high-level permit that authorises a session key to move funds
 * between two chains via Permit2 arbiter settlement. The SDK expands
 * one `CrossChainPermit` into a {@link Permit2ClaimPolicy} (claim-side)
 * plus an optional `SpendingLimitsPolicy` on the fallback action — the
 * claim policy itself doesn't enforce amounts on-chain, so the SDK lifts
 * that guarantee into an action-level policy that does.
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
   * flag then constrain the source side. On a Permit2-route permit,
   * `maxAmount` requires `oneTimeUse`.
   */
  from?: { chain: Chain; token: Address; maxAmount?: bigint }[]
  /**
   * Allowed destination legs: chain + token (+ optional recipient pin).
   * Omit for no destination-token restriction. Note `recipientIsAccount`
   * still constrains the destination recipient even when `to` is absent.
   */
  to?: ToLeg[]
  /**
   * Optional upper bound on the permit deadline (Permit2 deadline) — unix
   * seconds. Requires `oneTimeUse` and can only shorten its session-wide
   * deadline; see {@link CrossChainPermissionInput}.
   */
  validUntil?: bigint
  /** Not supported; a permit that sets it throws. */
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
   * `CCTP`, `OFT`, `ECO_IE`, `SAME_CHAIN_IE` and `LZ` are IntentExecutor layers: naming them scopes the
   * session to those layers' calls instead, and `'all'` to every bridging one
   * that can settle the permit (see {@link CrossChainSettlementLayer}).
   *
   * `SAME_CHAIN` and `ECO` are deprecated (retired Permit2 arbiters): use
   * `SAME_CHAIN_IE` and `ECO_IE`.
   */
  settlementLayers?: CrossChainSettlementLayer[] | 'all'
  /**
   * `ECO_IE` only: the solver keeps at most `maxFeeBps` of `maxAmount`, in basis
   * points. The route must deliver at least `maxAmount × (1 − maxFeeBps / 10000)`,
   * rescaled to the `to` token's decimals: a floor on the cap, not a fee on the
   * reward actually sent.
   */
  maxFeeBps?: number
  /**
   * IntentExecutor layers only: also let the session pay the intent's app fee
   * (and a user-paid protocol fee) to the orchestrator's fee collector, and
   * approve and call its paymaster for unsponsored gas. Defaults to `false`:
   * only sponsored intents without an app fee settle.
   *
   * - Each fee call has its own cumulative 5 USD cap, not one per session: the
   *   collector transfer and the paymaster approve one per `from` token, the
   *   paymaster callback one shared across tokens. So one token can pay up to
   *   about 10 USD (app fee plus gas), and N tokens up to N × 5 USD of app fee.
   * - Every `from` token on the session's chain must be one the orchestrator
   *   serves for these layers (USD stablecoins today).
   * - The fee addresses come from the orchestrator's `GET /chains`, so create
   *   the session with `sdk.createSession`.
   * - The orchestrator sizes the paymaster approve and callback at the refund
   *   ceiling (about 1.8x the gas estimate) and the fee transfer at the full
   *   fee. An intent whose ceiling or fee exceeds the remaining cap (e.g.
   *   Ethereum mainnet gas at high prices, an app fee over 5 USD, or a reusable
   *   session that has used its budget) is refused: it fails closed.
   */
  allowFees?: boolean
}

interface FromLeg {
  chain: Chain
  token: Address
  /**
   * Cap on the amount the session may move from this leg. On a Permit2-route
   * permit (`SAME_CHAIN`, `ECO`, `ACROSS`, or `settlementLayers` omitted) it
   * requires `oneTimeUse`; without it the session is refused.
   */
  maxAmount?: bigint
}

interface ToLeg {
  chain: Chain
  token: Address
  recipient?: Address | 'any'
  /**
   * `SAME_CHAIN_IE` swaps, `ECO_IE` and `OFT`: the least amount of
   * `token` the swap, the Eco route or the OFT send must deliver, in `token`'s
   * smallest units (its own decimals, e.g. `99_000_000n` for 99 of a 6-decimal
   * stablecoin). Required for
   * a swap (with `maxAmount`), since the session key otherwise sets the swap's
   * output bound; `maxAmount : minAmount` is the worst rate accepted.
   *
   * On `ECO_IE` it prices any pair of tokens the orchestrator serves for
   * `ECO_IE`, and stands in for `maxFeeBps` (given both, the higher floor
   * applies). When both tokens' decimals are served, a value under half of
   * `maxAmount` is refused as a units mistake. Without `maxFeeBps`, every `from`
   * leg must give the same `maxAmount`, and a `to` leg named twice must give the
   * same `minAmount`.
   *
   * Every layer in the permit enforces it: one that cannot (`CCTP`) is
   * refused when named and dropped under `'all'`.
   *
   * On `OFT` it is optional and floors the send's `minAmountLD`,
   * so it also refuses any send smaller than it; both tokens need served, equal
   * decimals. The orchestrator sends at 1% slippage, so set it at most 99% of
   * the amount you expect to send.
   */
  minAmount?: bigint
}

/**
 * Ergonomic input for a cross-chain session permit. Set on
 * `SessionDefinition.crossChainPermits`; token fields are per-chain ERC-20
 * addresses (v2 no longer accepts symbols) and the SDK resolves `Date`s to
 * on-chain deadlines, then expands
 * each entry into a {@link Permit2ClaimPolicy} (claim-side) plus an optional
 * `SpendingLimitsPolicy` guardrail.
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
  /**
   * Optional upper bound on the permit deadline. Bound a session with
   * `oneTimeUse.validUntil`; this requires `oneTimeUse` and can only shorten
   * that one session-wide deadline (the earliest `validUntil` in the session
   * applies, to the permit deadline too). A future `Date`.
   */
  validUntil?: Date
  /** Not supported; a permit that sets it throws. */
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
   * a subset (e.g. `['ACROSS']`) to narrow.
   *
   * `CCTP`, `OFT`, `ECO_IE`, `SAME_CHAIN_IE` and `LZ` are IntentExecutor layers: naming them scopes the
   * session to those layers' calls instead, and `'all'` to every bridging one
   * that can settle the permit (see {@link CrossChainSettlementLayer}).
   *
   * `SAME_CHAIN` and `ECO` are deprecated (retired Permit2 arbiters): use
   * `SAME_CHAIN_IE` and `ECO_IE`.
   */
  settlementLayers?: CrossChainSettlementLayer[] | 'all'
  /**
   * `ECO_IE` only: the solver keeps at most `maxFeeBps` of `maxAmount`, in basis
   * points. The route must deliver at least `maxAmount × (1 − maxFeeBps / 10000)`,
   * rescaled to the `to` token's decimals: a floor on the cap, not a fee on the
   * reward actually sent.
   */
  maxFeeBps?: number
  /**
   * IntentExecutor layers only: also let the session pay the intent's app fee
   * (and a user-paid protocol fee) to the orchestrator's fee collector, and
   * approve and call its paymaster for unsponsored gas. Defaults to `false`:
   * only sponsored intents without an app fee settle.
   *
   * - Each fee call has its own cumulative 5 USD cap, not one per session: the
   *   collector transfer and the paymaster approve one per `from` token, the
   *   paymaster callback one shared across tokens. So one token can pay up to
   *   about 10 USD (app fee plus gas), and N tokens up to N × 5 USD of app fee.
   * - Every `from` token on the session's chain must be one the orchestrator
   *   serves for these layers (USD stablecoins today).
   * - The fee addresses come from the orchestrator's `GET /chains`, so create
   *   the session with `sdk.createSession`.
   * - The orchestrator sizes the paymaster approve and callback at the refund
   *   ceiling (about 1.8x the gas estimate) and the fee transfer at the full
   *   fee. An intent whose ceiling or fee exceeds the remaining cap (e.g.
   *   Ethereum mainnet gas at high prices, an app fee over 5 USD, or a reusable
   *   session that has used its budget) is refused: it fails closed.
   */
  allowFees?: boolean
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
   * Optional. Bound a session with `oneTimeUse.validUntil`; this requires
   * `oneTimeUse` and can only shorten that one session-wide deadline (the
   * earliest `validUntil` in the session applies). It bounds the whole
   * session, not this function alone. A future `Date`.
   */
  validUntil?: Date
  /** Not supported; a permission that sets it throws. */
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
  // Required when a session sets `oneTimeUse`; no default until the policy has a
  // canonical deployment.
  oneTimeUseId?: Address
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
  /**
   * Opt-in rate floor for a stable-to-stable swap (RHI-7883). The Swapper takes
   * its output bound (`minAmountOut` / `amountOut`) from the caller and its
   * `calls[]` route may call anything, so without this a session key can set
   * that bound to zero and route the input away.
   *
   * On, every Swapper call must deliver at least
   * `ceil(maxTotal × (1 − slippage))` of the buy token on exact-in, and
   * `ceil(maxTotal ÷ (1 + slippage))` on exact-out (converted between the
   * tokens' decimals), while selling at most `maxTotal`, so no call executes
   * below floor/cap. `true` means 100 bps; pass `{ maxSlippageBps }` to choose.
   * Total sell is bounded by the approve's cumulative spending limit
   * (`maxTotal`) plus any allowance to the Swapper proxy that existed before
   * the session; exact-in and exact-out keep separate swap counters.
   *
   * Requires one sell token, `sell.maxTotal`, both tokens among the USD
   * stablecoins the orchestrator serves for the chain (`/chains`
   * `settlement.usdStablecoins`, so create the session with
   * `sdk.createSession`), and the Rhinestone Swapper as the only venue — a
   * direct aggregator call would bypass the floor. It also refuses `signing`,
   * `crossChainPermits`, `claimPolicies` and any other action on the sell
   * token, Permit2 or the Swapper, and salts the session so it never shares a
   * permissionId with an unfloored one. An action on another contract that
   * already holds an allowance on the sell token is not checked.
   *
   * The floor is absolute, not proportional: a swap much smaller than
   * `maxTotal` cannot meet it. In practice the session is single-use — after
   * one full swap the remaining cap is below the floor.
   */
  stableFloor?: StableSwapFloor
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
   * {@link Permit2ClaimPolicy} (claim-side) plus an action-level
   * `SpendingLimitsPolicy` guardrail.
   * See {@link CrossChainPermissionInput}. A permit naming `CCTP`, `OFT`,
   * `ECO_IE` or `LZ` needs `sdk.createSession`, which supplies the addresses
   * it pins from the orchestrator's `GET /chains`.
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
   * sessions stay on `zeroHash` in every mode, except a `oneTimeUse` session.
   * A settlement-scoped session (a `crossChainPermits` entry naming an
   * IntentExecutor layer) is always salted as in `'strict'`; `'v1'` is rejected.
   */
  saltMode?: 'none' | 'v1' | 'strict'
  /**
   * Pins a one-time-use id on the session (RHI-5798): the session settles at most
   * once per chain. Requires `policyAddresses.oneTimeUseId`; use a fresh random id
   * per session. Every intent the SDK prepares for the session burns the id first
   * on each chain it settles on; the policy refuses any settlement that does not.
   * Intents must list `sourceChains`, and cannot run destination calls on a chain
   * that is also one of several sources. A Permit2-route session must also supply `claimPolicies`, each
   * pinning its `spenders` (the arbiter); without them the session has no signing
   * surface and a `signing` mode is rejected.
   * `validUntil` (a future Date; omit for never) is the way to bound a session
   * in time: one deadline for the whole session, including its `permissions`,
   * `actions` and `crossChainPermits`. A `validUntil` on a permission function,
   * a raw `time-frame` action policy or a `crossChainPermits` entry is optional
   * and can only shorten it (the earliest applies); there is no per-function
   * deadline. Without `oneTimeUse` those fields throw, and `validAfter` always
   * does.
   * Always salted as in `'strict'`; `saltMode: 'v1'` is rejected.
   */
  oneTimeUse?: { id: bigint; validUntil?: Date }
  /**
   * The account this session is for. Required when a `CCTP` cross-chain permit
   * leaves its recipient as the account (the default), since the pin is a
   * literal address in the bridge call.
   */
  account?: Address
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
  /** The IntentExecutor layers a settlement-scoped permit restricted the session
   *  to. Metadata only — intents with the session are limited to them
   *  (`SAME_CHAIN_IE` adds no bridge filter). */
  settlementLayers?: readonly IntentExecutorSettlementLayer[]
  /** A one-time-use session's id and policy; each intent burns the id. */
  oneTimeUse?: { readonly id: bigint; readonly policy: Address }
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

interface RhinestoneAccountConfig {
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
}

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
   * runs for quotes that are never submitted. Receives the canonical
   * serialized intent input and must return a signed intent_extension_token
   * JWT whose sponsorship digest covers it.
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

type RhinestoneConfig = RhinestoneAccountConfig &
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

interface TokenRequestWithAmount {
  address: Address
  amount: bigint
}

interface TokenRequestWithoutAmount {
  address: Address
  amount?: undefined
}

type TokenRequest = TokenRequestWithAmount | TokenRequestWithoutAmount

type TokenRequests = [TokenRequestWithoutAmount] | TokenRequestWithAmount[]

interface NonEvmTokenRequestWithAmount {
  address: NonEvmAddress
  amount: bigint
}

interface NonEvmTokenRequestWithoutAmount {
  address: NonEvmAddress
  amount?: undefined
}

type NonEvmTokenRequest =
  | NonEvmTokenRequestWithAmount
  | NonEvmTokenRequestWithoutAmount

type NonEvmTokenRequests =
  | [NonEvmTokenRequestWithoutAmount]
  | NonEvmTokenRequestWithAmount[]

export type SimpleTokenList = Address[]

export type ChainTokenMap = Record<number, SimpleTokenList>

export type ExactInputConfig = {
  chain: Chain
  address: Address
  amount?: bigint
}

type SourceAssetInput = SimpleTokenList | ChainTokenMap | ExactInputConfig[]

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

interface BaseTransaction {
  calls?: CallInput[]
  /**
   * Per-chain executions to run on the source side, before the claim.
   * Keyed by chain ID (must be present in `sourceChains`, or equal the
   * target chain for same-chain transactions). Bundled into the intent
   * at routing time and covered by the user's mandate signature.
   *
   * Caveat: only executes if the orchestrator creates an element on the
   * matching chain — i.e. when the intent actually moves tokens from
   * that source. Sponsored / no-op fills with no source movement skip
   * the source element entirely, and `sourceCalls` keyed on that chain
   * are silently dropped.
   */
  sourceCalls?: Record<number, SourceCallInput[]>
  gasLimit?: bigint
  signers?: SignerSet
  sponsored?: Sponsorship
  eip7702InitSignature?: Hex
  sourceAssets?: SourceAssetInput
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
  auxiliaryFunds?: AuxiliaryFunds
  /**
   * What this transaction does on HyperCore, for a `hyperCorePerp` or
   * `hyperCoreSpot` destination: `openPerp`, `closePerp`, or a raw `action`.
   *
   * `openPerp` and `closePerp` are resolved while the transaction is prepared —
   * the asset index, the price and size grids, and the mark to price against
   * are read from Hyperliquid then, because the action has to be concrete
   * before the quote commits to it.
   */
  hyperCore?: HyperCoreOptions
  experimental_accountOverride?: {
    setupOps?: {
      to: Address
      data: Hex
    }[]
  }
}

interface SameChainTransaction extends BaseTransaction {
  chain: Chain
  tokenRequests?: TokenRequests
  recipient?: RhinestoneAccountConfig | Address
  /**
   * Absolute unix timestamp (seconds) overriding the on-chain fill deadline
   * (default 2 min). Same-chain only — the field lives on this type precisely
   * because the orchestrator honors it only on the same-chain (tokenless)
   * route; cross-chain transactions cannot set it. Must be between
   * `now + 120s` and `now + 86400s` (24h); out-of-range values are rejected
   * by the orchestrator with a `400`. When honored, the quoted `expiresAt`
   * and the bundle claim/nonce expiry track this value automatically.
   */
  customDeadline?: number
}

interface CrossChainEvmTransaction extends BaseTransaction {
  sourceChains?: Chain[]
  targetChain: Chain
  tokenRequests?: TokenRequests
  recipient?: RhinestoneAccountConfig | Address
}

// Non-EVM destinations (Solana, Tron). `recipient` and `tokenRequests`
// take chain-namespace-specific addresses; `RhinestoneAccountConfig` (an
// EVM smart account) is intentionally not accepted as a non-EVM recipient.
interface CrossChainNonEvmTransaction extends BaseTransaction {
  sourceChains?: Chain[]
  targetChain: NonEvmChain
  tokenRequests?: NonEvmTokenRequests
  recipient?: NonEvmAddress
}

type CrossChainTransaction =
  | CrossChainEvmTransaction
  | CrossChainNonEvmTransaction

interface UserOperationTransaction {
  calls: CallInput[]
  gasLimit?: bigint
  signers?: SignerSet
  chain: Chain
}

type Transaction = SameChainTransaction | CrossChainTransaction

export type {
  AccountProviderConfig,
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
  NonEvmTokenRequest,
  NonEvmTokenRequests,
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
  SingleSessionSignerSet,
  SourceAssetInput,
  SourceCallInput,
  SourceCallProvidedFunds,
  Sponsorship,
  StartaleAccount,
  SwapQuoter,
  SwapQuoterFilter,
  SwapScope,
  TokenRequest,
  TokenRequests,
  TokenSymbol,
  ToLeg,
  Transaction,
  UniversalActionPolicyParamCondition,
  UserOperationTransaction,
  WebauthnValidatorConfig,
}
