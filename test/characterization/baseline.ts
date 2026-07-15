import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { CATALOG_VERSION, type ScenarioArtifact } from './artifacts'
import { isExecutableCharacterizationScenario } from './catalog'
import { type ComparisonDelta, compareObservations } from './compare'
import {
  NORMALIZER_VERSION,
  normalizeScenarioObservation,
} from './normalization-rules'
import type { IdentityMapping } from './normalize'
import type { CharacterizationObservation } from './observe'
import { assertNoSecrets } from './secrets'
import {
  type StableValue,
  serializeArtifact,
  stableStringify,
  toStableValue,
} from './serialization'
import type { CharacterizationScenario, CharacterizationSubject } from './types'

export const BASELINE_SCHEMA_VERSION = 1

const FULL_SHA = /^[0-9a-f]{40}$/u
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const execFileAsync = promisify(execFile)

export type BaselineEnvironmentAttribute =
  | string
  | number
  | boolean
  | readonly (string | number | boolean)[]

export interface BaselineEnvironmentIdentity {
  readonly id: string
  readonly attributes: Readonly<Record<string, BaselineEnvironmentAttribute>>
}

export interface BaselineScenarioResult {
  readonly scenarioId: string
  readonly status: ScenarioArtifact['status']
  readonly observation: CharacterizationObservation
}

export interface BaselineScenarioArtifact {
  readonly schemaVersion: typeof BASELINE_SCHEMA_VERSION
  readonly catalogVersion: typeof CATALOG_VERSION
  readonly normalizerVersion: typeof NORMALIZER_VERSION
  readonly baseSha: string
  readonly environment: BaselineEnvironmentIdentity
  readonly generatedAt: string
  readonly scenarioId: string
  readonly observation: StableValue
  readonly normalizedObservation: StableValue
  readonly appliedNormalizations: StableValue
  readonly appliedIdentities: StableValue
  readonly secretScan: 'passed'
}

export interface BaselineManifestEntry {
  readonly scenarioId: string
  readonly file: string
  readonly sha256: string
}

export interface BaselineManifest {
  readonly schemaVersion: typeof BASELINE_SCHEMA_VERSION
  readonly catalogVersion: typeof CATALOG_VERSION
  readonly normalizerVersion: typeof NORMALIZER_VERSION
  readonly baseSha: string
  readonly environment: BaselineEnvironmentIdentity
  readonly generatedAt: string
  readonly setId: string
  readonly secretScan: 'passed'
  readonly scenarios: readonly BaselineManifestEntry[]
}

export type BaselineCommitVerifier = (baseSha: string) => Promise<string>

export interface WriteBaselineSetOptions {
  readonly directory: string
  readonly subject: CharacterizationSubject
  readonly updateRequested: boolean
  readonly baseSha: string
  readonly environment: BaselineEnvironmentIdentity
  readonly catalog: readonly CharacterizationScenario[]
  readonly scenarioResults: readonly BaselineScenarioResult[]
  readonly verifyCommit?: BaselineCommitVerifier
  readonly verifyEnvironment?: (
    identity: BaselineEnvironmentIdentity,
  ) => Promise<void>
  readonly now?: () => Date
  readonly gitCwd?: string
}

export interface LoadBaselineSetOptions {
  readonly directory: string
  readonly baseSha: string
  readonly environment: BaselineEnvironmentIdentity
  readonly scenarioIds?: readonly string[]
}

export interface LoadedBaselineSet {
  readonly manifest: BaselineManifest
  readonly scenarios: ReadonlyMap<string, BaselineScenarioArtifact>
}

export interface CompareBaselineObservationOptions {
  readonly baseline: BaselineScenarioArtifact
  readonly scenario: CharacterizationScenario
  readonly actualObservation: CharacterizationObservation
  readonly identityMappings?: readonly IdentityMapping[]
  readonly maxDeltas?: number
}

export interface BaselineComparisonEvidence {
  readonly appliedNormalizations: ReturnType<
    typeof normalizeScenarioObservation
  >['appliedRules']
  readonly appliedIdentities: ReturnType<
    typeof normalizeScenarioObservation
  >['appliedIdentities']
}

