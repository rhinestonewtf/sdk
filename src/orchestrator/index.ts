import { OrchestratorError } from './error'
import { ORCHESTRATOR_URL } from './consts'
import { Orchestrator } from './client'
import { getOrderBundleHash } from './utils'

export function getOrchestrator(
  apiKey: string,
  orchestratorUrl?: string,
): Orchestrator {
  return new Orchestrator(orchestratorUrl ?? ORCHESTRATOR_URL, apiKey)
}

export * from './types'
export { Orchestrator, OrchestratorError, getOrderBundleHash }
