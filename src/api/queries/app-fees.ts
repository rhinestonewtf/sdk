import type { ProjectQueryPort } from '../../clients/orchestrator/port'
import type { OrchestratorAppFeeBalances } from '../../clients/orchestrator/types'

export function getAppFeeBalances(
  client: ProjectQueryPort,
): Promise<OrchestratorAppFeeBalances> {
  return client.getAppFeeBalances()
}
