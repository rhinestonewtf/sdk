import type { Account, Address, Chain, Hex } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { ModuleType } from './modules/common'
import type {
  AppFeeRate,
  AuxiliaryFunds,
  ProtocolFeeRate,
  SettlementLayer,
} from './orchestrator/types'

type AccountType =
  | 'safe'
  | 'nexus'
  | 'kernel'
  | 'startale'
  | 'passport'
  | 'eoa'
  | 'hca'

interface SafeAccount {
  type: 'safe'
  version?: '1.4.1'
  adapter?: '1.0.0' | '2.0.0'
  nonce?: bigint
}

interface NexusAccount {
  type: 'nexus'
  version?:
    | '1.0.2'
    | '1.2.0'
    | '1.2.1'
    | 'rhinestone-1.0.0-beta'
    | 'rhinestone-1.0.0'
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

interface PassportAccount {
  type: 'passport'
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
  | PassportAccount
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
  type: 'permit2-claim'
  /** Whitelisted Permit2 spender addresses */
  arbiters?: Address[]
  /** Permitted input tokens per origin chain */
  tokensIn?: { chainId: number; token: Address }[]
  /** Permitted output tokens per destination chain */
  tokensOut?: { chainId: number; token: Address }[]
  /** Permitted recipients per destination chain (use `'any'` to allow all) */
  recipients?: { chainId: number; recipient: Address | 'any' }[]
  /** Enforce that recipient === sponsor (bridge-to-self) */
  recipientIsSponsor?: boolean
  /** Deadline bounds (min/max unix timestamps) */
  expiryBounds?: { min?: bigint; max?: bigint }
  /** Fill expiry bounds per destination chain */
  fillExpiryBounds?: { chainId: number; min?: bigint; max?: bigint }[]
}

type Policy =
  | SudoPolicy
  | UniversalActionPolicy
  | SpendingLimitsPolicy
  | TimeFramePolicy
  | UsageLimitPolicy
  | ValueLimitPolicy
  | IntentExecutionPolicy

interface FallbackAction {
  policies?: Policy[]
}

interface ScopedAction {
  target: Address
  selector: Hex
  policies?: Policy[]
}

type Action = FallbackAction | ScopedAction

interface SessionInput {
  owners: OwnerSet
  actions?: Action[]
  claimPolicies?: [Permit2ClaimPolicy]
}

interface Session extends SessionInput {
  chain: Chain
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
   * Called at submitIntent time when the intent is sponsored.
   * Receives the raw intent input object.
   * Must return a signed intent_extension_token JWT.
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
  sourceCalls?: Record<number, CallInput[]>
  tokenRequests?: TokenRequests
  recipient?: RhinestoneAccountConfig | Address
  gasLimit?: bigint
  signers?: SignerSet
  sponsored?: Sponsorship
  eip7702InitSignature?: Hex
  sourceAssets?: SourceAssetInput
  feeAsset?: Address | TokenSymbol
  appFees?: AppFeeRate
  /**
   * Absolute unix timestamp (seconds) overriding the on-chain fill deadline.
   * Honored only on the tokenless (same-chain / no-funding) route and silently
   * ignored on every other route. Must be between `now + 120s` and
   * `now + 86400s` (24h); out-of-range values are rejected by the orchestrator
   * with a `400`. When honored, the quoted `expiresAt` and the bundle
   * claim/nonce expiry track this value automatically.
   */
  customDeadline?: number
  protocolFees?: ProtocolFeeRate
  settlementLayers?: SettlementLayer[]
  lockFunds?: boolean
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
  AccountProviderConfig,
  AccountType,
  Action,
  ApiKeyAuth,
  AuthConfig,
  BundlerConfig,
  Call,
  CalldataInput,
  CallInput,
  CallResolveContext,
  ChainSessionConfig,
  ENSValidatorConfig,
  EoaAccount,
  HcaAccount,
  JwtAuth,
  KernelAccount,
  LazyCallInput,
  ModuleInput,
  ModuleType,
  MultiFactorValidatorConfig,
  NexusAccount,
  OwnableValidatorConfig,
  OwnerSet,
  PassportAccount,
  PaymasterConfig,
  PerChainSessionSignerSet,
  Permit2ClaimPolicy,
  Policy,
  ProviderConfig,
  Recovery,
  RhinestoneAccountConfig,
  RhinestoneConfig,
  RhinestoneSDKConfig,
  SafeAccount,
  Session,
  SessionEnableData,
  SessionInput,
  SessionSignerSet,
  SignerSet,
  SingleSessionSignerSet,
  SourceAssetInput,
  Sponsorship,
  StartaleAccount,
  TokenRequest,
  TokenRequests,
  TokenSymbol,
  Transaction,
  UniversalActionPolicyParamCondition,
  UserOperationTransaction,
  WebauthnValidatorConfig,
}
