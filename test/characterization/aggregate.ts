import { access } from 'node:fs/promises'
import {
  getShardArtifactPath,
  readShardArtifact,
  type ScenarioArtifact,
  type ShardArtifact,
} from './artifacts'
import { compareScenarioValues } from './comparison-strategy'
import { assignScenariosToShards } from './sharding'
import type { CharacterizationScenario, CharacterizationSubject } from './types'

type AggregateInput = {
  readonly resultsDir: string
  readonly runId: string
  readonly baseSha: string
  readonly subjects: readonly CharacterizationSubject[]
  readonly shardCount: number
  readonly catalog: readonly CharacterizationScenario[]
}

export type AggregateResult = {
  readonly runId: string
  readonly subjects: readonly CharacterizationSubject[]
  readonly shardCount: number
  readonly scenarioCount: number
  readonly artifactCount: number
}

export async function aggregateRun({
  resultsDir,
  runId,
  baseSha,
  subjects,
  shardCount,
  catalog,
}: AggregateInput): Promise<AggregateResult> {
  if (subjects.length === 0 || new Set(subjects).size !== subjects.length) {
    throw new Error('Aggregate subjects must be non-empty and unique')
  }
  const expectedAssignments = assignScenariosToShards(catalog, shardCount)
  const artifacts: ShardArtifact[] = []
  const resultsBySubject = new Map<
    CharacterizationSubject,
    Map<string, ScenarioArtifact>
  >()

  for (const subject of subjects) {
    const observedScenarioIds = new Set<string>()
    const subjectResults = new Map<string, ScenarioArtifact>()
    for (let index = 1; index <= shardCount; index += 1) {
      const shard = { index, total: shardCount }
      const file = getShardArtifactPath(resultsDir, runId, subject, shard)
      try {
        await access(file)
      } catch {
        throw new Error(`Missing characterization shard ${file}`)
      }
      const artifact = await readShardArtifact(file)
      assertMetadata(artifact, { runId, baseSha, subject, shard, subjects })
      assertShardScenarios(
        artifact,
        catalog,
        expectedAssignments,
        observedScenarioIds,
      )
      for (const result of artifact.scenarios) {
        subjectResults.set(result.scenarioId, result)
      }
      artifacts.push(artifact)
    }
    if (observedScenarioIds.size !== catalog.length) {
      throw new Error(
        `${subject} produced ${observedScenarioIds.size}/${catalog.length} catalog scenarios`,
      )
    }
    resultsBySubject.set(subject, subjectResults)
  }

  assertSubjectComparisons(subjects, catalog, resultsBySubject)

  return {
    runId,
    subjects,
    shardCount,
    scenarioCount: catalog.length,
    artifactCount: artifacts.length,
  }
}

function assertSubjectComparisons(
  subjects: readonly CharacterizationSubject[],
  catalog: readonly CharacterizationScenario[],
  results: ReadonlyMap<
    CharacterizationSubject,
    ReadonlyMap<string, ScenarioArtifact>
  >,
): void {
  if (subjects.length < 2) return
  const referenceSubject = subjects[0]
  const referenceResults = results.get(referenceSubject)
  if (!referenceResults) {
    throw new Error(`Missing comparison reference subject ${referenceSubject}`)
  }

  for (const candidateSubject of subjects.slice(1)) {
    const candidateResults = results.get(candidateSubject)
    if (!candidateResults) {
      throw new Error(
        `Missing comparison candidate subject ${candidateSubject}`,
      )
    }
    for (const scenario of catalog) {
      const reference = referenceResults.get(scenario.id)
      const candidate = candidateResults.get(scenario.id)
      if (!reference || !candidate) {
        throw new Error(`Missing paired result for ${scenario.id}`)
      }
      const comparison = compareScenarioValues(
        scenario,
        reference.normalizedObservation,
        candidate.normalizedObservation,
      )
      if (!comparison.equal) {
        throw new Error(
          `${referenceSubject}/${candidateSubject} diverged for ${scenario.id}: ${comparison.deltas.map(({ path, kind }) => `${path} (${kind})`).join(', ')}`,
        )
      }
      if (candidate.unexplainedDeltas !== comparison.deltas.length) {
        throw new Error(
          `${scenario.id} stored ${candidate.unexplainedDeltas} deltas but aggregation computed ${comparison.deltas.length}`,
        )
      }
    }
  }
}

function assertMetadata(
  artifact: ShardArtifact,
  expected: {
    runId: string
    baseSha: string
    subject: CharacterizationSubject
    shard: { index: number; total: number }
    subjects: readonly CharacterizationSubject[]
  },
): void {
  const comparisonSubjects = artifact.comparison?.subjects
  if (
    artifact.runId !== expected.runId ||
    artifact.baseSha !== expected.baseSha ||
    artifact.subject !== expected.subject ||
    artifact.shard?.index !== expected.shard.index ||
    artifact.shard.total !== expected.shard.total ||
    (expected.subjects.length > 1 &&
      (comparisonSubjects?.length !== expected.subjects.length ||
        comparisonSubjects.some(
          (subject, index) => subject !== expected.subjects[index],
        )))
  ) {
    throw new Error(
      `Characterization artifact metadata mismatch for ${expected.subject} shard ${expected.shard.index}/${expected.shard.total}`,
    )
  }
}

function assertShardScenarios(
  artifact: ShardArtifact,
  catalog: readonly CharacterizationScenario[],
  assignments: ReadonlyMap<string, number>,
  observed: Set<string>,
): void {
  const catalogIds = new Set(catalog.map(({ id }) => id))
  for (const result of artifact.scenarios) {
    if (!catalogIds.has(result.scenarioId)) {
      throw new Error(`Unknown scenario result ${result.scenarioId}`)
    }
    if (observed.has(result.scenarioId)) {
      throw new Error(`Duplicate scenario result ${result.scenarioId}`)
    }
    if (assignments.get(result.scenarioId) !== artifact.shard?.index) {
      throw new Error(
        `Scenario ${result.scenarioId} is in the wrong deterministic shard`,
      )
    }
    if (
      result.observation.scenarioId !== result.scenarioId ||
      result.observation.subject !== artifact.subject ||
      result.observation.runId !== artifact.runId
    ) {
      throw new Error(
        `Scenario ${result.scenarioId} observation context does not match its shard`,
      )
    }
    if (result.status !== 'passed') {
      throw new Error(`Scenario ${result.scenarioId} failed`)
    }
    if (result.unexplainedDeltas !== 0) {
      throw new Error(
        `Scenario ${result.scenarioId} has ${result.unexplainedDeltas} unexplained deltas`,
      )
    }
    observed.add(result.scenarioId)
  }
}
