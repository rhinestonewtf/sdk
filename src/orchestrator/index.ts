import { Orchestrator } from './client'
import { PROD_ORCHESTRATOR_URL, RHINESTONE_SPOKE_POOL_ADDRESS } from './consts'
import {
  AuthenticationRequiredError,
  InsufficientBalanceError,
  IntentNotFoundError,
  InvalidApiKeyError,
  InvalidIntentSignatureError,
  isOrchestratorError,
  NoPathFoundError,
  OnlyOneTargetTokenAmountCanBeUnsetError,
  OrchestratorError,
  TokenNotSupportedError,
  UnsupportedChainError,
  UnsupportedChainIdError,
  UnsupportedTokenError,
} from './error'
import {
  getSupportedTokens,
  getTokenAddress,
  getTokenSymbol,
  getWethAddress,
  isTokenAddressSupported,
} from './registry'
import type {
  IntentCost,
  IntentInput,
  IntentOp,
  IntentOpStatus,
  IntentResult,
  IntentRoute,
  Portfolio,
  SettlementSystem,
  SignedIntentOp,
  SupportedChain,
  TokenConfig,
} from './types'
import {
  INTENT_STATUS_COMPLETED,
  INTENT_STATUS_EXPIRED,
  INTENT_STATUS_FAILED,
  INTENT_STATUS_FILLED,
  INTENT_STATUS_PARTIALLY_COMPLETED,
  INTENT_STATUS_PENDING,
  INTENT_STATUS_PRECONFIRMED,
  INTENT_STATUS_UNKNOWN,
} from './types'

function getOrchestrator(
  apiKey?: string,
  orchestratorUrl?: string,
): Orchestrator {
  return new Orchestrator(orchestratorUrl ?? PROD_ORCHESTRATOR_URL, apiKey)
}

export type {
  IntentCost,
  IntentInput,
  IntentOp,
  IntentOpStatus,
  IntentResult,
  IntentRoute,
  SettlementSystem,
  SignedIntentOp,
  SupportedChain,
  TokenConfig,
  Portfolio,
}
export {
  INTENT_STATUS_PENDING,
  INTENT_STATUS_EXPIRED,
  INTENT_STATUS_PARTIALLY_COMPLETED,
  INTENT_STATUS_COMPLETED,
  INTENT_STATUS_FILLED,
  INTENT_STATUS_FAILED,
  INTENT_STATUS_PRECONFIRMED,
  INTENT_STATUS_UNKNOWN,
  RHINESTONE_SPOKE_POOL_ADDRESS,
  Orchestrator,
  AuthenticationRequiredError,
  InsufficientBalanceError,
  InvalidApiKeyError,
  InvalidIntentSignatureError,
  NoPathFoundError,
  OnlyOneTargetTokenAmountCanBeUnsetError,
  OrchestratorError,
  IntentNotFoundError,
  TokenNotSupportedError,
  UnsupportedChainError,
  UnsupportedChainIdError,
  UnsupportedTokenError,
  getOrchestrator,
  getWethAddress,
  getTokenSymbol,
  getTokenAddress,
  getSupportedTokens,
  isOrchestratorError,
  isTokenAddressSupported,
}
