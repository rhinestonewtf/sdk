import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppliedIdentityMapping, AppliedNormalization } from './normalize'
import type { CharacterizationObservation } from './observe'
import {
  assertNoSecrets,
  type SecretFindingKind,
  SecretScanError,
} from './secrets'
import { serializeArtifact } from './serialization'
import type { Shard } from './sharding'
import type { CharacterizationSubject } from './types'

export const ARTIFACT_SCHEMA_VERSION = 1
export const CATALOG_VERSION = 1

export type ScenarioArtifact = {
  readonly scenarioId: string
  readonly status: 'passed' | 'failed'
  readonly diagnostics?: readonly string[]
  readonly durationMs: number
  readonly observation: CharacterizationObservation
  readonly normalizedObservation: unknown
  readonly appliedNormalizations: readonly AppliedNormalization[]
  readonly appliedIdentities: readonly AppliedIdentityMapping[]
  readonly unexplainedDeltas: number
}

export type ShardArtifact = {
  readonly schemaVersion: typeof ARTIFACT_SCHEMA_VERSION
  readonly catalogVersion: typeof CATALOG_VERSION
  readonly baseSha: string
  readonly runId: string
  readonly subject: CharacterizationSubject
  readonly comparison?: {
    readonly subjects: readonly [
      CharacterizationSubject,
      CharacterizationSubject,
    ]
  }
  readonly shard?: Shard
  readonly generatedAt: string
  readonly secretScan: 'passed'
  readonly scenarios: readonly ScenarioArtifact[]
}

export type ScenarioCheckpointRejection =
  | {
      readonly kind: 'secret-scan'
      readonly findings: readonly {
        readonly kind: SecretFindingKind
        readonly path: string
      }[]
    }
  | { readonly kind: 'serialization' }

export type ScenarioCheckpoint = {
  readonly schemaVersion: typeof ARTIFACT_SCHEMA_VERSION
  readonly catalogVersion: typeof CATALOG_VERSION
  readonly baseSha: string
  readonly runId: string
  readonly subject: CharacterizationSubject
  readonly scenarioId: string
  readonly comparison?: ShardArtifact['comparison']
  readonly shard?: Shard
  readonly generatedAt: string
  readonly secretScan: 'passed'
  readonly result:
    | { readonly status: 'recorded'; readonly artifact: ScenarioArtifact }
    | {
        readonly status: 'rejected'
        readonly rejection: ScenarioCheckpointRejection
      }
}

export type ScenarioCheckpointWriteResult = {
  readonly file: string
  readonly checkpoint: ScenarioCheckpoint
}

type ScenarioCheckpointInput = Pick<
  ScenarioCheckpoint,
  'baseSha' | 'runId' | 'subject' | 'comparison' | 'shard' | 'generatedAt'
> & {
  readonly artifact: ScenarioArtifact
}

export class ScenarioCheckpointRejectedError extends Error {
  readonly rejection: ScenarioCheckpointRejection

  constructor(checkpoint: ScenarioCheckpoint) {
    if (checkpoint.result.status !== 'rejected') {
      throw new Error(
        `Cannot create a rejection error for recorded scenario ${checkpoint.scenarioId}`,
      )
    }
    const { rejection } = checkpoint.result
    const detail =
      rejection.kind === 'secret-scan'
        ? rejection.findings
            .map((finding) => `${finding.kind} at ${finding.path}`)
            .join(', ')
        : 'unsupported artifact value'
    super(
      `Scenario checkpoint rejected for ${checkpoint.scenarioId}: ${detail}`,
    )
    this.name = 'ScenarioCheckpointRejectedError'
    this.rejection = rejection
  }
}

export async function writeScenarioCheckpoint(
  resultsDir: string,
  input: ScenarioCheckpointInput,
): Promise<ScenarioCheckpointWriteResult> {
  assertScenarioCheckpointContext(input)
  const metadata: Omit<ScenarioCheckpoint, 'result'> = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    catalogVersion: CATALOG_VERSION,
    baseSha: input.baseSha,
    runId: input.runId,
    subject: input.subject,
    scenarioId: input.artifact.scenarioId,
    ...(input.comparison ? { comparison: input.comparison } : {}),
    ...(input.shard ? { shard: input.shard } : {}),
    generatedAt: input.generatedAt,
    secretScan: 'passed' as const,
  }
  let checkpoint: ScenarioCheckpoint = {
    ...metadata,
    result: { status: 'recorded', artifact: input.artifact },
  }
  let serialized: string
  try {
    serialized = serializeArtifact(checkpoint)
  } catch (error) {
    checkpoint = {
      ...metadata,
      result: {
        status: 'rejected',
        rejection: checkpointRejection(error),
      },
    }
    serialized = serializeArtifact(checkpoint)
  }

  const file = getScenarioCheckpointPath(
    resultsDir,
    input.runId,
    input.subject,
    input.artifact.scenarioId,
  )
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, serialized, { encoding: 'utf8', flag: 'wx' })
  return { file, checkpoint }
}

