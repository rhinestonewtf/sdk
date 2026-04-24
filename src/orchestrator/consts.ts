const PROD_ORCHESTRATOR_URL = 'https://v1.orchestrator.rhinestone.dev'
const RHINESTONE_SPOKE_POOL_ADDRESS =
  '0x000000000060f6e853447881951574cdd0663530'

const SDK_VERSION = '1.4.1'
const ORCHESTRATOR_API_VERSION_HEADERS = {
  alps: '2026-01.alps',
  blanc: '2026-04.blanc',
} as const

type OrchestratorApiVersion = keyof typeof ORCHESTRATOR_API_VERSION_HEADERS

const DEFAULT_ORCHESTRATOR_API_VERSION: OrchestratorApiVersion = 'blanc'

export {
  PROD_ORCHESTRATOR_URL,
  RHINESTONE_SPOKE_POOL_ADDRESS,
  SDK_VERSION,
  ORCHESTRATOR_API_VERSION_HEADERS,
  DEFAULT_ORCHESTRATOR_API_VERSION,
}
export type { OrchestratorApiVersion }
