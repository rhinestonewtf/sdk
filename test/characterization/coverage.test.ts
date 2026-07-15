import { existsSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  CHARACTERIZATION_HANDLER_KEYS,
  characterizationScenarios,
  EXECUTABLE_CHARACTERIZATION_HANDLER_KEYS,
  getScenarioHandlerKey,
  isExecutableCharacterizationScenario,
} from './catalog'
import {
  AXIS_VOCABULARY,
  type CharacterizationAxis,
  type CharacterizationScenario,
  DIRECT_SIGNING_CASE_IDS,
  DIRECT_SIGNING_FIXTURE_IDS,
  EXECUTION_MODES,
  type ExecutionMode,
  INTENT_CASE_IDS,
  INTENT_FIXTURE_IDS,
  PRIMARY_CATEGORIES,
  type PrimaryCategory,
  SCENARIO_TAGS,
  type ScenarioTag,
  USER_OPERATION_CASE_IDS,
  USER_OPERATION_FIXTURE_IDS,
  WORKFLOW_KINDS,
} from './types'

const CATEGORY_TARGETS: Record<PrimaryCategory, number> = {
  accounts: 14,
  validators: 18,
  sessions: 24,
  intents: 20,
  'user-operations-and-direct-signing': 12,
  failures: 12,
}

const MODE_TARGETS: Record<ExecutionMode, number> = {
  sign: 45,
  dryRun: 35,
  execute: 20,
}

const WORKFLOW_MODES = {
  intent: EXECUTION_MODES,
  'user-operation': ['sign', 'execute'],
  'direct-signing': ['sign'],
} as const

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  return values.reduce(
    (counts, value) => {
      counts[value] = (counts[value] ?? 0) + 1
      return counts
    },
    {} as Record<T, number>,
  )
}

function hasAxis<TAxis extends CharacterizationAxis>(
  scenario: CharacterizationScenario,
  axis: TAxis,
  value: (typeof AXIS_VOCABULARY)[TAxis][number],
): boolean {
  return (scenario.axes[axis] as readonly string[]).includes(value)
}

function expectHighRiskCombination(
  tag: ScenarioTag,
  predicate: (scenario: CharacterizationScenario) => boolean,
): void {
  const scenario = characterizationScenarios.find((candidate) =>
    candidate.tags.includes(tag),
  )
  expect(scenario, `missing ${tag}`).toBeDefined()
  expect(
    predicate(scenario!),
    `${tag} does not describe its required axes`,
  ).toBe(true)
}