export function assertScenarioCheckpointAccepted(
  result: ScenarioCheckpointWriteResult,
): void {
  if (result.checkpoint.result.status === 'rejected') {
    throw new ScenarioCheckpointRejectedError(result.checkpoint)
  }
}

export async function writeShardArtifact(
  resultsDir: string,
  artifact: ShardArtifact,
): Promise<string> {
  const file = getShardArtifactPath(
    resultsDir,
    artifact.runId,
    artifact.subject,
    artifact.shard,
  )
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, serializeArtifact(artifact), {
    encoding: 'utf8',
    flag: 'wx',
  })
  return file
}

export async function readShardArtifact(file: string): Promise<ShardArtifact> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'))
  assertNoSecrets(value)
  assertShardArtifact(value, file)
  return value
}

export function getShardArtifactPath(
  resultsDir: string,
  runId: string,
  subject: CharacterizationSubject,
  shard?: Shard,
): string {
  const filename = shard
    ? `shard-${shard.index}-of-${shard.total}.json`
    : 'unsharded.json'
  return path.join(resultsDir, runId, subject, filename)
}

export function getScenarioCheckpointPath(
  resultsDir: string,
  runId: string,
  subject: CharacterizationSubject,
  scenarioId: string,
): string {
  assertSafeScenarioId(scenarioId)
  return path.join(
    resultsDir,
    runId,
    subject,
    'scenarios',
    `${scenarioId}.json`,
  )
}

function checkpointRejection(error: unknown): ScenarioCheckpointRejection {
  if (error instanceof SecretScanError) {
    return {
      kind: 'secret-scan',
      findings: error.findings.map(({ kind, path: findingPath }) => ({
        kind,
        path: findingPath,
      })),
    }
  }
  return { kind: 'serialization' }
}

function assertScenarioCheckpointContext(input: ScenarioCheckpointInput): void {
  const { artifact } = input
  assertSafeScenarioId(artifact.scenarioId)
  if (
    artifact.observation.scenarioId !== artifact.scenarioId ||
    artifact.observation.runId !== input.runId ||
    artifact.observation.subject !== input.subject
  ) {
    throw new Error(
      `Scenario checkpoint context does not match ${artifact.scenarioId}`,
    )
  }
}

function assertSafeScenarioId(scenarioId: string): void {
  if (
    !/^[a-z0-9]+(?:[/-][a-z0-9.]+)*$/u.test(scenarioId) ||
    scenarioId.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid characterization scenario ID ${scenarioId}`)
  }
}

function assertShardArtifact(
  value: unknown,
  source: string,
): asserts value is ShardArtifact {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Invalid characterization artifact object in ${source}`)
  }
  const candidate = value as Partial<ShardArtifact>
  if (
    candidate.schemaVersion !== ARTIFACT_SCHEMA_VERSION ||
    candidate.catalogVersion !== CATALOG_VERSION ||
    typeof candidate.baseSha !== 'string' ||
    typeof candidate.runId !== 'string' ||
    !['legacy', 'rewrite', 'public'].includes(candidate.subject ?? '') ||
    !isValidComparison(candidate.comparison) ||
    candidate.secretScan !== 'passed' ||
    !Array.isArray(candidate.scenarios)
  ) {
    throw new Error(`Invalid characterization artifact metadata in ${source}`)
  }
}

function isValidComparison(
  value: ShardArtifact['comparison'] | undefined,
): boolean {
  if (value === undefined) return true
  return (
    Array.isArray(value.subjects) &&
    value.subjects.length === 2 &&
    value.subjects[0] !== value.subjects[1] &&
    value.subjects.every((subject) =>
      ['legacy', 'rewrite', 'public'].includes(subject),
    )
  )
}