export interface BaselineComparisonResult {
  readonly scenarioId: string
  readonly equal: boolean
  readonly deltas: readonly ComparisonDelta[]
  readonly truncated: boolean
  readonly baselineEvidence: BaselineComparisonEvidence
  readonly actualEvidence: BaselineComparisonEvidence
}

export async function writeBaselineSet(
  options: WriteBaselineSetOptions,
): Promise<BaselineManifest> {
  assertBaselineUpdateRequest(options)
  await verifyBaseCommit(options)
  await options.verifyEnvironment?.(options.environment)

  const scenarios = validateFullSelection(
    options.catalog,
    options.scenarioResults,
  )
  const generatedAt = (options.now?.() ?? new Date()).toISOString()
  const artifacts = scenarios.map(({ scenario, result }) =>
    createScenarioArtifact({
      scenario,
      result,
      baseSha: options.baseSha,
      environment: options.environment,
      generatedAt,
    }),
  )

  await mkdir(options.directory, { recursive: true })
  const lockPath = path.join(options.directory, '.update.lock')
  const lock = await open(lockPath, 'wx')
  try {
    return await installBaselineSet(options.directory, artifacts, {
      baseSha: options.baseSha,
      environment: options.environment,
      generatedAt,
    })
  } finally {
    await lock.close()
    await rm(lockPath, { force: true })
  }
}

export async function loadBaselineSet(
  options: LoadBaselineSetOptions,
): Promise<LoadedBaselineSet> {
  assertFullSha(options.baseSha)
  assertEnvironmentIdentity(options.environment)

  const manifestFile = path.join(options.directory, 'manifest.json')
  const manifest = parseManifest(
    JSON.parse(await readFile(manifestFile, 'utf8')),
    manifestFile,
  )
  assertExpectedMetadata(manifest, options.baseSha, options.environment)

  const requested = options.scenarioIds
    ? validateRequestedScenarioIds(options.scenarioIds, manifest)
    : new Set(manifest.scenarios.map(({ scenarioId }) => scenarioId))
  const scenarios = new Map<string, BaselineScenarioArtifact>()

  for (const entry of manifest.scenarios) {
    if (!requested.has(entry.scenarioId)) continue
    const file = resolveManifestFile(options.directory, entry.file)
    const serialized = await readFile(file, 'utf8')
    if (sha256(serialized) !== entry.sha256) {
      throw new Error(
        `Characterization baseline digest mismatch for ${entry.scenarioId}`,
      )
    }
    const artifact = parseScenarioArtifact(JSON.parse(serialized), file)
    assertExpectedMetadata(artifact, options.baseSha, options.environment)
    if (artifact.generatedAt !== manifest.generatedAt) {
      throw new Error(
        `Characterization baseline timestamp mismatch for ${entry.scenarioId}`,
      )
    }
    if (artifact.scenarioId !== entry.scenarioId) {
      throw new Error(
        `Characterization baseline scenario mismatch for ${entry.scenarioId}`,
      )
    }
    scenarios.set(entry.scenarioId, artifact)
  }

  return { manifest, scenarios }
}

export function compareBaselineObservation({
  baseline,
  scenario,
  actualObservation,
  identityMappings = [],
  maxDeltas,
}: CompareBaselineObservationOptions): BaselineComparisonResult {
  if (baseline.scenarioId !== scenario.id) {
    throw new Error(
      `Baseline scenario ${baseline.scenarioId} cannot be compared as ${scenario.id}`,
    )
  }
  if (actualObservation.scenarioId !== scenario.id) {
    throw new Error(
      `Actual observation ${actualObservation.scenarioId} does not match ${scenario.id}`,
    )
  }

  const baselineObservation =
    baseline.observation as unknown as CharacterizationObservation
  const normalizedBaseline = normalizeScenarioObservation(
    baselineObservation,
    scenario.normalization,
    identityMappings,
  )
  const normalizedActual = normalizeScenarioObservation(
    actualObservation,
    scenario.normalization,
    identityMappings,
  )
  const comparison = compareObservations(
    normalizedBaseline.value,
    normalizedActual.value,
    { maxDeltas },
  )

  return {
    scenarioId: scenario.id,
    ...comparison,
    baselineEvidence: {
      appliedNormalizations: normalizedBaseline.appliedRules,
      appliedIdentities: normalizedBaseline.appliedIdentities,
    },
    actualEvidence: {
      appliedNormalizations: normalizedActual.appliedRules,
      appliedIdentities: normalizedActual.appliedIdentities,
    },
  }
}

