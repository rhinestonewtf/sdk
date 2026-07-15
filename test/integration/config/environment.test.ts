import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  DEV_ORCHESTRATOR_URL,
  getIntegrationOrchestratorUrl,
  getIntegrationTarget,
  getIntegrationUseDevContracts,
  PROD_ORCHESTRATOR_URL,
} from './environment'

const ENVIRONMENT_KEYS = [
  'INTEGRATION_TARGET',
  'INTEGRATION_ORCHESTRATOR_URL',
  'INTEGRATION_USE_DEV_CONTRACTS',
] as const

const originalEnvironment = Object.fromEntries(
  ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
)

beforeEach(() => {
  for (const key of ENVIRONMENT_KEYS) delete process.env[key]
})

afterEach(() => {
  for (const key of ENVIRONMENT_KEYS) {
    const value = originalEnvironment[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('integration environment selection', () => {
  test('defaults live tests to dev', () => {
    expect(getIntegrationTarget()).toBe('dev')
    expect(getIntegrationOrchestratorUrl()).toBe(DEV_ORCHESTRATOR_URL)
    expect(getIntegrationUseDevContracts()).toBe(true)
  })

  test('requires an explicit prod target', () => {
    process.env.INTEGRATION_ORCHESTRATOR_URL = PROD_ORCHESTRATOR_URL

    expect(() => getIntegrationOrchestratorUrl()).toThrow(
      'set INTEGRATION_TARGET=prod explicitly',
    )
  })

  test('selects the SDK prod default only when requested', () => {
    process.env.INTEGRATION_TARGET = 'prod'

    expect(getIntegrationOrchestratorUrl()).toBeUndefined()
    expect(getIntegrationUseDevContracts()).toBe(false)
  })

  test('rejects invalid target and contract settings', () => {
    process.env.INTEGRATION_TARGET = 'staging'
    expect(() => getIntegrationTarget()).toThrow(
      'INTEGRATION_TARGET must be either dev or prod',
    )

    process.env.INTEGRATION_TARGET = 'dev'
    process.env.INTEGRATION_USE_DEV_CONTRACTS = 'yes'
    expect(() => getIntegrationUseDevContracts()).toThrow(
      'INTEGRATION_USE_DEV_CONTRACTS must be true or false',
    )
  })
})
