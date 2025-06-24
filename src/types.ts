import type { Account, Address, Chain, Hex } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'

interface AccountProviderConfig {
  type: 'safe' | 'nexus' | 'kernel'
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

export type {
  RhinestoneAccountConfig,
  AccountProviderConfig,
  BundlerConfig,
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
}
