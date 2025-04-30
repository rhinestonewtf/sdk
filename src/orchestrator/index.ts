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
  MetaIntent,
  OrderPath,
  PostOrderBundleResult,
  SignedMultiChainCompact,
} from './types'
import {
  BUNDLE_STATUS_FAILED,
  BUNDLE_STATUS_PARTIALLY_COMPLETED,
  BUNDLE_STATUS_PENDING,
} from './types'
import { getEmptyUserOp, getOrderBundleHash } from './utils'

function getOrchestrator(
  apiKey: string,
  orchestratorUrl?: string,
): Orchestrator {
  return new Orchestrator(orchestratorUrl ?? ORCHESTRATOR_URL, apiKey)
}

export type {
  BundleResult,
  MetaIntent,
  OrderPath,
  SignedMultiChainCompact,
  PostOrderBundleResult,
}
export {
  BUNDLE_STATUS_FAILED,
  BUNDLE_STATUS_PARTIALLY_COMPLETED,
  BUNDLE_STATUS_PENDING,
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
