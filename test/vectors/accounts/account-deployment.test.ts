import { keccak256 } from 'viem'
import { describe, expect, test } from 'vitest'
import { createAccountConstruction } from '../../../src/accounts/construction'
import { createAccountAdapter } from '../../../src/accounts/registry'
import {
  resolveAccountConfig,
  resolveSdkConfig,
} from '../../../src/config/resolve'
import { experimental_getModuleSetup } from '../../../src/utils/index'
import vector from './account-deployment.json'
import { deriveVectorRecord } from './derive'
import { type VectorCase, vectorCases } from './matrix'

const baselineById = new Map(vector.cases.map((entry) => [entry.id, entry]))

function expected(id: string) {
  const entry = baselineById.get(id)
  if (!entry) throw new Error(`Missing baseline entry ${id}`)
  return {
    address: entry.address,
    ...('factory' in entry ? { factory: entry.factory } : {}),
    ...('factoryDataHash' in entry
      ? { factoryDataHash: entry.factoryDataHash }
      : {}),
  }
}

// Names the modules a configuration installs, so a failing case reports which
// derivation input moved instead of only that a hash changed.
function diagnostics(vectorCase: VectorCase) {
  try {
    const setup = experimental_getModuleSetup(vectorCase.config)
    return JSON.stringify(setup, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    )
  } catch (error) {
    return `module setup unavailable: ${(error as Error).message}`
  }
}

describe('account deployment vector coverage', () => {
  test('every matrix case has a baseline entry', () => {
    const missing = vectorCases
      .map((vectorCase) => vectorCase.id)
      .filter((id) => !baselineById.has(id))
    expect(missing).toEqual([])
  })

  test('every baseline entry has a matrix case', () => {
    const matrixIds = new Set(vectorCases.map((vectorCase) => vectorCase.id))
    const orphaned = vector.cases
      .map((entry) => entry.id)
      .filter((id) => !matrixIds.has(id))
    expect(orphaned).toEqual([])
  })

  test('baseline entries pin factory args unless the case is address-only', () => {
    const mismatched = vectorCases
      .filter((vectorCase) => {
        const entry = baselineById.get(vectorCase.id)
        if (!entry) return false
        const pinsFactory = 'factory' in entry && 'factoryDataHash' in entry
        return pinsFactory !== (vectorCase.pins === 'deployment')
      })
      .map((vectorCase) => vectorCase.id)
    expect(mismatched).toEqual([])
  })
})

describe('account deployment vectors (public API)', () => {
  test.each(vectorCases)('$id', async (vectorCase) => {
    const record = await deriveVectorRecord(vectorCase)
    const { id: _id, ...derived } = record
    expect(derived, `${vectorCase.id}: ${diagnostics(vectorCase)}`).toEqual(
      expected(vectorCase.id),
    )
  })
})

const currentCases = vectorCases.filter(
  (vectorCase) => vectorCase.profile === 'current' && !vectorCase.pinnedFrom,
)

describe('account deployment vectors (adapter path)', () => {
  const sdk = resolveSdkConfig({ apiKey: 'vector-only' })

  test.each(currentCases)('$id', (vectorCase) => {
    const resolved = resolveAccountConfig(sdk, vectorCase.config)
    if (!resolved.owners) throw new Error(`Missing owners for ${vectorCase.id}`)
    const sessionModule =
      resolved.sessions.module.source === 'explicit'
        ? resolved.sessions.module.address
        : undefined
    const compatibilityFallback =
      resolved.sessions.compatibilityFallback.source === 'explicit'
        ? resolved.sessions.compatibilityFallback.address
        : undefined
    const construction = createAccountConstruction({
      material: {
        account: resolved.account,
        owner: resolved.owners,
        modules: resolved.modules,
        ...(resolved.initData ? { initData: resolved.initData } : {}),
        ...(resolved.eoa ? { eoa: resolved.eoa } : {}),
        sessions: {
          enabled: resolved.sessions.enabled,
          environment: resolved.sessions.environment,
          ...(sessionModule ? { module: sessionModule } : {}),
          ...(compatibilityFallback ? { compatibilityFallback } : {}),
        },
      },
      chain: { kind: 'evm', id: 1, caip2: 'eip155:1' },
      deployed: false,
    })
    const plan =
      createAccountAdapter(construction).getDeploymentPlan(construction)

    const derived =
      vectorCase.pins === 'address'
        ? { address: plan.address }
        : {
            address: plan.address,
            factory: plan.factory,
            factoryDataHash: plan.factoryData
              ? keccak256(plan.factoryData)
              : undefined,
          }
    expect(derived, `${vectorCase.id}: ${diagnostics(vectorCase)}`).toEqual(
      expected(vectorCase.id),
    )
  })
})
