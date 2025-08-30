import type { Account, Address, Chain, Hex } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { ValidatorConfig } from './accounts/utils'
import type { Module } from './modules/common'
import type { EnableSessionData } from './modules/validators/smart-sessions'

type AccountType = 'safe' | 'nexus' | 'kernel'

type AccountProviderConfig =
  | {
      type: AccountType
    }
  | {
      type: 'custom'
      custom: CustomAccountProviderConfig
    }

interface CustomAccountProviderConfig {
  getDeployArgs: () => {
    factory: Address
    factoryData: Hex
    implementation: Address
    initializationCallData: Hex | null
  }
  getInstallData: (module: Module) => Hex[]
  getAddress: () => Address
  getPackedSignature: (
    signFn: (message: Hex) => Promise<Hex>,
    hash: Hex,
    validator: ValidatorConfig,
    transformSignature: (signature: Hex) => Hex,
  ) => Promise<Hex>
  getSessionStubSignature: (
    session: Session,
    enableData: EnableSessionData | null,
  ) => Promise<Hex>
  signSessionUserOperation: (
    session: Session,
    enableData: EnableSessionData | null,
    hash: Hex,
  ) => Promise<Hex>
  getStubSignature: () => Promise<Hex>
  sign: (hash: Hex) => Promise<Hex>
  get7702InitCalls: () => {
    to: Address
    data: Hex
  }[]
}

interface OwnableValidatorConfig {
  type: 'ecdsa'
  accounts: Account[]
  threshold?: number
}

interface WebauthnValidatorConfig {
  type: 'passkey'
  account: WebAuthnAccount
}

interface BundlerConfig {
  type: 'pimlico'
  apiKey: string
}

interface PaymasterConfig {
  type: 'pimlico'
  apiKey: string
}

type OwnerSet = OwnableValidatorConfig | WebauthnValidatorConfig

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
  rhinestoneApiKey: string
  deployerAccount?: Account
  sessions?: Session[]
  recovery?: Recovery
  eoa?: Account
  provider?: {
    type: 'alchemy'
    apiKey: string
  }
  bundler?: BundlerConfig
  paymaster?: PaymasterConfig
}

interface Call {
  to: Address
  data?: Hex
  value?: bigint
}

/**
 * @deprecated Use the `Call` type instead.
 */
type Execution = Call

interface TokenRequest {
  address: Address
  amount: bigint
}

type OwnerSignerSet =
  | {
      type: 'owner'
      kind: 'ecdsa'
      accounts: Account[]
    }
  | {
      type: 'owner'
      kind: 'passkey'
      account: WebAuthnAccount
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
  calls: Call[]
  tokenRequests: TokenRequest[]
  gasLimit?: bigint
  signers?: SignerSet
}

interface SameChainTransaction extends BaseTransaction {
  chain: Chain
}

interface CrossChainTransaction extends BaseTransaction {
  sourceChain?: Chain
  targetChain: Chain
}

type Transaction = SameChainTransaction | CrossChainTransaction

interface ProviderConfig {
  type: 'alchemy'
  apiKey: string
}

export type {
  AccountType,
  RhinestoneAccountConfig,
  AccountProviderConfig,
  BundlerConfig,
  PaymasterConfig,
  Transaction,
  Call,
  Execution,
  TokenRequest,
  OwnerSet,
  OwnableValidatorConfig,
  WebauthnValidatorConfig,
  SignerSet,
  Session,
  Recovery,
  Policy,
  UniversalActionPolicyParamCondition,
  ProviderConfig,
}
