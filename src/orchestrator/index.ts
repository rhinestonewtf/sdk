import { OrchestratorError } from './error'
import {
  ORCHESTRATOR_URL,
  HOOK_ADDRESS,
  TARGET_MODULE_ADDRESS,
  SAME_CHAIN_MODULE_ADDRESS,
} from './consts'
import { Orchestrator } from './client'
import { getOrderBundleHash } from './utils'

export function getOrchestrator(
  apiKey: string,
  orchestratorUrl?: string,
): Orchestrator {
  return new Orchestrator(orchestratorUrl ?? ORCHESTRATOR_URL, apiKey)
}

export * from './types'
export {
  HOOK_ADDRESS,
  TARGET_MODULE_ADDRESS,
  SAME_CHAIN_MODULE_ADDRESS,
  Orchestrator,
  OrchestratorError,
  getOrderBundleHash,
}