async function installBaselineSet(
  directory: string,
  artifacts: readonly BaselineScenarioArtifact[],
  metadata: Pick<BaselineManifest, 'baseSha' | 'environment' | 'generatedAt'>,
): Promise<BaselineManifest> {
  const serializedArtifacts = artifacts.map((artifact) => ({
    scenarioId: artifact.scenarioId,
    serialized: serializeArtifact(artifact),
  }))
  const setId = sha256(
    serializedArtifacts.map(({ serialized }) => serialized).join('\n'),
  )
  const relativeSetDirectory = path.posix.join('sets', setId)
  const setDirectory = path.join(directory, relativeSetDirectory)
  const stagingDirectory = path.join(
    directory,
    'sets',
    `.${setId}.${randomUUID()}.tmp`,
  )
  await mkdir(path.join(directory, 'sets'), { recursive: true })
  await mkdir(stagingDirectory, { recursive: false })

  try {
    for (const artifact of serializedArtifacts) {
      const relativeFile = scenarioFile(artifact.scenarioId)
      const file = path.join(stagingDirectory, relativeFile)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, artifact.serialized, {
        encoding: 'utf8',
        flag: 'wx',
      })
    }
    await rename(stagingDirectory, setDirectory)
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true })
    throw error
  }

  const manifest: BaselineManifest = {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    catalogVersion: CATALOG_VERSION,
    normalizerVersion: NORMALIZER_VERSION,
    ...metadata,
    setId,
    secretScan: 'passed',
    scenarios: serializedArtifacts.map(({ scenarioId, serialized }) => ({
      scenarioId,
      file: path.posix.join(relativeSetDirectory, scenarioFile(scenarioId)),
      sha256: sha256(serialized),
    })),
  }
  const temporaryManifest = path.join(
    directory,
    `.manifest.${randomUUID()}.tmp`,
  )
  try {
    await writeFile(temporaryManifest, serializeArtifact(manifest), {
      encoding: 'utf8',
      flag: 'wx',
    })
    await rename(temporaryManifest, path.join(directory, 'manifest.json'))
  } catch (error) {
    await rm(temporaryManifest, { force: true })
    throw error
  }
  return manifest
}

function createScenarioArtifact({
  scenario,
  result,
  baseSha,
  environment,
  generatedAt,
}: {
  scenario: CharacterizationScenario
  result: BaselineScenarioResult
  baseSha: string
  environment: BaselineEnvironmentIdentity
  generatedAt: string
}): BaselineScenarioArtifact {
  const normalized = normalizeScenarioObservation(
    result.observation,
    scenario.normalization,
  )
  const artifact: BaselineScenarioArtifact = {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    catalogVersion: CATALOG_VERSION,
    normalizerVersion: NORMALIZER_VERSION,
    baseSha,
    environment,
    generatedAt,
    scenarioId: scenario.id,
    observation: toStableValue(result.observation),
    normalizedObservation: toStableValue(normalized.value),
    appliedNormalizations: toStableValue(normalized.appliedRules),
    appliedIdentities: toStableValue(normalized.appliedIdentities),
    secretScan: 'passed',
  }
  assertNoSecrets(artifact)
  return artifact
}

