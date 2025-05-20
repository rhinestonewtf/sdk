import { Orchestrator } from './client'
import { PROD_ORCHESTRATOR_URL, RHINESTONE_SPOKE_POOL_ADDRESS } from './consts'
import { isOrchestratorError, OrchestratorError } from './error'
import {
  getHookAddress,
  getRhinestoneSpokePoolAddress,
  getSameChainModuleAddress,
  getSupportedTokens,
  getTargetModuleAddress,
  getTokenAddress,
  getTokenBalanceSlot,
  getTokenRootBalanceSlot,
  getTokenSymbol,
  getWethAddress,
  isTokenAddressSupported,
} from './registry'
import type {
  BundleResult,
  Execution,
  MetaIntent,
  MultiChainCompact,
  OrderCost,
  OrderCostResult,
  OrderFeeInput,
  OrderPath,
  PostOrderBundleResult,
  SignedMultiChainCompact,
  UserTokenBalance,
} from './types'
import {
  BUNDLE_STATUS_COMPLETED,
  BUNDLE_STATUS_EXPIRED,
  BUNDLE_STATUS_FAILED,
  BUNDLE_STATUS_FILLED,
  BUNDLE_STATUS_PARTIALLY_COMPLETED,
  BUNDLE_STATUS_PENDING,
  BUNDLE_STATUS_PRECONFIRMED,
  BUNDLE_STATUS_UNKNOWN,
} from './types'
import {
  applyInjectedExecutions,
  BundleStatusEnum,
  getEmptyUserOp,
  getOrderBundleHash,
} from './utils'

function getOrchestrator(
  apiKey: string,
  orchestratorUrl?: string,
): Orchestrator {
  return new Orchestrator(orchestratorUrl ?? PROD_ORCHESTRATOR_URL, apiKey)
}

export type {
  Execution,
  BundleResult,
  MetaIntent,
  MultiChainCompact,
  OrderPath,
  SignedMultiChainCompact,
  PostOrderBundleResult,
  OrderCost,
  OrderCostResult,
  OrderFeeInput,
  UserTokenBalance,
}
export {
  BundleStatusEnum as BundleStatus,
  BUNDLE_STATUS_PENDING,
  BUNDLE_STATUS_EXPIRED,
  BUNDLE_STATUS_PARTIALLY_COMPLETED,
  BUNDLE_STATUS_COMPLETED,
  BUNDLE_STATUS_FILLED,
  BUNDLE_STATUS_FAILED,
  BUNDLE_STATUS_PRECONFIRMED,
  BUNDLE_STATUS_UNKNOWN,
  RHINESTONE_SPOKE_POOL_ADDRESS,
  Orchestrator,
  OrchestratorError,
  getOrchestrator,
  getOrderBundleHash,
  getEmptyUserOp,
  getWethAddress,
  getTokenBalanceSlot,
  getTokenRootBalanceSlot,
  getTokenSymbol,
  getHookAddress,
  getSameChainModuleAddress,
  getTargetModuleAddress,
  getRhinestoneSpokePoolAddress,
  getTokenAddress,
  getSupportedTokens,
  isOrchestratorError,
  isTokenAddressSupported,
  applyInjectedExecutions,
}
