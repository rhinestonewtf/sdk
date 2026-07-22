import type {
  Address,
  Hex,
  SignableMessage,
  SignedAuthorization,
  TypedDataDefinition,
} from 'viem'
import type { ChainReference, EvmChainReference } from '../chains/types'
import type { BundlerPort } from '../clients/bundler/port'
import type { OrchestratorPort } from '../clients/orchestrator/port'
import type {
  OrchestratorAppFeeBalances,
  OrchestratorPortfolio,
} from '../clients/orchestrator/types'
import type { PaymasterPort } from '../clients/paymaster/port'
import type { RpcPort } from '../clients/rpc/port'
import type {
  AccountInvocationContext,
  ResolvedSdkConfig,
} from '../config/resolved'
import type {
  Session,
  SessionDetails,
} from '../modules/validators/smart-sessions/types'
import type { IndependentOwnerSignature } from '../signing/intent-plans/independent'
import type {
  OwnerSignerSelection,
  SignerInvocationPort,
  SigningTranscript,
} from '../signing/types'
import type {
  IntentInput,
  IntentSessionSelection,
  IntentStatus,
  PreparedIntent,
  SignedIntent,
  SubmittedIntent,
} from '../transactions/intents/types'
import type {
  PreparedUserOperation,
  SignedUserOperation,
  SubmittedUserOperation,
  UserOperationInput,
  UserOperationStatus,
} from '../transactions/user-operations/types'

export interface ClockPort {
  readonly now: () => number
  readonly sleep: (milliseconds: number) => Promise<void>
}

export interface CoreDependencies {
  readonly orchestrator: OrchestratorPort
  readonly rpc: RpcPort
  readonly bundler?: BundlerPort
  readonly paymaster?: PaymasterPort
  readonly signerInvoker?: SignerInvocationPort
  readonly clock: ClockPort
}

export type AccountDependencyResolver<CompatibilityConfig = unknown> = (
  context: AccountInvocationContext<CompatibilityConfig>,
) => CoreDependencies

export interface ProjectWorkflows {
  readonly getIntentStatus: (intentId: string) => Promise<IntentStatus>
  readonly splitIntents: OrchestratorPort['splitIntents']
  readonly getAppFeeBalances: () => Promise<OrchestratorAppFeeBalances>
}

