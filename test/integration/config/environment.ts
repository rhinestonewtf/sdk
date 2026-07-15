import { RhinestoneSDK } from '../../../src/index'

const API_KEY_ENV = 'INTEGRATION_RHINESTONE_API_KEY'
const ORCHESTRATOR_URL_ENV = 'INTEGRATION_ORCHESTRATOR_URL'
const FUNDER_PRIVATE_KEY_ENV = 'INTEGRATION_FUNDER_PRIVATE_KEY'
const TARGET_ENV = 'INTEGRATION_TARGET'

export const DEV_ORCHESTRATOR_URL = 'https://dev.v1.orchestrator.rhinestone.dev'
export const PROD_ORCHESTRATOR_URL = 'https://v1.orchestrator.rhinestone.dev'

export type IntegrationTarget = 'dev' | 'prod'

export function getIntegrationTarget(): IntegrationTarget {
  const target = process.env[TARGET_ENV] ?? 'dev'
  if (target !== 'dev' && target !== 'prod') {
    throw new Error(`${TARGET_ENV} must be either dev or prod`)
  }
  return target
}

export function getIntegrationApiKey(): string {
  const apiKey = process.env[API_KEY_ENV]
  if (!apiKey) {
    throw new Error(`${API_KEY_ENV} is required to run SDK integration tests`)
  }
  return apiKey
}

// Funder key for specs that move real testnet tokens (non-sponsored
// cross-chain, spending-limit policies). Sponsored specs don't need it, so it's
// only required by the funding util when a funded spec actually runs.
export function getIntegrationFunderPrivateKey(): `0x${string}` {
  const key = process.env[FUNDER_PRIVATE_KEY_ENV]
  if (!key) {
    throw new Error(
      `${FUNDER_PRIVATE_KEY_ENV} is required for funded integration specs. ` +
        `Set it to a private key whose address holds testnet native + USDC.`,
    )
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      `${FUNDER_PRIVATE_KEY_ENV} must be a 0x-prefixed 32-byte hex private key`,
    )
  }
  return key as `0x${string}`
}

export function getIntegrationOrchestratorUrl(): string | undefined {
  const url = process.env[ORCHESTRATOR_URL_ENV]
  const target = getIntegrationTarget()
  const normalized = url?.replace(/\/+$/, '')
  if (target !== 'prod' && normalized === PROD_ORCHESTRATOR_URL) {
    throw new Error(
      `${ORCHESTRATOR_URL_ENV} targets prod; set ${TARGET_ENV}=prod explicitly`,
    )
  }
  if (normalized) return normalized
  return target === 'dev' ? DEV_ORCHESTRATOR_URL : undefined
}

export function getIntegrationUseDevContracts(): boolean {
  const configured = process.env.INTEGRATION_USE_DEV_CONTRACTS
  if (configured !== undefined) {
    if (configured === 'true') return true
    if (configured === 'false') return false
    throw new Error('INTEGRATION_USE_DEV_CONTRACTS must be true or false')
  }
  return getIntegrationTarget() === 'dev'
}

export function createIntegrationSDK(): RhinestoneSDK {
  return new RhinestoneSDK({
    apiKey: getIntegrationApiKey(),
    endpointUrl: getIntegrationOrchestratorUrl(),
    useDevContracts: getIntegrationUseDevContracts(),
  })
}
