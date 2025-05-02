import { Orchestrator } from './client'
import { ORCHESTRATOR_URL, RHINESTONE_SPOKE_POOL_ADDRESS } from './consts'
import { OrchestratorError } from './error'
import {
  getHookAddress,
  getSameChainModuleAddress,
  getTargetModuleAddress,
  getTokenAddress,
  getTokenBalanceSlot,
  getWethAddress,
} from './registry'
import type {
  BundleResult,
  Execution,
  MetaIntent,
  MultiChainCompact,
  OrderPath,
  PostOrderBundleResult,
  SignedMultiChainCompact,
} from './types'
import {
  BUNDLE_STATUS_COMPLETED,
  BUNDLE_STATUS_EXPIRED,
  BUNDLE_STATUS_FAILED,
  BUNDLE_STATUS_FILLED,
  BUNDLE_STATUS_PARTIALLY_COMPLETED,
  BUNDLE_STATUS_PENDING,
  BUNDLE_STATUS_UNKNOWN,
} from './types'
import { BundleStatusEnum, getEmptyUserOp, getOrderBundleHash } from './utils'

function getOrchestrator(
  apiKey: string,
  orchestratorUrl?: string,
): Orchestrator {
  return new Orchestrator(orchestratorUrl ?? ORCHESTRATOR_URL, apiKey)
}

export type {
  Execution,
  BundleResult,
  MetaIntent,
  MultiChainCompact,
  OrderPath,
  SignedMultiChainCompact,
  PostOrderBundleResult,
}
export {
  BundleStatusEnum as BundleStatus,
  BUNDLE_STATUS_PENDING,
  BUNDLE_STATUS_EXPIRED,
  BUNDLE_STATUS_PARTIALLY_COMPLETED,
  BUNDLE_STATUS_COMPLETED,
  BUNDLE_STATUS_FILLED,
  BUNDLE_STATUS_FAILED,
  BUNDLE_STATUS_UNKNOWN,
  RHINESTONE_SPOKE_POOL_ADDRESS,
  Orchestrator,
  OrchestratorError,
  getOrchestrator,
  getOrderBundleHash,
  getEmptyUserOp,
  getWethAddress,
  getTokenBalanceSlot,
  getHookAddress,
  getSameChainModuleAddress,
  getTargetModuleAddress,
  getTokenAddress,
}
