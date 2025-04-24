import { OrchestratorError } from './error'
import { ORCHESTRATOR_URL, RHINESTONE_SPOKE_POOL_ADDRESS } from './consts'
import { Orchestrator } from './client'
import { getEmptyUserOp, getOrderBundleHash } from './utils'
import { getWethAddress, getTokenBalanceSlot } from './registry'

function getOrchestrator(
  apiKey: string,
  orchestratorUrl?: string,
): Orchestrator {
  return new Orchestrator(orchestratorUrl ?? ORCHESTRATOR_URL, apiKey)
}

export * from './types'
export {
  RHINESTONE_SPOKE_POOL_ADDRESS,
  Orchestrator,
  OrchestratorError,
  getOrchestrator,
  getOrderBundleHash,
  getEmptyUserOp,
  getWethAddress,
  getTokenBalanceSlot,
}
