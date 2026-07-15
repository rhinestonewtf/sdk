import { describe, expect, test } from 'vitest'
import {
  characterizationScenarios,
  EXECUTABLE_CHARACTERIZATION_HANDLER_KEYS,
  getScenarioHandlerKey,
  isExecutableCharacterizationScenario,
} from '../catalog'
import { getComparisonGroupNamespace } from '../identity'
import { serializeArtifact } from '../serialization'
import type { DirectSigningScenario } from '../types'
import {
  LEGACY_DIRECT_SIGNING_HANDLER_KEYS,
  runLegacyDirectSigning,
} from './legacy-direct'

const baseSha = '49efb8b8d957b2eea2b24c11ac56d6c4d80478d6'

describe('legacy direct signing adapter', () => {
  const directScenarios = characterizationScenarios.filter(
    (scenario): scenario is DirectSigningScenario =>
      scenario.workflow === 'direct-signing' &&
      isExecutableCharacterizationScenario(scenario),
  )

  test('registers every executable direct-signing handler explicitly', () => {
    const catalogKeys = [
      ...new Set(directScenarios.map(getScenarioHandlerKey)),
    ].sort()
    const globalKeys = EXECUTABLE_CHARACTERIZATION_HANDLER_KEYS.filter((key) =>
      key.startsWith('direct-signing:'),
    ).sort()

    expect([...LEGACY_DIRECT_SIGNING_HANDLER_KEYS].sort()).toEqual(catalogKeys)
    expect([...LEGACY_DIRECT_SIGNING_HANDLER_KEYS].sort()).toEqual(globalKeys)
  })

  test.each(directScenarios)(
    'executes catalog scenario $id',
    async (scenario) => {
      const comparisonGroup = getComparisonGroupNamespace({
        scenario,
        baseSha,
        runId: 'direct-catalog-test',
        subject: 'legacy',
      })
      const observation = await runLegacyDirectSigning(scenario, {
        scenarioId: scenario.id,
        workflow: 'direct-signing',
        subject: 'legacy',
        runId: 'direct-catalog-test',
        comparisonGroup,
        identityNamespace: comparisonGroup,
      })

      expect(observation.outcome.status).toBe(
        scenario.expected.kind === 'success' ? 'success' : 'failure',
      )
      if (
        scenario.expected.kind === 'failure' &&
        observation.outcome.status === 'failure'
      ) {
        expect(observation.outcome.error.class).toBe(
          scenario.expected.errorClass,
        )
      }
      expect(() => serializeArtifact(observation)).not.toThrow()
    },
  )

  test.each([
    ['safe-signing', 'plain-message'],
    ['nexus-signing', 'typed-data'],
    ['kernel-signing', 'nested-typed-data'],
    ['safe-signing', 'erc6492-verification'],
    ['startale-signing', 'erc7739-verification'],
    ['eip7702-signing', 'eip7702-authorization'],
    ['independent-signing', 'independent-contribution'],
  ] as const)(
    'executes %s/%s through legacy code',
    async (fixtureId, caseId) => {
      const scenario = makeScenario(fixtureId, caseId)
      const comparisonGroup = getComparisonGroupNamespace({
        scenario,
        baseSha,
        runId: 'direct-test',
        subject: 'legacy',
      })
      const observation = await runLegacyDirectSigning(scenario, {
        scenarioId: scenario.id,
        workflow: 'direct-signing',
        subject: 'legacy',
        runId: 'direct-test',
        comparisonGroup,
        identityNamespace: comparisonGroup,
      })

      expect(observation.outcome).toEqual({ status: 'success' })
      expect(observation.mode).toBe('sign')
      expect(() => serializeArtifact(observation)).not.toThrow()
    },
  )
})

function makeScenario(
  fixtureId: DirectSigningScenario['fixtureId'],
  caseId: DirectSigningScenario['caseId'],
): DirectSigningScenario {
  return {
    id: `direct/${fixtureId}/${caseId}`,
    primaryCategory: 'user-operations-and-direct-signing',
    workflow: 'direct-signing',
    mode: 'sign',
    fixtureId,
    caseId,
    axes: {
      account: [accountAxis(fixtureId), 'state:new'],
      owner: ['ecdsa:single', 'signing:full'],
      session: fixtureId === 'session-signing' ? ['fresh'] : ['none'],
      operation: ['sign:message'],
      infrastructure: ['network:offline'],
    },
    tags: ['golden-vector'],
    support: {
      level: 'offline-only',
      limitation: 'focused adapter test',
      coverageRef: 'test/characterization/adapters/legacy-direct.test.ts',
    },
    expected: { kind: 'success' },
    setup: {
      identity: 'deterministic',
      preconditions: ['none'],
      funding: 'none',
      uniqueness: 'scenario-id',
      cleanup: 'none',
    },
    comparison: 'exact',
    observations: ['account-address', 'signature-artifact'],
    normalization: [],
    terminalAssertions: [],
    timeoutMs: 30_000,
  }
}

function accountAxis(
  fixtureId: DirectSigningScenario['fixtureId'],
): 'safe' | 'nexus' | 'kernel' | 'startale' {
  if (fixtureId === 'nexus-signing' || fixtureId === 'eip7702-signing') {
    return 'nexus'
  }
  if (fixtureId === 'kernel-signing') return 'kernel'
  if (fixtureId === 'startale-signing') return 'startale'
  return 'safe'
}
