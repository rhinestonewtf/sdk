import type { Account, Address, Chain, Hex } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { EnableSessionData } from './modules/validators/smart-sessions'
import type { SettlementLayer } from './orchestrator/types'

type AccountType = 'safe' | 'nexus' | 'kernel' | 'startale' | 'custom'

interface SafeAccount {
  type: 'safe'
  version?: '1.4.1'
  adapter?: '1.0.0' | '2.0.0'
}

interface NexusAccount {
  type: 'nexus'
  version?: '1.0.2' | '1.2.0' | 'rhinestone-1.0.0-beta' | 'rhinestone-1.0.0'
}

interface KernelAccount {
  type: 'kernel'
  version?: '3.1' | '3.2' | '3.3'
}

interface StartaleAccount {
  type: 'startale'
}

type AccountProviderConfig =
  | SafeAccount
  | NexusAccount
  | KernelAccount
  | StartaleAccount

interface OwnableValidatorConfig {
  type: 'ecdsa'
  accounts: Account[]
  threshold?: number
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
  validators: (OwnableValidatorConfig | WebauthnValidatorConfig)[]
  threshold?: number
  module?: Address
}

interface ProviderConfig {
  type: 'alchemy'
  apiKey: string
}

interface BundlerConfig {
  type: 'pimlico' | 'biconomy'
  apiKey: string
}

interface PaymasterConfig {
  type: 'pimlico' | 'biconomy'
  apiKey: string
}

type OwnerSet =
  | OwnableValidatorConfig
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

type Policy =
  | SudoPolicy
  | UniversalActionPolicy
  | SpendingLimitsPolicy
  | TimeFramePolicy
  | UsageLimitPolicy
  | ValueLimitPolicy

interface Action {
  target: Address
  selector: Hex
  policies?: [Policy, ...Policy[]]
}

interface Session {
  owners: OwnerSet
  policies?: [Policy, ...Policy[]]
  actions?: [Action, ...Action[]]
  salt?: Hex
  chain?: Chain
}

interface Recovery {
  guardians: Account[]
  threshold?: number
}

interface RhinestoneAccountConfig {
  account?: AccountProviderConfig
  owners: OwnerSet
  rhinestoneApiKey?: string
  sessions?: Session[]
  recovery?: Recovery
  eoa?: Account
  initData?: {
    address: Address
    factory: Address
    factoryData: Hex
    intentExecutorInstalled: boolean
  }
  provider?: ProviderConfig
  bundler?: BundlerConfig
  paymaster?: PaymasterConfig
  /** Optional: provider that returns allocatorSig for Emissary digest (contract allocator). */
  allocatorSigProvider?: (args: {
    digest: Hex
    chainId: number
    emissary: Address
    account: Address
    lockTag: Hex
    expires: bigint
    sender: Address
  }) => Promise<Hex>
  /**
   * @internal
   * Optional orchestrator URL override for internal testing - do not use
   */
  orchestratorUrl?: string
}

type TokenSymbol = 'ETH' | 'WETH' | 'USDC' | 'USDT'

interface CallInput {
  to: Address | TokenSymbol
  data?: Hex
  value?: bigint
}

interface Call {
  to: Address
  data: Hex
  value: bigint
}

interface TokenRequest {
  address: Address | TokenSymbol
  amount: bigint
}

type SourceAssetInput =
  | (Address | TokenSymbol)[]
  | {
      [chainId in number]?: (Address | TokenSymbol)[]
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

interface SessionSignerSet {
  type: 'session'
  session: Session
  enableData?: EnableSessionData
}

interface GuardiansSignerSet {
  type: 'guardians'
  guardians: Account[]
}

type SignerSet = OwnerSignerSet | SessionSignerSet | GuardiansSignerSet

interface Session {
  owners: OwnerSet
  policies?: [Policy, ...Policy[]]
  actions?: [Action, ...Action[]]
  salt?: Hex
  chain?: Chain
  emissary?: {
    configId: number
    allocator: Address
    scope: number
    resetPeriod: number
    validator: Address
    validatorConfig: Hex
    /**
     * Optional emissary contract address. If not provided, uses default from SDK.
     */
    emissaryAddress?: Address
    /**
     * Optional private key for the allocator EOA to sign emissary enable payloads.
     * If provided, the SDK will generate allocatorSig automatically.
     */
    allocatorPrivateKey?: Hex
  }
}

// Add emissary-specific types - Updated to match contract exactly
interface SmartSessionEmissaryConfig {
  sender: Address
  scope: number
  resetPeriod: number
  allocator: Address
  permissionId: Hex // bytes32
}

interface SmartSessionEmissaryEnable {
  allocatorSig: Hex
  userSig: Hex
  expires: bigint
  session: EnableSession
}

interface EnableSession {
  chainDigestIndex: number
  hashesAndChainIds: ChainDigest[]
  sessionToEnable: SessionStruct
}

interface ChainDigest {
  chainId: bigint
  sessionDigest: Hex
}

interface PolicyData {
  policy: Address
  initData: Hex
}

interface ActionData {
  actionTargetSelector: Hex // bytes4
  actionTarget: Address
  actionPolicies: PolicyData[]
}

interface SessionStruct {
  sessionValidator: Address
  sessionValidatorInitData: Hex
  salt: Hex
  erc1271Policies: PolicyData[]
  actions: ActionData[]
}

interface BaseTransaction {
  calls: CallInput[]
  tokenRequests?: TokenRequest[]
  gasLimit?: bigint
  signers?: SignerSet
  sponsored?: boolean
  eip7702InitSignature?: Hex
  sourceAssets?: SourceAssetInput
  feeAsset?: Address | TokenSymbol
  settlementLayers?: SettlementLayer[]
  lockFunds?: boolean
}

interface SameChainTransaction extends BaseTransaction {
  chain: Chain
}

interface CrossChainTransaction extends BaseTransaction {
  sourceChains?: Chain[]
  targetChain: Chain
}

type Transaction = SameChainTransaction | CrossChainTransaction

export type {
  AccountType,
  RhinestoneAccountConfig,
  AccountProviderConfig,
  ProviderConfig,
  BundlerConfig,
  PaymasterConfig,
  Transaction,
  TokenSymbol,
  CallInput,
  Call,
  TokenRequest,
  SourceAssetInput,
  OwnerSet,
  OwnableValidatorConfig,
  WebauthnValidatorConfig,
  MultiFactorValidatorConfig,
  SignerSet,
  Session,
  Recovery,
  Policy,
  UniversalActionPolicyParamCondition,
  SmartSessionEmissaryConfig,
  SmartSessionEmissaryEnable,
  EnableSession,
  ChainDigest,
  SessionStruct,
  PolicyData,
  ActionData,
}
