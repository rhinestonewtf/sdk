import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { aggregateRun } from './aggregate'
import {
  ARTIFACT_SCHEMA_VERSION,
  assertScenarioCheckpointAccepted,
  CATALOG_VERSION,
  getScenarioCheckpointPath,
  getShardArtifactPath,
  type ScenarioArtifact,
  writeScenarioCheckpoint,
  writeShardArtifact,
} from './artifacts'
import type { CharacterizationScenario } from './types'

const directories: string[] = []
const baseSha = '49efb8b8d957b2eea2b24c11ac56d6c4d80478d6'

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('characterization artifacts', () => {
  test('writes a stable artifact once and refuses duplicate shard output', async () => {
    const resultsDir = await temporaryDirectory()
    const artifact = makeArtifact('a', 'legacy', 'run-1')
    const file = await writeShardArtifact(resultsDir, {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      catalogVersion: CATALOG_VERSION,
      baseSha,
      runId: 'run-1',
      subject: 'legacy',
      shard: { index: 1, total: 1 },
      generatedAt: '2026-07-15T00:00:00.000Z',
      secretScan: 'passed',
      scenarios: [artifact],
    })

    expect(file).toBe(
      getShardArtifactPath(resultsDir, 'run-1', 'legacy', {
        index: 1,
        total: 1,
      }),
    )
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      runId: 'run-1',
      subject: 'legacy',
    })
    await expect(
      writeShardArtifact(resultsDir, {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        catalogVersion: CATALOG_VERSION,
        baseSha,
        runId: 'run-1',
        subject: 'legacy',
        shard: { index: 1, total: 1 },
        generatedAt: '2026-07-15T00:00:00.000Z',
        secretScan: 'passed',
        scenarios: [artifact],
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' })
  })

  test('checkpoints an accepted scenario before diagnostics are asserted', async () => {
    const resultsDir = await temporaryDirectory()
    const artifact = makeArtifact(
      'intents/accepted',
      'legacy',
      'run-checkpoint',
    )
    const result = await writeScenarioCheckpoint(resultsDir, {
      baseSha,
      runId: 'run-checkpoint',
      subject: 'legacy',
      shard: { index: 1, total: 2 },
      generatedAt: '2026-07-15T00:00:00.000Z',
      artifact,
    })

    expect(result.file).toBe(
      getScenarioCheckpointPath(
        resultsDir,
        'run-checkpoint',
        'legacy',
        artifact.scenarioId,
      ),
    )
    expect(result.checkpoint.result).toMatchObject({
      status: 'recorded',
      artifact: { scenarioId: artifact.scenarioId },
    })
    expect(() => assertScenarioCheckpointAccepted(result)).not.toThrow()
    await expect(
      writeScenarioCheckpoint(resultsDir, {
        baseSha,
        runId: 'run-checkpoint',
        subject: 'legacy',
        shard: { index: 1, total: 2 },
        generatedAt: '2026-07-15T00:00:00.000Z',
        artifact,
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' })
  })

  test('writes a safe rejection without erasing sibling evidence', async () => {
    const resultsDir = await temporaryDirectory()
    const runId = 'run-rejected'
    const sibling = await writeScenarioCheckpoint(resultsDir, {
      baseSha,
      runId,
      subject: 'legacy',
      generatedAt: '2026-07-15T00:00:00.000Z',
      artifact: makeArtifact('intents/sibling', 'legacy', runId),
    })
    const secret = 'Bearer this-value-must-not-reach-diagnostics'
    const unsafeBase = makeArtifact('intents/unsafe', 'legacy', runId)
    const unsafe: ScenarioArtifact = {
      ...unsafeBase,
      status: 'failed',
      diagnostics: [`expected success, received submit Error: ${secret}`],
      observation: {
        ...unsafeBase.observation,
        outcome: {
          status: 'failure',
          error: {
            phase: 'submit',
            class: 'Error',
            name: 'Error',
            message: secret,
          },
        },
      },
    }
    const rejected = await writeScenarioCheckpoint(resultsDir, {
      baseSha,
      runId,
      subject: 'legacy',
      generatedAt: '2026-07-15T00:00:01.000Z',
      artifact: unsafe,
    })

    expect(rejected.checkpoint.result).toMatchObject({
      status: 'rejected',
      rejection: { kind: 'secret-scan' },
    })
    const serialized = await readFile(rejected.file, 'utf8')
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('expected success')
    expect(await readFile(sibling.file, 'utf8')).toContain('intents/sibling')
    try {
      assertScenarioCheckpointAccepted(rejected)
      expect.unreachable()
    } catch (error) {
      expect(String(error)).toContain('auth-header at')
      expect(String(error)).not.toContain(secret)
    }
  })

  test('records nonserializable scenario rejection without raw details', async () => {
    const resultsDir = await temporaryDirectory()
    const runId = 'run-nonserializable'
    const artifact: ScenarioArtifact = {
      ...makeArtifact('intents/nonserializable', 'legacy', runId),
      normalizedObservation: { callback: () => undefined },
    }
    const rejected = await writeScenarioCheckpoint(resultsDir, {
      baseSha,
      runId,
      subject: 'legacy',
      generatedAt: '2026-07-15T00:00:00.000Z',
      artifact,
    })

    expect(rejected.checkpoint.result).toEqual({
      status: 'rejected',
      rejection: { kind: 'serialization' },
    })
    expect(
      JSON.parse(await readFile(rejected.file, 'utf8')),
    ).not.toHaveProperty('result.artifact')
    expect(() => assertScenarioCheckpointAccepted(rejected)).toThrow(
      'unsupported artifact value',
    )
  })

  test('aggregates a complete deterministic subject/shard matrix', async () => {
    const resultsDir = await temporaryDirectory()
    const catalog = [makeScenario('a'), makeScenario('b')]

    for (const subject of ['legacy', 'rewrite'] as const) {
      await writeShardArtifact(resultsDir, {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        catalogVersion: CATALOG_VERSION,
        baseSha,
        runId: 'run-2',
        subject,
        comparison: { subjects: ['legacy', 'rewrite'] },
        shard: { index: 1, total: 1 },
        generatedAt: '2026-07-15T00:00:00.000Z',
        secretScan: 'passed',
        scenarios: catalog.map(({ id }) => makeArtifact(id, subject, 'run-2')),
      })
    }

    await expect(
      aggregateRun({
        resultsDir,
        runId: 'run-2',
        baseSha,
        subjects: ['legacy', 'rewrite'],
        shardCount: 1,
        catalog,
      }),
    ).resolves.toEqual({
      runId: 'run-2',
      subjects: ['legacy', 'rewrite'],
      shardCount: 1,
      scenarioCount: 2,
      artifactCount: 2,
    })
  })

  test('fails a matrix with a missing shard', async () => {
    const resultsDir = await temporaryDirectory()

    await expect(
      aggregateRun({
        resultsDir,
        runId: 'missing',
        baseSha,
        subjects: ['legacy'],
        shardCount: 1,
        catalog: [makeScenario('a')],
      }),
    ).rejects.toThrow('Missing characterization shard')
  })

  test('recomputes paired comparisons instead of trusting stored counters', async () => {
    const resultsDir = await temporaryDirectory()
    const catalog = [makeScenario('a')]
    for (const subject of ['legacy', 'rewrite'] as const) {
      const artifact = makeArtifact('a', subject, 'run-divergent')
      await writeShardArtifact(resultsDir, {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        catalogVersion: CATALOG_VERSION,
        baseSha,
        runId: 'run-divergent',
        subject,
        comparison: { subjects: ['legacy', 'rewrite'] },
        shard: { index: 1, total: 1 },
        generatedAt: '2026-07-15T00:00:00.000Z',
        secretScan: 'passed',
        scenarios: [
          subject === 'rewrite'
            ? {
                ...artifact,
                normalizedObservation: { changed: true },
                unexplainedDeltas: 0,
              }
            : artifact,
        ],
      })
    }

    await expect(
      aggregateRun({
        resultsDir,
        runId: 'run-divergent',
        baseSha,
        subjects: ['legacy', 'rewrite'],
        shardCount: 1,
        catalog,
      }),
    ).rejects.toThrow('diverged for a')
  })
})

function makeArtifact(
  scenarioId: string,
  subject: 'legacy' | 'rewrite' = 'legacy',
  runId = 'run-1',
): ScenarioArtifact {
  return {
    scenarioId,
    status: 'passed',
    durationMs: 10,
    observation: {
      schemaVersion: 1,
      scenarioId,
      workflow: 'intent',
      subject,
      runId,
      comparisonGroup: 'group',
      mode: 'sign',
      sign: {},
      outcome: { status: 'success' },
    },
    normalizedObservation: {},
    appliedNormalizations: [],
    appliedIdentities: [],
    unexplainedDeltas: 0,
  }
}

function makeScenario(id: string): CharacterizationScenario {
  return {
    id,
    workflow: 'intent',
    mode: 'sign',
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
    tags: [],
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
    terminalAssertions: [],
    timeoutMs: 180_000,
  }
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sdk-characterization-'))
  directories.push(directory)
  return directory
}
