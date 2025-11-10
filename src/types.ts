import type { Account, Address, Chain, Hex } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { EnableSessionData } from './modules/validators/smart-sessions'
import type {
  Account as OrchestratorAccount,
  SettlementLayer,
} from './orchestrator/types'

type AccountType = 'safe' | 'nexus' | 'kernel' | 'startale' | 'passport' | 'eoa'

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

interface PassportAccount {
  type: 'passport'
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
  chain?: Chain
  policies?: [Policy, ...Policy[]]
  actions?: [Action, ...Action[]]
  signing?: {
    allowedContent: {
      domainSeparator: string
      contentName: string[]
    }[]
    policies?: [Policy, ...Policy[]]
  }
  salt?: Hex
}

interface Recovery {
  guardians: Account[]
  threshold?: number
}

interface RhinestoneAccountConfig {
  account?: AccountProviderConfig
  owners?: OwnerSet
  sessions?: Session[]
  recovery?: Recovery
  eoa?: Account
  initData?: {
    address: Address
    factory: Address
    factoryData: Hex
    intentExecutorInstalled: boolean
  }
}

interface RhinestoneSDKConfig {
  apiKey?: string
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
}

type RhinestoneConfig = RhinestoneAccountConfig & RhinestoneSDKConfig

type TokenSymbol = 'ETH' | 'WETH' | 'USDC' | 'USDT'

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

interface BaseTransaction {
  calls?: CallInput[]
  tokenRequests?: TokenRequest[]
  recipient?: OrchestratorAccount
  gasLimit?: bigint
  signers?: SignerSet
  sponsored?: boolean
  eip7702InitSignature?: Hex
  sourceAssets?: SourceAssetInput
  feeAsset?: Address | TokenSymbol
  settlementLayers?: SettlementLayer[]
  lockFunds?: boolean
  dryRun?: boolean
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
  TokenRequest,
  SourceAssetInput,
  OwnerSet,
  OwnableValidatorConfig,
  ENSValidatorConfig,
  WebauthnValidatorConfig,
  MultiFactorValidatorConfig,
  SignerSet,
  Session,
  Recovery,
  Policy,
  UniversalActionPolicyParamCondition,
}
