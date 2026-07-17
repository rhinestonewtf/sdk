import type {
  OrchestratorAppFeeBalances,
  OrchestratorIntentRequest,
  OrchestratorIntentStatus,
  OrchestratorIntentSubmission,
  OrchestratorIntentSubmissionContext,
  OrchestratorPortfolio,
  OrchestratorPortfolioRequest,
  OrchestratorQuoteResponse,
  OrchestratorSignedIntent,
  OrchestratorSplitRequest,
  OrchestratorSplitResult,
} from './types'

export interface IntentQuotePort {
  readonly createQuote: (
    request: OrchestratorIntentRequest,
  ) => Promise<OrchestratorQuoteResponse>
}

export interface IntentSubmissionPort {
  readonly submitIntent: (
    intent: OrchestratorSignedIntent,
    context?: OrchestratorIntentSubmissionContext,
  ) => Promise<OrchestratorIntentSubmission>
}

export interface IntentStatusPort {
  readonly getIntentStatus: (
    intentId: string,
  ) => Promise<OrchestratorIntentStatus>
}

export interface IntentSplitPort {
  readonly splitIntents: (
    request: OrchestratorSplitRequest,
  ) => Promise<OrchestratorSplitResult>
}

export interface AccountQueryPort {
  readonly getPortfolio: (
    request: OrchestratorPortfolioRequest,
  ) => Promise<OrchestratorPortfolio>
}

export interface ProjectQueryPort {
  readonly getAppFeeBalances: () => Promise<OrchestratorAppFeeBalances>
}

export interface OrchestratorPort
  extends IntentQuotePort,
    IntentSubmissionPort,
    IntentStatusPort,
    IntentSplitPort,
    AccountQueryPort,
    ProjectQueryPort {}
