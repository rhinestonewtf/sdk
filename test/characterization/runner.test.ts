import { describe, expect, test } from 'vitest'
import {
  characterizationScenarios,
  EXECUTABLE_CHARACTERIZATION_HANDLER_KEYS,
} from './catalog'
import {
  assertCharacterizationHandlerCoverage,
  assertCharacterizationSubjectAvailable,
  assertLegacyOracleSourceUnchanged,
  compareScenarioArtifacts,
  getRegisteredHandlerKeys,
  resolveCharacterizationBaseSha,
  runCharacterizationScenario,
} from './runner'
import type { DirectSigningScenario } from './types'

const baseSha = '49efb8b8d957b2eea2b24c11ac56d6c4d80478d6'

describe('characterization runner', () => {
  test('keeps the executable adapter registry exhaustive', () => {
    expect(assertCharacterizationHandlerCoverage).not.toThrow()
    expect(getRegisteredHandlerKeys()).toEqual(
      EXECUTABLE_CHARACTERIZATION_HANDLER_KEYS,
    )
  })

  test('reports rewrite subject availability honestly', () => {
    expect(() => assertCharacterizationSubjectAvailable('rewrite')).toThrow(
      'Commit 6',
    )
    expect(() => assertCharacterizationSubjectAvailable('legacy')).not.toThrow()
    expect(() => assertCharacterizationSubjectAvailable('public')).not.toThrow()
  })

  test('resolves and verifies the configured immutable base SHA', async () => {
    await expect(resolveCharacterizationBaseSha(baseSha)).resolves.toBe(baseSha)
    await expect(resolveCharacterizationBaseSha('HEAD')).rejects.toThrow(
      'expected exact commit HEAD',
    )
  })

  test('keeps the legacy oracle source pinned to the calibrated release', async () => {
    await expect(assertLegacyOracleSourceUnchanged(baseSha)).resolves.toBe(
      undefined,
    )
    await expect(
      assertLegacyOracleSourceUnchanged(
        '0000000000000000000000000000000000000000',
      ),
    ).rejects.toThrow('requires calibrated release')
  })

  test('runs and compares an offline direct-signing scenario', async () => {
    const scenario = characterizationScenarios.find(
      (candidate): candidate is DirectSigningScenario =>
        candidate.id === 'direct-signing/plain-message-selected-chain' &&
        candidate.workflow === 'direct-signing',
    )
    if (!scenario) throw new Error('Direct-signing runner fixture is missing')

    const legacy = await runCharacterizationScenario(scenario, {
      baseSha,
      runId: 'runner-test',
      subject: 'legacy',
    })
    const publicArtifact = await runCharacterizationScenario(scenario, {
      baseSha,
      runId: 'runner-test',
      subject: 'public',
    })
    expect(legacy.status).toBe('passed')
    expect(publicArtifact.status).toBe('passed')
    expect(
      compareScenarioArtifacts(scenario, legacy, publicArtifact),
    ).toMatchObject({ status: 'passed', unexplainedDeltas: 0 })
  })
})
