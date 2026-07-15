import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { getCharacterizationEnvironmentIdentity } from './environment'

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

describe('characterization environment identity', () => {
  test('identifies the default dev environment', () => {
    expect(getCharacterizationEnvironmentIdentity()).toEqual({
      id: 'development',
      attributes: {
        sourceChainId: 84532,
        targetChainId: 421614,
        useDevContracts: true,
      },
    })
  })

  test('identifies an explicitly selected prod environment', () => {
    process.env.INTEGRATION_TARGET = 'prod'

    expect(getCharacterizationEnvironmentIdentity()).toEqual({
      id: 'production',
      attributes: {
        sourceChainId: 84532,
        targetChainId: 421614,
        useDevContracts: false,
      },
    })
  })
})
