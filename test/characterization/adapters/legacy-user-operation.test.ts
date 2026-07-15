import { describe, expect, test } from 'vitest'
import {
  characterizationScenarios,
  EXECUTABLE_CHARACTERIZATION_HANDLER_KEYS,
  getScenarioHandlerKey,
  isExecutableCharacterizationScenario,
} from '../catalog'
import type { UserOperationScenario } from '../types'
import {
  getLegacyUserOperationHandlerKey,
  LEGACY_USER_OPERATION_HANDLER_KEYS,
  LegacyUserOperationNotExecutableError,
  runLegacyUserOperationScenario,
} from './legacy-user-operation'

const baseSha = '49efb8b8d957b2eea2b24c11ac56d6c4d80478d6'
const userOperationScenarios = characterizationScenarios.filter(
  (scenario): scenario is UserOperationScenario =>
    scenario.workflow === 'user-operation',
)

describe('legacy UserOperation adapter', () => {
  test('publishes every executable catalog handler key', () => {
    const executableCatalogKeys = userOperationScenarios
      .filter(isExecutableCharacterizationScenario)
      .map(getScenarioHandlerKey)
      .sort()
    const executableRegistryKeys =
      EXECUTABLE_CHARACTERIZATION_HANDLER_KEYS.filter((key) =>
        key.startsWith('user-operation:'),
      ).sort()

    expect(LEGACY_USER_OPERATION_HANDLER_KEYS).toEqual(executableCatalogKeys)
    expect(LEGACY_USER_OPERATION_HANDLER_KEYS).toEqual(executableRegistryKeys)
  })

  test.each(userOperationScenarios)(
    'rejects the explicit offline gap $id',
    async (scenario) => {
      expect(scenario.support.level).toBe('offline-only')
      if (scenario.support.level !== 'offline-only') {
        throw new Error(`${scenario.id} unexpectedly became executable`)
      }

      const error = await runLegacyUserOperationScenario({
        scenario,
        subject: 'legacy',
        baseSha,
        runId: 'legacy-user-operation-test',
      }).catch((cause: unknown) => cause)

      expect(error).toBeInstanceOf(LegacyUserOperationNotExecutableError)
      expect(error).toMatchObject({
        name: 'LegacyUserOperationNotExecutableError',
        scenarioId: scenario.id,
        handlerKey: getLegacyUserOperationHandlerKey(scenario),
        limitation: scenario.support.limitation,
        coverageRef: scenario.support.coverageRef,
      })
      expect((error as Error).message).toContain(scenario.support.limitation)
      expect((error as Error).message).toContain(scenario.support.coverageRef)
    },
  )
})
