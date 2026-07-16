import type { AccountAdapter } from '../accounts/adapter'
import type { BundlerPort } from '../clients/bundler/port'
import type { OrchestratorPort } from '../clients/orchestrator/port'
import type { OrchestratorAppFeeBalances } from '../clients/orchestrator/types'
import type { PaymasterPort } from '../clients/paymaster/port'
import type { RpcPort } from '../clients/rpc/port'
import type {
  AccountInvocationContext,
  ResolvedSdkConfig,
} from '../config/resolved'
import type {
  IntentInput,
  IntentStatus,
  PreparedIntent,
  SignedIntent,
  SubmittedIntent,
} from '../intents/types'
import type { SignerInvocationPort, SigningTranscript } from '../signing/types'
import type {
  PreparedUserOperation,
  SignedUserOperation,
  SubmittedUserOperation,
  UserOperationInput,
  UserOperationStatus,
} from '../user-operations/types'

export interface ClockPort {
  readonly now: () => number
  readonly sleep: (milliseconds: number) => Promise<void>
}

export interface CoreDependencies {
  readonly orchestrator: OrchestratorPort
  readonly rpc: RpcPort
  readonly bundler?: BundlerPort
  readonly paymaster?: PaymasterPort
  readonly signerInvoker: SignerInvocationPort
  readonly clock: ClockPort
}

export interface ProjectWorkflows {
  readonly getIntentStatus: (intentId: string) => Promise<IntentStatus>
  readonly splitIntents: OrchestratorPort['splitIntents']
  readonly getAppFeeBalances: () => Promise<OrchestratorAppFeeBalances>
}

export interface AccountWorkflows<CompatibilityConfig = unknown> {
  readonly prepareIntent: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: IntentInput,
  ) => Promise<PreparedIntent>
  readonly signIntent: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: PreparedIntent,
  ) => Promise<{
    readonly intent: SignedIntent
    readonly transcript: SigningTranscript
  }>
  readonly submitIntent: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: SignedIntent,
  ) => Promise<SubmittedIntent>
  readonly prepareUserOperation: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: UserOperationInput,
  ) => Promise<PreparedUserOperation>
  readonly signUserOperation: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: PreparedUserOperation,
  ) => Promise<SignedUserOperation>
  readonly submitUserOperation: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: SignedUserOperation,
  ) => Promise<SubmittedUserOperation>
  readonly getUserOperationStatus: (
    context: AccountInvocationContext<CompatibilityConfig>,
    input: SubmittedUserOperation,
  ) => Promise<UserOperationStatus>
}

export interface AccountComposition<CompatibilityConfig = unknown> {
  readonly adapter: AccountAdapter
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
