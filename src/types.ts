import type { Abi, AbiFunction, Account, Address, Chain, Hex } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { ModuleType } from './modules/common'
import type { NonEvmAddress, NonEvmChain } from './orchestrator/destinations'
import type {
  AppFeeRate,
  AuxiliaryFunds,
  SettlementLayerFilter,
} from './orchestrator/types'

type AccountType = 'safe' | 'nexus' | 'kernel' | 'startale' | 'eoa' | 'hca'

interface SafeAccount {
  type: 'safe'
  version?: '1.4.1'
  adapter?: '1.0.0' | '2.0.0'
  nonce?: bigint
}

interface NexusAccount {
  type: 'nexus'
  version?: '1.0.2' | '1.2.0' | 'rhinestone-1.0.0-beta' | 'rhinestone-1.0.0'
  salt?: Hex
}

interface KernelAccount {
  type: 'kernel'
  version?: '3.1' | '3.2' | '3.3'
  salt?: Hex
}

interface StartaleAccount {
  type: 'startale'
  salt?: Hex
}

interface HcaAccount {
  type: 'hca'
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

interface ENSValidatorConfig {
  type: 'ens'
  accounts: Account[]
  threshold?: number
  ownerExpirations: number[]
  module?: Address
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

type ProviderConfig =
  | {
      type: 'alchemy'
      apiKey: string
    }
  | {
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
 * Each value maps to one or more Permit2 arbiter addresses sourced from
 * `@rhinestone/shared-configs` — devs pick a layer, the SDK resolves it
 * to the on-chain arbiter whitelist.
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
 * plus optional {@link SpendingLimitsPolicy} / {@link TimeFramePolicy}
 * entries on the fallback action — the claim policy itself doesn't
 * enforce amounts or expiry on-chain, so we lift those guarantees into
 * action-level policies that do.
 *
 * @internal Resolved from {@link CrossChainPermissionInput} by the SDK;
 * consumers set `SessionDefinition.crossChainPermits` with the input
 * shape, not this one.
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
   * every known arbiter from `@rhinestone/shared-configs`.
   */
  settlementLayers?: CrossChainSettlementLayer[]
}

interface FromLeg {
  chain: Chain
  token: Address | TokenSymbol
  maxAmount?: bigint
}

interface ToLeg {
  chain: Chain
  token: Address | TokenSymbol
  recipient?: Address | 'any'
}

/**
 * Ergonomic input for a cross-chain session permit. Set on
 * `SessionDefinition.crossChainPermits`; the SDK resolves token symbols
 * to per-chain addresses and `Date`s to on-chain deadlines, then expands
 * each entry into a {@link Permit2ClaimPolicy} (claim-side) plus optional
 * {@link SpendingLimitsPolicy} / {@link TimeFramePolicy} guardrails.
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
  /** Per-destination fill-deadline windows — unix seconds. */
  fillDeadline?: { chain: Chain; min?: bigint; max?: bigint }[]
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
   * resolves to the union of every known arbiter from
   * `@rhinestone/shared-configs`. Pass a subset (e.g. `['ECO']`) to
   * narrow.
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
type AbiTypeToValue<T extends string> = T extends 'address'
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

// A constraint on a single named parameter. Two shapes:
//   - { condition, value, usageLimit? } : single comparison (AND-conjunctive,
//     emits universal-action when every param uses this form)
//   - { anyOf: [v1, v2, ...] }           : OR of EQUAL rules (allowlist) —
//     forces the function to emit arg-policy
type ParamConstraint<TValue> =
  | {
      condition: UniversalActionPolicyParamCondition
      value: TValue
      usageLimit?: bigint
      anyOf?: never
    }
  | {
      anyOf: readonly [TValue, ...TValue[]]
      condition?: never
      value?: never
      usageLimit?: never
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
   * Upper bound on `block.timestamp` (Date or ms-epoch). Pairs with
   * `validAfter` into one `time-frame` policy. If only one of the two is set,
   * the other defaults to "always passes" (validAfter=0 / validUntil=year-2100).
   */
  validUntil?: Date | number
  /** Lower bound on `block.timestamp` (Date or ms-epoch). See `validUntil`. */
  validAfter?: Date | number
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

interface SessionDefinition<TAbis extends readonly Abi[] = readonly Abi[]> {
  chain: Chain
  owners: OwnerSet
  permissions?: readonly [...PermissionsForAbis<TAbis>]
  claimPolicies?: readonly Permit2ClaimPolicy[]
  /**
   * Cross-chain permits expanded by the SDK into matching
   * {@link Permit2ClaimPolicy} (claim-side) plus action-level
   * {@link SpendingLimitsPolicy} / {@link TimeFramePolicy} guardrails.
   * See {@link CrossChainPermissionInput}.
   */
  crossChainPermits?: readonly CrossChainPermissionInput[]
  /**
   * Override one or more SmartSession policy addresses. Defaults to the latest
   * V2 deployments. Use to pin to V1 deployments for an account that already
   * has sessions enabled against them.
   */
  policyAddresses?: SessionPolicyAddresses
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
}

interface ModuleInput {
  type: ModuleType
  address: Address
  initData?: Hex
  deInitData?: Hex
  additionalContext?: Hex
}

interface RhinestoneAccountConfig {
  account?: AccountProviderConfig
  owners?: OwnerSet
  experimental_sessions?: {
    enabled: boolean
    module?: Address
    compatibilityFallback?: Address
  }
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
   * Called when submitting a sponsored intent. Receives the raw intent
   * input object and must return a signed intent_extension_token JWT.
   */
  getIntentExtensionToken?: (intentInput: unknown) => Promise<string>
}

type AuthConfig = ApiKeyAuth | JwtAuth

interface RhinestoneSDKConfigBase {
  provider?: ProviderConfig
  bundler?: BundlerConfig
  paymaster?: PaymasterConfig
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
    _authProvider?: import('./auth/provider').AuthProvider
  }

type TokenSymbol = 'ETH' | 'WETH' | 'USDC' | 'USDT' | 'USDT0'

interface CalldataInput {
  to: Address | TokenSymbol
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
  address: Address | TokenSymbol
  amount: bigint
}

interface TokenRequestWithoutAmount {
  address: Address | TokenSymbol
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

export type SimpleTokenList = (Address | TokenSymbol)[]

export type ChainTokenMap = Record<number, SimpleTokenList>

export type ExactInputConfig = {
  chain: Chain
  address: Address | TokenSymbol
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
  type: 'experimental_session'
  session: Session
  enableData?: SessionEnableData
}

interface PerChainSessionSignerSet {
  type: 'experimental_session'
  sessions: Record<number, ChainSessionConfig>
}

type SessionSignerSet = SingleSessionSignerSet | PerChainSessionSignerSet

type SignerSet = OwnerSignerSet | SessionSignerSet

type Sponsorship =
  | boolean
  | {
      gas: boolean
      bridging: boolean
      swaps: boolean
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
  feeAsset?: Address | TokenSymbol
  appFees?: AppFeeRate
  settlementLayers?: SettlementLayerFilter
  auxiliaryFunds?: AuxiliaryFunds
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
  AccountType,
  SafeAccount,
  NexusAccount,
  KernelAccount,
  StartaleAccount,
  HcaAccount,
  EoaAccount,
  RhinestoneAccountConfig,
  RhinestoneSDKConfig,
  RhinestoneConfig,
  AccountProviderConfig,
  ProviderConfig,
  BundlerConfig,
  PaymasterConfig,
  Transaction,
  UserOperationTransaction,
  TokenSymbol,
  CalldataInput,
  LazyCallInput,
  CallInput,
  SourceCallProvidedFunds,
  SourceCallInput,
  CallResolveContext,
  Call,
  Sponsorship,
  TokenRequest,
  TokenRequests,
  NonEvmTokenRequest,
  NonEvmTokenRequests,
  SourceAssetInput,
  OwnerSet,
  OwnableValidatorConfig,
  ENSValidatorConfig,
  WebauthnValidatorConfig,
  MultiFactorValidatorConfig,
  SignerSet,
  ChainSessionConfig,
  SingleSessionSignerSet,
  PerChainSessionSignerSet,
  SessionSignerSet,
  SessionDefinition,
  SessionInput,
  SessionEnableData,
  Session,
  ModuleType,
  ModuleInput,
  Action,
  ScopedAction,
  FallbackAction,
  Permission,
  PermissionsForAbis,
  PermissionFunctionConfig,
  ParamConstraint,
  ResolvedAction,
  ResolvedERC7739Content,
  ResolvedERC7739Policies,
  ResolvedPolicy,
  Policy,
  Permit2ClaimPolicy,
  CrossChainPermit,
  CrossChainPermissionInput,
  FromLeg,
  ToLeg,
  CrossChainSettlementLayer,
  UniversalActionPolicyParamCondition,
  ArgPolicyExpression,
  SessionPolicyAddresses,
  ApiKeyAuth,
  JwtAuth,
  AuthConfig,
}
