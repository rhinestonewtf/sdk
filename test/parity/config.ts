import type { Fault } from './faults'
import { getFault } from './faults'

type BuildId = 'published' | 'working-tree'
type ParityEnv = 'prod' | 'dev'

interface ParityConfig {
  apiKey: string
  env: ParityEnv
  endpointUrl: string | undefined
  baseline: BuildId
  candidate: BuildId
  repeat: number
  fault: Fault | undefined
  updateGoldens: boolean
  // Funded scenarios submit for real; they run only against prod.
  funded: boolean
  settleTimeoutMs: number
}

const PROD_ORCHESTRATOR_URL = 'https://v1.orchestrator.rhinestone.dev'
const DEV_ORCHESTRATOR_URL = 'https://dev.v1.orchestrator.rhinestone.dev'
const ORCHESTRATOR_ORIGINS = [PROD_ORCHESTRATOR_URL, DEV_ORCHESTRATOR_URL]

const BUILD_IDS: readonly BuildId[] = ['published', 'working-tree']

function parseBuildId(
  name: string,
  value: string | undefined,
  fallback: BuildId,
) {
  if (value === undefined || value === '') return fallback
  if (!BUILD_IDS.includes(value as BuildId)) {
    throw new Error(
      `${name} must be one of ${BUILD_IDS.join(', ')}; got "${value}"`,
    )
  }
  return value as BuildId
}

function loadConfig(
  env: Record<string, string | undefined> = process.env,
): ParityConfig {
  const apiKey = env.PARITY_API_KEY || env.RHINESTONE_API_KEY
  if (!apiKey) {
    throw new Error(
      'Parity runs need an orchestrator API key: set PARITY_API_KEY (or RHINESTONE_API_KEY)',
    )
  }
  const parityEnv = (env.PARITY_ENV || 'prod') as ParityEnv
  if (parityEnv !== 'prod' && parityEnv !== 'dev') {
    throw new Error(`PARITY_ENV must be prod or dev; got "${parityEnv}"`)
  }
  const repeat = Number(env.PARITY_REPEAT || '1')
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error(
      `PARITY_REPEAT must be a positive integer; got "${env.PARITY_REPEAT}"`,
    )
  }
  const settleTimeoutMs = Number(env.PARITY_SETTLE_TIMEOUT_MS || '600000')
  if (!Number.isInteger(settleTimeoutMs) || settleTimeoutMs < 1) {
    throw new Error(
      `PARITY_SETTLE_TIMEOUT_MS must be a positive integer; got "${env.PARITY_SETTLE_TIMEOUT_MS}"`,
    )
  }
  return {
    apiKey,
    env: parityEnv,
    endpointUrl: parityEnv === 'dev' ? DEV_ORCHESTRATOR_URL : undefined,
    baseline: parseBuildId('PARITY_BASELINE', env.PARITY_BASELINE, 'published'),
    candidate: parseBuildId(
      'PARITY_CANDIDATE',
      env.PARITY_CANDIDATE,
      'working-tree',
    ),
    repeat,
    fault: env.PARITY_FAULT ? getFault(env.PARITY_FAULT) : undefined,
    updateGoldens: env.PARITY_UPDATE_GOLDENS === '1',
    funded: env.PARITY_FUNDED !== '0',
    settleTimeoutMs,
  }
}

function orchestratorOrigins(
  config: Pick<ParityConfig, 'endpointUrl'>,
): string[] {
  const origins = new Set(ORCHESTRATOR_ORIGINS)
  if (config.endpointUrl) origins.add(new URL(config.endpointUrl).origin)
  return [...origins]
}

export type { BuildId, ParityConfig, ParityEnv }
export {
  DEV_ORCHESTRATOR_URL,
  loadConfig,
  orchestratorOrigins,
  PROD_ORCHESTRATOR_URL,
}
