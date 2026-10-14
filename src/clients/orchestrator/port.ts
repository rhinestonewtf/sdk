import type { ChainCatalog } from './chain-catalog'
import type {
  OrchestratorAppFeeBalances,
  OrchestratorIntentRequest,
  OrchestratorIntentStatus,
  OrchestratorIntentSubmission,
  OrchestratorPortfolio,
  OrchestratorPortfolioRequest,
  OrchestratorQuoteContext,
  OrchestratorQuoteResponse,
  OrchestratorSignedIntent,
  OrchestratorSplitRequest,
  OrchestratorSplitResult,
} from './types'

export interface IntentQuotePort {
  readonly createQuote: (
    request: OrchestratorIntentRequest,
    context?: OrchestratorQuoteContext,
  ) => Promise<OrchestratorQuoteResponse>
}

export interface IntentSubmissionPort {
  readonly submitIntent: (
    intent: OrchestratorSignedIntent,
  ) => Promise<OrchestratorIntentSubmission>
}

export interface IntentStatusReadOptions {
  /** Ask for the recorded detail block. Off by default, so polling stays lean. */
  readonly full?: boolean
}

export interface IntentStatusPort {
  readonly getIntentStatus: (
    intentId: string,
    options?: IntentStatusReadOptions,
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

export interface ChainCatalogPort {
  // Lazily fetch (once) the runtime chain catalog from `GET /chains`. Cached for
  // the lifetime of the client; callers that need chain facts await this
  // instead of relying on bundled chain data.
  readonly getChainCatalog: () => Promise<ChainCatalog>
}

export interface OrchestratorPort
  extends IntentQuotePort,
    IntentSubmissionPort,
    IntentStatusPort,
    IntentSplitPort,
    AccountQueryPort,
    ProjectQueryPort,
    ChainCatalogPort {}
