import { RhinestoneSDK } from '../../../src/index'

const API_KEY_ENV = 'INTEGRATION_RHINESTONE_API_KEY'

export function getIntegrationApiKey(): string {
  const apiKey = process.env[API_KEY_ENV]
  if (!apiKey) {
    throw new Error(`${API_KEY_ENV} is required to run SDK integration tests`)
  }
  return apiKey
}

export function createIntegrationSDK(): RhinestoneSDK {
  return new RhinestoneSDK({
    apiKey: getIntegrationApiKey(),
  })
}
