import { RhinestoneSDK } from '../../../src/index'

const API_KEY_ENV = 'INTEGRATION_RHINESTONE_API_KEY'
const ORCHESTRATOR_URL_ENV = 'INTEGRATION_ORCHESTRATOR_URL'
const FUNDER_PRIVATE_KEY_ENV = 'INTEGRATION_FUNDER_PRIVATE_KEY'

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

// Optional endpoint override (e.g. dev orchestrator). Defaults to the SDK's
// built-in prod URL when unset. Trailing slash trimmed so request URLs don't
// double up on `/`.
export function getIntegrationOrchestratorUrl(): string | undefined {
  const url = process.env[ORCHESTRATOR_URL_ENV]
  return url ? url.replace(/\/+$/, '') : undefined
}

// When pointing at the dev orchestrator, the SDK must also build bundles with
// dev contract addresses (IntentExecutor etc.); otherwise the dev orchestrator
// simulates against mismatched contracts and bundle submission fails. Tie the
// two together: set dev contracts whenever a custom endpoint is configured, or
// force it explicitly via INTEGRATION_USE_DEV_CONTRACTS.
export function getIntegrationUseDevContracts(): boolean {
  if (process.env.INTEGRATION_USE_DEV_CONTRACTS === 'true') return true
  return getIntegrationOrchestratorUrl() !== undefined
}

export function createIntegrationSDK(): RhinestoneSDK {
  return new RhinestoneSDK({
    apiKey: getIntegrationApiKey(),
    endpointUrl: getIntegrationOrchestratorUrl(),
    useDevContracts: getIntegrationUseDevContracts(),
  })
}
