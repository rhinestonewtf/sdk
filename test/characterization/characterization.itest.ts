import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { PreparedTransactionData } from '../../src/index'
import {
  ARTIFACT_SCHEMA_VERSION,
  assertScenarioCheckpointAccepted,
  CATALOG_VERSION,
  type ScenarioArtifact,
  writeScenarioCheckpoint,
  writeShardArtifact,
} from './artifacts'
import { writeBaselineSet } from './baseline'
import {
  characterizationScenarios,
  isExecutableCharacterizationScenario,
} from './catalog'
import { getCharacterizationEnvironmentIdentity } from './environment'
import {
  assertCharacterizationHandlerCoverage,
  assertCharacterizationSubjectAvailable,
  assertLegacyOracleSourceUnchanged,
  compareScenarioArtifacts,
  resolveCharacterizationBaseSha,
  runCharacterizationScenario,
} from './runner'
import { parseCharacterizationEnvironment, selectScenarios } from './selection'
import type { CharacterizationSubject } from './types'

const command = process.env.SDK_ITEST_COMPARE ? 'compare' : 'single'
const environment = parseCharacterizationEnvironment(command)
if (environment.command === 'aggregate') {
  throw new Error(
    'The Vitest characterization entry cannot aggregate artifacts',
  )
}
const executableCatalog = characterizationScenarios.filter(
  isExecutableCharacterizationScenario,
)
const scenarios = selectScenarios(executableCatalog, environment)
const subjects =
  environment.command === 'single'
    ? ([environment.subject] as const)
    : environment.subjects
const results = new Map<CharacterizationSubject, ScenarioArtifact[]>(
  subjects.map((subject) => [subject, []]),
)

let baseSha = ''
const runId = environment.runId ?? `local-${process.pid}`

assertCharacterizationHandlerCoverage()
for (const subject of subjects) assertCharacterizationSubjectAvailable(subject)
if (scenarios.length === 0) {
  throw new Error('Characterization filters selected no executable scenarios')
}
if (
  environment.command === 'single' &&
  environment.updateBaseline &&
  (environment.shard || scenarios.length !== executableCatalog.length)
) {
  throw new Error('Baseline updates require an unfiltered, unsharded full run')
}

beforeAll(async () => {
  if (
    scenarios.some(({ mode }) => mode === 'dryRun') &&
    !process.env.INTEGRATION_RHINESTONE_API_RELAYER_KEY &&
    !process.env.INTEGRATION_RELAYER_API_KEY
  ) {
    throw new Error(
      'INTEGRATION_RHINESTONE_API_RELAYER_KEY with orchestrator relayer scope is required for characterization dry-run scenarios',
    )
  }
  baseSha = await resolveCharacterizationBaseSha(environment.baseSha)
  if (subjects.includes('legacy')) {
    await assertLegacyOracleSourceUnchanged(baseSha)
  }
})

afterAll(async () => {
  if (!baseSha) return
  for (const subject of subjects) {
    const subjectResults = results.get(subject) ?? []
    await writeShardArtifact(environment.resultsDir, {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      catalogVersion: CATALOG_VERSION,
      baseSha,
      runId,
      subject,
      ...(environment.command === 'compare'
        ? { comparison: { subjects: environment.subjects } }
        : {}),
      ...(environment.shard ? { shard: environment.shard } : {}),
      generatedAt: new Date().toISOString(),
      secretScan: 'passed',
      scenarios: subjectResults,
    })
  }

  if (environment.command === 'single' && environment.updateBaseline) {
    if (environment.shard) {
      throw new Error('Baseline updates require an unsharded full run')
    }
    const subjectResults = results.get(environment.subject) ?? []
    await writeBaselineSet({
      directory: path.resolve('test/characterization/baselines'),
      subject: environment.subject,
      updateRequested: true,
      baseSha,
      environment: getCharacterizationEnvironmentIdentity(),
      catalog: characterizationScenarios,
      scenarioResults: subjectResults,
    })
  }
})

async function checkpointScenario(
  subject: CharacterizationSubject,
  artifact: ScenarioArtifact,
): Promise<void> {
  const checkpoint = await writeScenarioCheckpoint(environment.resultsDir, {
    baseSha,
    runId,
    subject,
    ...(environment.command === 'compare'
      ? { comparison: { subjects: environment.subjects } }
      : {}),
    ...(environment.shard ? { shard: environment.shard } : {}),
    generatedAt: new Date().toISOString(),
    artifact,
  })
  assertScenarioCheckpointAccepted(checkpoint)
}

describe(`SDK characterization: ${subjects.join(' -> ')}`, () => {
  for (const scenario of scenarios) {
    test(scenario.id, { timeout: scenario.timeoutMs }, async () => {
      if (environment.command === 'single') {
        const artifact = await runCharacterizationScenario(scenario, {
          baseSha,
          runId,
          subject: environment.subject,
        })
        await checkpointScenario(environment.subject, artifact)
        results.get(environment.subject)?.push(artifact)
        expect(artifact.diagnostics ?? [], scenario.id).toEqual([])
        return
      }

      const [referenceSubject, candidateSubject] = environment.subjects
      let preparedReplay: PreparedTransactionData | undefined
      const reference = await runCharacterizationScenario(scenario, {
        baseSha,
        runId,
        subject: referenceSubject,
        ...(scenario.comparison !== 'isolated-state'
          ? { onIntentPrepared: (prepared) => (preparedReplay = prepared) }
          : {}),
      })
      await checkpointScenario(referenceSubject, reference)
      results.get(referenceSubject)?.push(reference)
      const candidate = await runCharacterizationScenario(scenario, {
        baseSha,
        runId,
        subject: candidateSubject,
        ...(scenario.comparison !== 'isolated-state' && preparedReplay
          ? { intentPreparedReplay: preparedReplay }
          : {}),
      })
      await checkpointScenario(candidateSubject, candidate)
      const compared = compareScenarioArtifacts(scenario, reference, candidate)
      results.get(candidateSubject)?.push(compared)
      expect(reference.diagnostics ?? [], scenario.id).toEqual([])
      expect(compared.diagnostics ?? [], scenario.id).toEqual([])
    })
  }
})