describe('characterization catalog coverage', () => {
  test('keeps stable unique scenario identities', () => {
    expect(characterizationScenarios).toHaveLength(100)
    const ids = characterizationScenarios.map(({ id }) => id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(?:[/-][a-z0-9.]+)*$/)
    }
  })

  test('keeps the approved category and mode allocation', () => {
    expect(
      countBy(
        characterizationScenarios.map(({ primaryCategory }) => primaryCategory),
      ),
    ).toEqual(CATEGORY_TARGETS)
    expect(countBy(characterizationScenarios.map(({ mode }) => mode))).toEqual(
      MODE_TARGETS,
    )

    for (const category of PRIMARY_CATEGORIES) {
      expect(CATEGORY_TARGETS[category]).toBeGreaterThan(0)
    }
  })

  test('uses registered workflows, workflow-valid modes, fixtures, and cases', () => {
    for (const scenario of characterizationScenarios) {
      expect(WORKFLOW_KINDS).toContain(scenario.workflow)
      expect(WORKFLOW_MODES[scenario.workflow]).toContain(scenario.mode)

      switch (scenario.workflow) {
        case 'intent':
          expect(INTENT_FIXTURE_IDS).toContain(scenario.fixtureId)
          expect(INTENT_CASE_IDS).toContain(scenario.caseId)
          break
        case 'user-operation':
          expect(USER_OPERATION_FIXTURE_IDS).toContain(scenario.fixtureId)
          expect(USER_OPERATION_CASE_IDS).toContain(scenario.caseId)
          break
        case 'direct-signing':
          expect(DIRECT_SIGNING_FIXTURE_IDS).toContain(scenario.fixtureId)
          expect(DIRECT_SIGNING_CASE_IDS).toContain(scenario.caseId)
          break
      }
    }
  })

  test('uses every registered axis value and only registered tags', () => {
    for (const scenario of characterizationScenarios) {
      expect(Object.keys(scenario.axes).sort()).toEqual(
        Object.keys(AXIS_VOCABULARY).sort(),
      )
      for (const axis of Object.keys(
        AXIS_VOCABULARY,
      ) as CharacterizationAxis[]) {
        expect(
          scenario.axes[axis].length,
          `${scenario.id}:${axis}`,
        ).toBeGreaterThan(0)
        for (const value of scenario.axes[axis]) {
          expect(
            AXIS_VOCABULARY[axis],
            `${scenario.id}:${axis}:${value}`,
          ).toContain(value)
        }
      }
      for (const tag of scenario.tags) {
        expect(SCENARIO_TAGS, `${scenario.id}:${tag}`).toContain(tag)
      }
    }

    for (const axis of Object.keys(AXIS_VOCABULARY) as CharacterizationAxis[]) {
      const used = new Set(
        characterizationScenarios.flatMap((scenario) => scenario.axes[axis]),
      )
      for (const value of AXIS_VOCABULARY[axis]) {
        expect(used, `uncovered ${axis}:${value}`).toContain(value)
      }
    }

    const usedTags = new Set(
      characterizationScenarios.flatMap(({ tags }) => tags),
    )
    for (const tag of SCENARIO_TAGS) {
      expect(usedTags, `unused registered tag ${tag}`).toContain(tag)
    }
  })

  test('makes expected outcomes and terminal semantics auditable', () => {
    for (const scenario of characterizationScenarios) {
      expect(scenario.expected).toBeDefined()
      if (scenario.expected.kind === 'failure') {
        expect(scenario.expected.stage, scenario.id).toBeTruthy()
        expect(scenario.expected.errorClass, scenario.id).toBeTruthy()
        expect(scenario.expected.messageInvariant, scenario.id).toBeTruthy()
        expect(scenario.tags, scenario.id).toContain('negative')
      }
      if (scenario.mode === 'execute') {
        expect(scenario.terminalAssertions.length, scenario.id).toBeGreaterThan(
          0,
        )
        expect(scenario.normalization, scenario.id).toContain(
          'transaction-hash',
        )
        expect(scenario.normalization, scenario.id).toContain('receipt-block')
      }
    }
  })

  test('records executable support and offline fallback evidence', () => {
    for (const scenario of characterizationScenarios) {
      if (scenario.support.level === 'dry-run-only') {
        expect(scenario.mode, scenario.id).toBe('dryRun')
        expect(scenario.support.limitation, scenario.id).toBeTruthy()
      }
      if (scenario.support.level === 'offline-only') {
        expect(scenario.support.limitation, scenario.id).toBeTruthy()
        expect(scenario.support.coverageRef, scenario.id).toBeTruthy()
        expect(existsSync(scenario.support.coverageRef), scenario.id).toBe(true)
        expect(scenario.support.coverageRef, scenario.id).toMatch(
          /\.(?:test|itest)\.ts$/u,
        )
      }
    }
  })

  test('publishes exhaustive unique handler registries', () => {
    expect(new Set(CHARACTERIZATION_HANDLER_KEYS).size).toBe(
      CHARACTERIZATION_HANDLER_KEYS.length,
    )
    expect(CHARACTERIZATION_HANDLER_KEYS).toEqual(
      [...new Set(characterizationScenarios.map(getScenarioHandlerKey))].sort(),
    )
    expect(EXECUTABLE_CHARACTERIZATION_HANDLER_KEYS).toEqual(
      [
        ...new Set(
          characterizationScenarios
            .filter(isExecutableCharacterizationScenario)
            .map(getScenarioHandlerKey),
        ),
      ].sort(),
    )
  })

  test('includes every mandatory high-risk combination', () => {
    expectHighRiskCombination(
      'high-risk:undeployed-safe-passkey-cross-chain',
      (scenario) =>
        hasAxis(scenario, 'account', 'safe') &&
        hasAxis(scenario, 'account', 'state:new') &&
        hasAxis(scenario, 'owner', 'passkey:single') &&
        hasAxis(scenario, 'operation', 'intent:cross-chain'),
    )
    expectHighRiskCombination(
      'high-risk:deployed-safe-threshold-independent',
      (scenario) =>
        hasAxis(scenario, 'account', 'safe') &&
        hasAxis(scenario, 'account', 'state:deployed') &&
        hasAxis(scenario, 'owner', 'ecdsa:multi-threshold-many') &&
        hasAxis(scenario, 'owner', 'signing:independent'),
    )
    expectHighRiskCombination(
      'high-risk:nexus-eip7702-signing',
      (scenario) =>
        hasAxis(scenario, 'account', 'nexus') &&
        hasAxis(scenario, 'account', 'state:eip7702') &&
        (hasAxis(scenario, 'operation', 'sign:message') ||
          hasAxis(scenario, 'operation', 'sign:typed-data')),
    )
    expectHighRiskCombination(
      'high-risk:kernel-version-session-enable-use',
      (scenario) =>
        hasAxis(scenario, 'account', 'kernel') &&
        scenario.axes.account.some((value) => value.startsWith('kernel:')) &&
        hasAxis(scenario, 'session', 'action:enable') &&
        hasAxis(scenario, 'session', 'action:use'),
    )
    expectHighRiskCombination(
      'high-risk:startale-cross-chain-destination-signing',
      (scenario) =>
        hasAxis(scenario, 'account', 'startale') &&
        hasAxis(scenario, 'operation', 'intent:cross-chain') &&
        hasAxis(scenario, 'session', 'destination:explicit'),
    )
    expectHighRiskCombination(
      'high-risk:hca-custom-factory-default-validator',
      (scenario) =>
        hasAxis(scenario, 'account', 'hca') &&
        hasAxis(scenario, 'account', 'factory:custom') &&
        hasAxis(scenario, 'owner', 'validator:default'),
    )
    expectHighRiskCombination(
      'high-risk:per-chain-session-asymmetry',
      (scenario) =>
        hasAxis(scenario, 'session', 'signers:per-chain') &&
        hasAxis(scenario, 'session', 'owners:per-chain') &&
        hasAxis(scenario, 'operation', 'intent:cross-chain'),
    )
    expectHighRiskCombination(
      'high-risk:mfa-threshold-aggregation',
      (scenario) =>
        hasAxis(scenario, 'owner', 'mfa:ecdsa-passkey') &&
        hasAxis(scenario, 'owner', 'threshold:max'),
    )
    expectHighRiskCombination(
      'high-risk:cross-chain-permit-claim-recipient',
      (scenario) =>
        hasAxis(scenario, 'session', 'permit:cross-chain') &&
        hasAxis(scenario, 'session', 'policy:permit2-claim') &&
        hasAxis(scenario, 'session', 'recipient:override'),
    )
    expectHighRiskCombination(
      'high-risk:source-call-funds-cross-chain-token',
      (scenario) =>
        hasAxis(scenario, 'operation', 'source-calls:with-funds') &&
        hasAxis(scenario, 'operation', 'intent:cross-chain') &&
        (hasAxis(scenario, 'operation', 'asset:erc20') ||
          hasAxis(scenario, 'operation', 'asset:chain-token')),
    )
    expectHighRiskCombination(
      'high-risk:deployless-erc6492-erc1271',
      (scenario) =>
        hasAxis(scenario, 'operation', 'verify:erc6492') &&
        hasAxis(scenario, 'operation', 'verify:erc1271'),
    )
    expectHighRiskCombination(
      'high-risk:custom-module-capability-resolution',
      (scenario) =>
        hasAxis(scenario, 'owner', 'validator:custom-module') &&
        scenario.axes.account.some(
          (value) => value.includes(':') && !value.startsWith('state:'),
        ),
    )
  })
})
