import type { Abi, AbiFunction, Account, Address, Chain, Hex } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { ModuleType } from './modules/common'
import type {
  AuxiliaryFunds,
  SettlementLayerFilter,
} from './orchestrator/types'

type AccountType = 'safe' | 'nexus' | 'kernel' | 'startale' | 'eoa'

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

interface EoaAccount {
  type: 'eoa'
}

type AccountProviderConfig =
  | SafeAccount
  | NexusAccount
  | KernelAccount
  | StartaleAccount
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

type Policy =
  | SudoPolicy
  | UniversalActionPolicy
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

interface ParamConstraint<TValue> {
  condition: UniversalActionPolicyParamCondition
  value: TValue
  usageLimit?: bigint
}

interface PermissionFunctionConfig<TFn extends AbiFunction> {
  policies?: Policy[]
  valueLimitPerUse?: bigint
  params?: {
    [K in NamedInputs<TFn>['name']]?: ParamConstraint<ParamValue<TFn, K>>
  }
}

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

interface SessionDefinition<TAbis extends readonly Abi[] = readonly Abi[]> {
  chain: Chain
  owners: OwnerSet
  permissions?: readonly [...PermissionsForAbis<TAbis>]
  claimPolicies?: readonly Permit2ClaimPolicy[]
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

interface Recovery {
  guardians: Account[]
  threshold?: number
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
  verifyExecutions?: boolean
}

interface SingleSessionSignerSet {
  type: 'experimental_session'
  session: Session
  enableData?: SessionEnableData
  verifyExecutions?: boolean
}

interface PerChainSessionSignerSet {
  type: 'experimental_session'
  sessions: Record<number, ChainSessionConfig>
  verifyExecutions?: boolean
}

type SessionSignerSet = SingleSessionSignerSet | PerChainSessionSignerSet

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
    }

interface BaseTransaction {
  calls?: CallInput[]
  tokenRequests?: TokenRequests
  recipient?: RhinestoneAccountConfig | Address
  gasLimit?: bigint
  signers?: SignerSet
  sponsored?: Sponsorship
  eip7702InitSignature?: Hex
  sourceAssets?: SourceAssetInput
  feeAsset?: Address | TokenSymbol
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
}

interface CrossChainTransaction extends BaseTransaction {
  sourceChains?: Chain[]
  targetChain: Chain
}

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
  CallResolveContext,
  Call,
  Sponsorship,
  TokenRequest,
  TokenRequests,
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
  Recovery,
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
  UniversalActionPolicyParamCondition,
  ApiKeyAuth,
  JwtAuth,
  AuthConfig,
}
