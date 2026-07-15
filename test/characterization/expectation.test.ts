import { describe, expect, test } from 'vitest'
import { evaluateScenarioObservation } from './expectation'
import type { CharacterizationObservation } from './observe'
import type { CharacterizationScenario } from './types'

describe('characterization outcome expectations', () => {
  test('accepts an exact expected submit-time simulation failure', () => {
    const scenario = makeScenario({
      kind: 'failure',
      stage: 'submit',
      errorClass: 'SimulationFailedError',
      code: 'SIMULATION_FAILED',
      messageInvariant: 'Simulation failed',
    })
    const observation = makeObservation({
      status: 'failure',
      error: {
        phase: 'simulate',
        class: 'SimulationFailedError',
        name: 'Error',
        code: 'SIMULATION_FAILED',
        message: 'Simulation failed for operation 1',
      },
    })

    expect(evaluateScenarioObservation(scenario, observation)).toEqual({
      passed: true,
    })
  })

  test('reports phase, class, code, and message mismatches together', () => {
    const scenario = makeScenario({
      kind: 'failure',
      stage: 'sign',
      errorClass: 'InvalidOwnerSigningOptionsError',
      code: 'INVALID_OWNER',
      messageInvariant: 'owner signer is missing',
    })
    const observation = makeObservation({
      status: 'failure',
      error: {
        phase: 'prepare',
        class: 'ValidationError',
        name: 'Error',
        code: 'INVALID_CONFIG',
        message: 'invalid config',
      },
    })

    expect(evaluateScenarioObservation(scenario, observation)).toEqual({
      passed: false,
      reasons: [
        'expected phase sign, received prepare',
        'expected error class InvalidOwnerSigningOptionsError, received ValidationError',
        'expected error code INVALID_OWNER, received INVALID_CONFIG',
        'error message does not include "owner signer is missing"',
      ],
    })
  })

  test('rejects unexpected success', () => {
    const scenario = makeScenario({
      kind: 'failure',
      stage: 'execution',
      errorClass: 'OrchestratorError',
      messageInvariant: 'failed',
    })

    expect(
      evaluateScenarioObservation(
        scenario,
        makeObservation({ status: 'success' }),
      ),
    ).toEqual({
      passed: false,
      reasons: ['expected execution failure, received success'],
    })
  })
})

function makeScenario(
  expected: CharacterizationScenario['expected'],
): CharacterizationScenario {
  return {
    id: 'expectation/test',
    workflow: 'intent',
    mode: 'sign',
    fixtureId: 'safe-ecdsa',
    caseId: 'same-chain-noop',
    primaryCategory: 'failures',
    axes: {
      account: ['safe'],
      owner: ['ecdsa:single'],
      session: ['none'],
      operation: ['intent:same-chain'],
      infrastructure: ['network:offline'],
    },
    tags: expected.kind === 'failure' ? ['negative'] : [],
    support: { level: 'live' },
    expected,
    setup: {
      identity: 'deterministic',
      preconditions: ['none'],
      funding: 'none',
      uniqueness: 'scenario-id',
      cleanup: 'none',
    },
    comparison: 'exact',
    observations: ['error'],
    normalization: [],
    terminalAssertions: [],
    timeoutMs: 30_000,
  }
}

function makeObservation(
  outcome: CharacterizationObservation['outcome'],
): CharacterizationObservation {
  return {
    schemaVersion: 1,
    scenarioId: 'expectation/test',
    workflow: 'intent',
    subject: 'legacy',
    runId: 'expectation-test',
    comparisonGroup: 'expectation-group',
    mode: 'sign',
    sign: {},
    outcome,
  }
}