function validateFullSelection(
  catalog: readonly CharacterizationScenario[],
  results: readonly BaselineScenarioResult[],
): Array<{
  scenario: CharacterizationScenario
  result: BaselineScenarioResult
}> {
  const catalogById = new Map<string, CharacterizationScenario>()
  const allCatalogIds = new Set<string>()
  for (const scenario of catalog) {
    assertScenarioId(scenario.id)
    if (allCatalogIds.has(scenario.id)) {
      throw new Error(`Duplicate characterization catalog ID ${scenario.id}`)
    }
    allCatalogIds.add(scenario.id)
    if (isExecutableCharacterizationScenario(scenario)) {
      catalogById.set(scenario.id, scenario)
    }
  }
  if (catalogById.size === 0) {
    throw new Error('Baseline update requires a non-empty executable catalog')
  }

  const resultsById = new Map<string, BaselineScenarioResult>()
  for (const result of results) {
    assertScenarioId(result.scenarioId)
    if (resultsById.has(result.scenarioId)) {
      throw new Error(`Duplicate baseline result for ${result.scenarioId}`)
    }
    resultsById.set(result.scenarioId, result)
  }

  const missing = [...catalogById.keys()].filter((id) => !resultsById.has(id))
  const unexpected = [...resultsById.keys()].filter(
    (id) => !catalogById.has(id),
  )
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Baseline update requires the full executable catalog; missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}`,
    )
  }

  return [...catalogById.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, scenario]) => {
      const result = resultsById.get(id)
      if (!result) throw new Error(`Missing baseline result for ${id}`)
      if (result.status !== 'passed') {
        throw new Error(`Cannot calibrate failed scenario ${id}`)
      }
      if (
        result.observation.scenarioId !== id ||
        result.observation.subject !== 'legacy'
      ) {
        throw new Error(
          `Baseline result ${id} must contain its legacy observation`,
        )
      }
      return { scenario, result }
    })
}

function assertBaselineUpdateRequest(options: WriteBaselineSetOptions): void {
  if (!options.updateRequested) {
    throw new Error(
      'Refusing to rewrite characterization baselines without SDK_ITEST_UPDATE_BASELINE=1',
    )
  }
  if (options.subject !== 'legacy') {
    throw new Error('Characterization baselines can only be written by legacy')
  }
  assertFullSha(options.baseSha)
  assertEnvironmentIdentity(options.environment)
}

async function verifyBaseCommit(
  options: WriteBaselineSetOptions,
): Promise<void> {
  const verify =
    options.verifyCommit ??
    (async (baseSha: string) => {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', '--verify', `${baseSha}^{commit}`],
        { cwd: options.gitCwd },
      )
      return stdout.trim()
    })
  const resolved = await verify(options.baseSha)
  if (resolved !== options.baseSha) {
    throw new Error(
      `SDK_ITEST_BASE_SHA resolved to ${resolved || 'nothing'}, expected exact commit ${options.baseSha}`,
    )
  }
}

function parseManifest(value: unknown, source: string): BaselineManifest {
  if (!isRecord(value)) {
    throw new Error(`Invalid characterization baseline manifest in ${source}`)
  }
  if (
    value.schemaVersion !== BASELINE_SCHEMA_VERSION ||
    value.catalogVersion !== CATALOG_VERSION ||
    value.normalizerVersion !== NORMALIZER_VERSION ||
    typeof value.baseSha !== 'string' ||
    typeof value.generatedAt !== 'string' ||
    typeof value.setId !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.setId) ||
    value.secretScan !== 'passed' ||
    !Array.isArray(value.scenarios) ||
    value.scenarios.length === 0
  ) {
    throw new Error(`Invalid characterization baseline metadata in ${source}`)
  }
  assertFullSha(value.baseSha)
  assertEnvironmentIdentity(value.environment)
  const scenarios = value.scenarios.map((entry) =>
    parseManifestEntry(entry, source),
  )
  if (
    new Set(scenarios.map(({ scenarioId }) => scenarioId)).size !==
    scenarios.length
  ) {
    throw new Error(`Duplicate characterization baseline scenario in ${source}`)
  }
  for (const entry of scenarios) {
    const expected = path.posix.join(
      'sets',
      value.setId,
      scenarioFile(entry.scenarioId),
    )
    if (entry.file !== expected) {
      throw new Error(
        `Characterization baseline path does not match its set for ${entry.scenarioId}`,
      )
    }
  }
  const manifest = { ...value, scenarios } as unknown as BaselineManifest
  assertNoSecrets(manifest)
  return manifest
}

function parseManifestEntry(
  value: unknown,
  source: string,
): BaselineManifestEntry {
  if (
    !isRecord(value) ||
    typeof value.scenarioId !== 'string' ||
    typeof value.file !== 'string' ||
    typeof value.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.sha256)
  ) {
    throw new Error(`Invalid characterization baseline entry in ${source}`)
  }
  assertScenarioId(value.scenarioId)
  return value as unknown as BaselineManifestEntry
}

function parseScenarioArtifact(
  value: unknown,
  source: string,
): BaselineScenarioArtifact {
  if (
    !isRecord(value) ||
    value.schemaVersion !== BASELINE_SCHEMA_VERSION ||
    value.catalogVersion !== CATALOG_VERSION ||
    value.normalizerVersion !== NORMALIZER_VERSION ||
    typeof value.baseSha !== 'string' ||
    typeof value.generatedAt !== 'string' ||
    typeof value.scenarioId !== 'string' ||
    value.secretScan !== 'passed' ||
    !('observation' in value) ||
    !('normalizedObservation' in value) ||
    !('appliedNormalizations' in value) ||
    !('appliedIdentities' in value)
  ) {
    throw new Error(`Invalid characterization baseline artifact in ${source}`)
  }
  assertFullSha(value.baseSha)
  assertScenarioId(value.scenarioId)
  assertEnvironmentIdentity(value.environment)
  assertNoSecrets(value)
  return value as unknown as BaselineScenarioArtifact
}

function assertExpectedMetadata(
  value: Pick<
    BaselineManifest,
    | 'schemaVersion'
    | 'catalogVersion'
    | 'normalizerVersion'
    | 'baseSha'
    | 'environment'
  >,
  baseSha: string,
  environment: BaselineEnvironmentIdentity,
): void {
  if (
    value.schemaVersion !== BASELINE_SCHEMA_VERSION ||
    value.catalogVersion !== CATALOG_VERSION ||
    value.normalizerVersion !== NORMALIZER_VERSION ||
    value.baseSha !== baseSha
  ) {
    throw new Error(
      'Characterization baseline metadata does not match this run',
    )
  }
  if (stableStringify(value.environment) !== stableStringify(environment)) {
    throw new Error(
      'Characterization baseline environment does not match this run',
    )
  }
}

function validateRequestedScenarioIds(
  scenarioIds: readonly string[],
  manifest: BaselineManifest,
): Set<string> {
  const requested = new Set<string>()
  const available = new Set(
    manifest.scenarios.map(({ scenarioId }) => scenarioId),
  )
  for (const scenarioId of scenarioIds) {
    assertScenarioId(scenarioId)
    if (requested.has(scenarioId)) {
      throw new Error(`Duplicate requested baseline scenario ${scenarioId}`)
    }
    if (!available.has(scenarioId)) {
      throw new Error(`No calibrated baseline exists for ${scenarioId}`)
    }
    requested.add(scenarioId)
  }
  return requested
}

function resolveManifestFile(directory: string, relativeFile: string): string {
  if (path.isAbsolute(relativeFile)) {
    throw new Error(
      'Characterization baseline manifest contains an absolute path',
    )
  }
  const root = path.resolve(directory)
  const file = path.resolve(root, relativeFile)
  if (!file.startsWith(`${root}${path.sep}`)) {
    throw new Error(
      'Characterization baseline manifest path escapes its directory',
    )
  }
  return file
}

function scenarioFile(scenarioId: string): string {
  assertScenarioId(scenarioId)
  return `${scenarioId}.json`
}

function assertScenarioId(scenarioId: string): void {
  const segments = scenarioId.split('/')
  if (
    segments.length < 2 ||
    segments.some((segment) => !SAFE_ID.test(segment))
  ) {
    throw new Error(`Unsafe characterization scenario ID ${scenarioId}`)
  }
}

function assertFullSha(baseSha: string): void {
  if (!FULL_SHA.test(baseSha)) {
    throw new Error(
      'Characterization baseline requires a full lowercase Git SHA',
    )
  }
}

function assertEnvironmentIdentity(
  value: unknown,
): asserts value is BaselineEnvironmentIdentity {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !SAFE_ID.test(value.id) ||
    !isRecord(value.attributes)
  ) {
    throw new Error('Invalid characterization environment identity')
  }
  for (const [key, attribute] of Object.entries(value.attributes)) {
    if (!SAFE_ID.test(key) || !isEnvironmentAttribute(attribute)) {
      throw new Error(`Invalid characterization environment attribute ${key}`)
    }
  }
  assertNoSecrets(value)
}

function isEnvironmentAttribute(value: unknown): boolean {
  if (['string', 'boolean'].includes(typeof value)) return true
  if (typeof value === 'number') return Number.isFinite(value)
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'string' ||
        typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item)),
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
