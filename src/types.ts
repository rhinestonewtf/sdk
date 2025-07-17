import type { Account, Address, Chain, Hex } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { EnableSessionData } from './modules/validators/smart-sessions'

type AccountType = 'safe' | 'nexus' | 'kernel'

interface AccountProviderConfig {
  type: AccountType
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

interface MultiFactorValidatorConfig {
  type: 'multi-factor'
  validators: (OwnableValidatorConfig | WebauthnValidatorConfig)[]
  threshold?: number
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
  rhinestoneApiKey: string
  deployerAccount?: Account
  sessions?: Session[]
  recovery?: Recovery
  eoa?: Account
  provider?: ProviderConfig
  bundler?: BundlerConfig
  paymaster?: PaymasterConfig
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
            account: WebAuthnAccount
          }
      )[]
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
  calls: CallInput[]
  tokenRequests?: TokenRequest[]
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
  OwnerSet,
  OwnableValidatorConfig,
  WebauthnValidatorConfig,
  MultiFactorValidatorConfig,
  SignerSet,
  Session,
  Recovery,
  Policy,
  UniversalActionPolicyParamCondition,
}
