import { createHash } from 'node:crypto'
import {
  DEV_ORCHESTRATOR_URL,
  getIntegrationOrchestratorUrl,
  getIntegrationTarget,
  getIntegrationUseDevContracts,
} from '../integration/config/environment'
import type { BaselineEnvironmentIdentity } from './baseline'

export function getCharacterizationEnvironmentIdentity(): BaselineEnvironmentIdentity {
  const endpoint = getIntegrationOrchestratorUrl()
  const integrationTarget = getIntegrationTarget()
  const useDevContracts = getIntegrationUseDevContracts()
  const target =
    integrationTarget === 'dev' && endpoint === DEV_ORCHESTRATOR_URL
      ? 'development'
      : integrationTarget === 'prod' && endpoint === undefined
        ? 'production'
        : `custom-${createHash('sha256')
            .update(endpoint ?? '')
            .digest('hex')
            .slice(0, 12)}`

  return {
    id: target,
    attributes: {
      sourceChainId: 84532,
      targetChainId: 421614,
      useDevContracts,
    },
  }
}