export interface AccountWorkflows<CompatibilityConfig = unknown> {
  readonly getAddress: (
    context: AccountInvocationContext<CompatibilityConfig>,
    chain: import('../chains/types').EvmChainReference,
  ) => import('viem').Address
  readonly signMessage: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: {
      readonly message: SignableMessage
      readonly chain: import('../chains/types').EvmChainReference
      readonly signers?: OwnerSignerSelection | IntentSessionSelection
    },
  ) => Promise<{
    readonly signature: Hex
    readonly transcript: SigningTranscript
  }>
  readonly signTypedData: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: {
      readonly typedData: TypedDataDefinition
      readonly chain: import('../chains/types').EvmChainReference
      readonly signers?: OwnerSignerSelection | IntentSessionSelection
    },
  ) => Promise<{
    readonly signature: Hex
    readonly transcript: SigningTranscript
  }>
  readonly signEip7702InitData: (
    context: AccountInvocationContext<CompatibilityConfig>,
    chain: import('../chains/types').EvmChainReference,
  ) => Promise<{
    readonly signature: Hex
    readonly transcript: SigningTranscript
  }>
  readonly signAuthorizations: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: {
      readonly chains: readonly import('../chains/types').ChainReference[]
      readonly eip7702InitSignature?: Hex
    },
  ) => Promise<{
    readonly authorizations: readonly SignedAuthorization[]
    readonly transcript?: SigningTranscript
  }>
  readonly prepareIntent: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: IntentInput<CompatibilityConfig>,
  ) => Promise<PreparedIntent<CompatibilityConfig>>
  readonly signIntent: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: PreparedIntent<CompatibilityConfig>,
  ) => Promise<{
    readonly intent: SignedIntent<CompatibilityConfig>
    readonly transcript: SigningTranscript
  }>
  readonly signIntentAsOwner: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: PreparedIntent<CompatibilityConfig>,
    selection: {
      readonly signerId: string
      readonly validatorId?: number | Hex
    },
  ) => Promise<IndependentOwnerSignature>
  readonly assembleIntent: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: PreparedIntent<CompatibilityConfig>,
    signatures: readonly IndependentOwnerSignature[],
  ) => Promise<SignedIntent<CompatibilityConfig>>
  readonly submitIntent: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: SignedIntent<CompatibilityConfig>,
  ) => Promise<SubmittedIntent>
  readonly sendIntent: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: IntentInput<CompatibilityConfig>,
  ) => Promise<SubmittedIntent>
  readonly waitForIntentStatus: (
    context: AccountInvocationContext<CompatibilityConfig>,
    intentId: string,
  ) => Promise<IntentStatus>
  readonly prepareUserOperation: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: UserOperationInput<CompatibilityConfig>,
  ) => Promise<PreparedUserOperation<CompatibilityConfig>>
  readonly signUserOperation: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: PreparedUserOperation<CompatibilityConfig>,
  ) => Promise<SignedUserOperation<CompatibilityConfig>>
  readonly submitUserOperation: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: SignedUserOperation<CompatibilityConfig>,
  ) => Promise<SubmittedUserOperation>
  readonly sendUserOperation: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: UserOperationInput<CompatibilityConfig>,
  ) => Promise<SubmittedUserOperation>
  readonly getUserOperationStatus: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: SubmittedUserOperation,
  ) => Promise<UserOperationStatus>
  readonly waitForUserOperationStatus: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: SubmittedUserOperation,
  ) => Promise<UserOperationStatus>
  readonly reconstructPreparedUserOperation: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: {
      readonly chain: EvmChainReference
      readonly operation: PreparedUserOperation<CompatibilityConfig>['operation']
    },
  ) => Promise<PreparedUserOperation<CompatibilityConfig>>
  readonly reconstructSignedUserOperation: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: {
      readonly chain: EvmChainReference
      readonly operation: PreparedUserOperation<CompatibilityConfig>['operation']
      readonly signature: Hex
    },
  ) => Promise<SignedUserOperation<CompatibilityConfig>>
  readonly getPortfolio: (
    context: AccountInvocationContext<CompatibilityConfig>,
    onTestnets?: boolean,
  ) => Promise<OrchestratorPortfolio>
  readonly getInitData: (
    context: AccountInvocationContext<CompatibilityConfig>,
  ) => { readonly factory: Address; readonly factoryData: Hex }
  readonly isDeployed: (
    context: AccountInvocationContext<CompatibilityConfig>,
    chain: EvmChainReference,
  ) => Promise<boolean>
  readonly deploy: (
    context: AccountInvocationContext<CompatibilityConfig>,
    chain: EvmChainReference,
    options?: {
      readonly sponsored?: boolean
      readonly eip7702InitSignature?: Hex
    },
  ) => Promise<boolean>
  readonly setup: (
    context: AccountInvocationContext<CompatibilityConfig>,
    chain: EvmChainReference,
  ) => Promise<boolean>
  readonly getTransactionMessages: (
    prepared: PreparedIntent<CompatibilityConfig>,
  ) => IntentMessages
  readonly reconstructPreparedIntent: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: {
      readonly traceId: string
      readonly quote: PreparedIntent<CompatibilityConfig>['quote']
      readonly quotes: PreparedIntent<CompatibilityConfig>['quotes']
      readonly request: PreparedIntent<CompatibilityConfig>['request']
      readonly intentInput: IntentInput<CompatibilityConfig>
    },
  ) => Promise<PreparedIntent<CompatibilityConfig>>
  readonly signIntentFromSignData: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: {
      readonly signData: IntentMessages
      readonly targetChain: ChainReference
      readonly signers?: OwnerSignerSelection | IntentSessionSelection
    },
  ) => Promise<{
    readonly originSignatures: SignedIntent<CompatibilityConfig>['originSignatures']
    readonly destinationSignature: Hex
    readonly targetExecutionSignature: Hex | undefined
    readonly transcript: SigningTranscript
  }>
  readonly getOwners: (
    context: AccountInvocationContext<CompatibilityConfig>,
    chain: EvmChainReference,
  ) => Promise<{
    readonly accounts: readonly Address[]
    readonly threshold: number
  } | null>
  readonly getValidators: (
    context: AccountInvocationContext<CompatibilityConfig>,
    chain: EvmChainReference,
  ) => Promise<readonly Address[]>
  readonly getExecutors: (
    context: AccountInvocationContext<CompatibilityConfig>,
    chain: EvmChainReference,
  ) => Promise<readonly Address[]>
  readonly getSessionDetails: (
    context: AccountInvocationContext<CompatibilityConfig>,
    sessions: readonly Session[],
  ) => Promise<SessionDetails>
  readonly isSessionEnabled: (
    context: AccountInvocationContext<CompatibilityConfig>,
    session: Session,
  ) => Promise<boolean>
  readonly signEnableSession: (
    context: AccountInvocationContext<CompatibilityConfig>,
    details: SessionDetails,
  ) => Promise<Hex>
}

export interface IntentMessages {
  readonly origin: readonly TypedDataDefinition[]
  readonly destination: TypedDataDefinition
  readonly targetExecution?: TypedDataDefinition
}

export interface AccountComposition<CompatibilityConfig = unknown> {
  readonly context: AccountInvocationContext<CompatibilityConfig>
  readonly workflows: AccountWorkflows<CompatibilityConfig>
}

export interface CoreComposition<CompatibilityConfig = unknown> {
  readonly config: ResolvedSdkConfig
  readonly project: ProjectWorkflows
  readonly createAccount: (
    context: AccountInvocationContext<CompatibilityConfig>,
  ) => AccountComposition<CompatibilityConfig>
}

export type CoreCompositionFactory<CompatibilityConfig = unknown> = (
  config: ResolvedSdkConfig,
  dependencies: CoreDependencies,
) => CoreComposition<CompatibilityConfig>
