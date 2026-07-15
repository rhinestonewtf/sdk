import { describe, expect, test } from 'vitest'
import { parseCharacterizationEnvironment, selectScenarios } from './selection'
import { assignScenariosToShards } from './sharding'
import type { CharacterizationScenario } from './types'

const BASE_SHA = '49efb8b8d957b2eea2b24c11ac56d6c4d80478d6'

describe('parseCharacterizationEnvironment', () => {
  test('parses an explicit local legacy subset', () => {
    const parsed = parseCharacterizationEnvironment('single', {
      SDK_ITEST_SUBJECT: 'legacy',
      SDK_ITEST_BASE_SHA: BASE_SHA,
      SDK_ITEST_TAGS: 'any:smoke,negative',
      SDK_ITEST_MODE: 'sign,dryRun',
    })

    expect(parsed).toMatchObject({
      command: 'single',
      subject: 'legacy',
      baseSha: BASE_SHA,
      filters: {
        modes: ['sign', 'dryRun'],
        tags: { match: 'any', tags: ['smoke', 'negative'] },
      },
    })
  })

  test('requires a run ID for full and sharded runs', () => {
    expect(() =>
      parseCharacterizationEnvironment('single', {
        SDK_ITEST_SUBJECT: 'public',
      }),
    ).toThrow('SDK_ITEST_RUN_ID')

    expect(() =>
      parseCharacterizationEnvironment('single', {
        SDK_ITEST_SUBJECT: 'public',
        SDK_ITEST_TAGS: 'smoke',
        SDK_ITEST_SHARD: '1/2',
      }),
    ).toThrow('SDK_ITEST_RUN_ID')
  })

  test('rejects moving refs and invalid baseline updates', () => {
    expect(() =>
      parseCharacterizationEnvironment('single', {
        SDK_ITEST_SUBJECT: 'legacy',
        SDK_ITEST_BASE_SHA: 'origin/release',
        SDK_ITEST_TAGS: 'smoke',
      }),
    ).toThrow('full lowercase Git SHA')

    expect(() =>
      parseCharacterizationEnvironment('single', {
        SDK_ITEST_SUBJECT: 'rewrite',
        SDK_ITEST_TAGS: 'smoke',
        SDK_ITEST_UPDATE_BASELINE: '1',
      }),
    ).toThrow('only be updated by the legacy subject')
  })

  test('parses an ordered pair and rejects duplicate subjects', () => {
    expect(
      parseCharacterizationEnvironment('compare', {
        SDK_ITEST_COMPARE: 'legacy,rewrite',
        SDK_ITEST_BASE_SHA: BASE_SHA,
        SDK_ITEST_RUN_ID: 'calibration-1',
      }),
    ).toMatchObject({ subjects: ['legacy', 'rewrite'] })

    expect(() =>
      parseCharacterizationEnvironment('compare', {
        SDK_ITEST_COMPARE: 'legacy,legacy',
        SDK_ITEST_BASE_SHA: BASE_SHA,
        SDK_ITEST_RUN_ID: 'calibration-1',
      }),
    ).toThrow('two different ordered subjects')
  })
})

describe('scenario selection and sharding', () => {
  const scenarios = [
    makeScenario('a', 'sign', ['smoke']),
    makeScenario('b', 'dryRun', ['negative']),
    makeScenario('c', 'execute', ['smoke', 'stateful']),
  ]

  test('applies tag semantics without changing the catalog', () => {
    const selected = selectScenarios(scenarios, {
      filters: {
        workflows: [],
        modes: [],
        tags: { match: 'all', tags: ['smoke', 'stateful'] },
      },
    })

    expect(selected.map(({ id }) => id)).toEqual(['c'])
    expect(scenarios).toHaveLength(3)
  })

  test('assigns scenarios deterministically and across valid lanes', () => {
    const forward = assignScenariosToShards(scenarios, 2)
    const reverse = assignScenariosToShards([...scenarios].reverse(), 2)

    expect([...forward.entries()].sort()).toEqual([...reverse.entries()].sort())
    expect(new Set(forward.values())).toEqual(new Set([1, 2]))
  })
})

function makeScenario(
  id: string,
  mode: 'sign' | 'dryRun' | 'execute',
  tags: CharacterizationScenario['tags'],
): CharacterizationScenario {
  return {
    id,
    workflow: 'intent',
    mode,
    fixtureId: 'safe-ecdsa',
    caseId: 'same-chain-noop',
    primaryCategory: 'intents',
    axes: {
      account: ['safe'],
      owner: ['ecdsa:single'],
      session: ['none'],
      operation: ['intent:same-chain'],
      infrastructure: ['auth:current'],
    },
    tags,
    support: { level: 'live' },
    expected: { kind: 'success' },
    setup: {
      identity: 'deterministic',
      preconditions: ['none'],
      funding: 'none',
      uniqueness: 'scenario-id',
      cleanup: 'none',
    },
    comparison: 'shared-inputs',
    observations: ['prepared-payload'],
    normalization: [],
    terminalAssertions: mode === 'execute' ? ['intent-completed'] : [],
    timeoutMs: 180_000,
  }
}
