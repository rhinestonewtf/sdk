import type { IntentSplitPort } from '../../clients/orchestrator/port'
import type {
  OrchestratorSplitRequest,
  OrchestratorSplitResult,
} from '../../clients/orchestrator/types'

export function splitIntents(
  client: IntentSplitPort,
  input: OrchestratorSplitRequest,
): Promise<OrchestratorSplitResult> {
  return client.splitIntents(input)
}
