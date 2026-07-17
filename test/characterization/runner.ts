import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { transitionalLegacyFiles } from '../../scripts/architecture/legacy-files'
import type { PreparedTransactionData } from '../../src/index'
import {
  LEGACY_DIRECT_SIGNING_HANDLER_KEYS,
  runLegacyDirectSigning,
} from './adapters/legacy-direct'
import {
  LEGACY_INTENT_HANDLER_KEYS,
  runLegacyIntentScenario,
} from './adapters/legacy-intent'
import {
  LEGACY_USER_OPERATION_HANDLER_KEYS,
  runLegacyUserOperationScenario,
} from './adapters/legacy-user-operation'
import type { ScenarioArtifact } from './artifacts'
import {
  EXECUTABLE_CHARACTERIZATION_HANDLER_KEYS,
  getScenarioHandlerKey,
  isExecutableCharacterizationScenario,
  type ScenarioHandlerKey,
} from './catalog'
import { compareScenarioValues } from './comparison-strategy'
import { evaluateScenarioObservation } from './expectation'
import { getComparisonGroupNamespace, getIdentityNamespace } from './identity'
import { normalizeScenarioObservation } from './normalization-rules'
import {
  type CharacterizationObservation,
  createModeObservation,
  failedOutcome,
  type ObservationContext,
} from './observe'
import { CHARACTERIZATION_BASE_SHA } from './provenance'
import type { CharacterizationScenario, CharacterizationSubject } from './types'

const execFileAsync = promisify(execFile)

export interface CharacterizationRunContext {
  readonly baseSha: string
  readonly runId: string
  readonly subject: CharacterizationSubject
  readonly intentPreparedReplay?: PreparedTransactionData
  readonly onIntentPrepared?: (prepared: PreparedTransactionData) => void
}

export function assertCharacterizationHandlerCoverage(): void {
  const registered = new Set<ScenarioHandlerKey>([
    ...LEGACY_INTENT_HANDLER_KEYS,
    ...LEGACY_DIRECT_SIGNING_HANDLER_KEYS,
    ...LEGACY_USER_OPERATION_HANDLER_KEYS,
  ])
  const expected = new Set(EXECUTABLE_CHARACTERIZATION_HANDLER_KEYS)
  const missing = [...expected].filter((key) => !registered.has(key))
  const unexpected = [...registered].filter((key) => !expected.has(key))
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Characterization handler registry mismatch; missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}`,
    )
  }
}

export function assertCharacterizationSubjectAvailable(
  _subject: CharacterizationSubject,
): void {}

export async function resolveCharacterizationBaseSha(
  configured?: string,
  cwd = process.cwd(),
): Promise<string> {
  const requested = configured ?? 'HEAD'
  const { stdout } = await execFileAsync(
    'git',
    ['rev-parse', '--verify', `${requested}^{commit}`],
    { cwd },
  )
  const resolved = stdout.trim()
  if (!/^[0-9a-f]{40}$/u.test(resolved)) {
    throw new Error(`Could not resolve a full Git SHA for ${cwd}`)
  }
  if (configured && resolved !== configured) {
    throw new Error(
      `SDK_ITEST_BASE_SHA resolved to ${resolved}, expected exact commit ${configured}`,
    )
  }
  return resolved
}

export async function assertLegacyOracleSourceUnchanged(
  baseSha: string,
  cwd = process.cwd(),
  currentSourceSha = process.env.SDK_ITEST_CURRENT_SOURCE_SHA,
): Promise<void> {
  if (baseSha !== CHARACTERIZATION_BASE_SHA) {
    throw new Error(
      `Legacy characterization requires calibrated release ${CHARACTERIZATION_BASE_SHA}`,
    )
  }
  const { stdout: treeOutput } = await execFileAsync(
    'git',
    ['ls-tree', '-r', '--name-only', baseSha, '--', 'src'],
    { cwd },
  )
  const oraclePaths = treeOutput
    .split('\n')
    .filter(
      (file) =>
        file === 'src/package.json' || transitionalLegacyFiles.has(file),
    )
  if (oraclePaths.length === 0) {
    throw new Error(`No legacy oracle source files exist at ${baseSha}`)
  }
  if (currentSourceSha && !/^[0-9a-f]{40}$/u.test(currentSourceSha)) {
    throw new Error(
      'SDK_ITEST_CURRENT_SOURCE_SHA must be a full lowercase Git SHA',
    )
  }
  const diffRange = currentSourceSha ? [baseSha, currentSourceSha] : [baseSha]
  const { stdout: diffOutput } = await execFileAsync(
    'git',
    ['diff', '--name-only', ...diffRange, '--', ...oraclePaths],
    { cwd, maxBuffer: 4 * 1024 * 1024 },
  )
  const changed = diffOutput.trim()
  if (changed) {
    throw new Error(`Legacy oracle source differs from ${baseSha}:\n${changed}`)
  }
}

export async function runCharacterizationScenario(
  scenario: CharacterizationScenario,
  context: CharacterizationRunContext,
): Promise<ScenarioArtifact> {
  if (!isExecutableCharacterizationScenario(scenario)) {
    throw new Error(
      `${scenario.id} is a catalog coverage gap and cannot produce a successful runtime artifact`,
    )
  }
  assertCharacterizationSubjectAvailable(context.subject)

  const startedAt = performance.now()
  let observation: CharacterizationObservation
  try {
    observation = await runSubjectAdapter(scenario, context)
  } catch (error) {
    observation = createFailureObservation(scenario, context, error)
  }

  const expectation = evaluateScenarioObservation(scenario, observation)
  const normalized = normalizeScenarioObservation(
    observation,
    scenario.normalization,
  )
  return {
    scenarioId: scenario.id,
    status: expectation.passed ? 'passed' : 'failed',
    ...(!expectation.passed ? { diagnostics: expectation.reasons } : {}),
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    observation,
    normalizedObservation: normalized.value,
    appliedNormalizations: normalized.appliedRules,
    appliedIdentities: normalized.appliedIdentities,
    unexplainedDeltas: 0,
  }
}

export function compareScenarioArtifacts(
  scenario: CharacterizationScenario,
  reference: ScenarioArtifact,
  candidate: ScenarioArtifact,
): ScenarioArtifact {
  if (
    reference.scenarioId !== scenario.id ||
    candidate.scenarioId !== scenario.id
  ) {
    throw new Error(`Cannot compare mismatched artifacts for ${scenario.id}`)
  }
  if (reference.status === 'failed' || candidate.status === 'failed') {
    return candidate
  }

  const comparison = compareScenarioValues(
    scenario,
    reference.normalizedObservation,
    candidate.normalizedObservation,
  )
  if (comparison.equal) return candidate
  const diagnostics = comparison.deltas.map(
    (delta) => `${delta.path}: ${delta.kind}`,
  )
  return {
    ...candidate,
    status: 'failed',
    diagnostics,
    unexplainedDeltas: comparison.deltas.length,
  }
}

async function runSubjectAdapter(
  scenario: CharacterizationScenario,
  context: CharacterizationRunContext,
): Promise<CharacterizationObservation> {
  const namespaceInput = { scenario, ...context }
  switch (scenario.workflow) {
    case 'intent':
      return runLegacyIntentScenario({
        scenario,
        subject: context.subject as 'legacy' | 'public' | 'rewrite',
        baseSha: context.baseSha,
        runId: context.runId,
        identityNamespace: getIdentityNamespace(namespaceInput),
        preparedReplay: context.intentPreparedReplay,
        onPrepared: context.onIntentPrepared,
      })
    case 'direct-signing':
      return runLegacyDirectSigning(scenario, {
        ...observationContext(scenario, context),
        identityNamespace: getIdentityNamespace(namespaceInput),
      })
    case 'user-operation':
      return runLegacyUserOperationScenario({
        scenario,
        subject: context.subject as 'legacy' | 'rewrite',
        baseSha: context.baseSha,
        runId: context.runId,
      })
  }
}

function observationContext(
  scenario: CharacterizationScenario,
  context: CharacterizationRunContext,
): ObservationContext {
  return {
    scenarioId: scenario.id,
    workflow: scenario.workflow,
    subject: context.subject,
    runId: context.runId,
    comparisonGroup: getComparisonGroupNamespace({ scenario, ...context }),
  }
}

function createFailureObservation(
  scenario: CharacterizationScenario,
  context: CharacterizationRunContext,
  error: unknown,
): CharacterizationObservation {
  const sign = {}
  const details =
    scenario.mode === 'sign'
      ? { mode: 'sign' as const, sign }
      : scenario.mode === 'dryRun'
        ? { mode: 'dryRun' as const, sign, simulation: undefined }
        : { mode: 'execute' as const, sign, execution: undefined }
  return createModeObservation(
    observationContext(scenario, context),
    details,
    failedOutcome(error, 'construction'),
  )
}

export function getRegisteredHandlerKeys(): readonly ScenarioHandlerKey[] {
  return [
    ...new Set([
      ...LEGACY_INTENT_HANDLER_KEYS,
      ...LEGACY_DIRECT_SIGNING_HANDLER_KEYS,
      ...LEGACY_USER_OPERATION_HANDLER_KEYS,
    ]),
  ].sort()
}

export function getMissingHandlerKey(
  scenario: CharacterizationScenario,
): ScenarioHandlerKey | undefined {
  const key = getScenarioHandlerKey(scenario)
  return getRegisteredHandlerKeys().includes(key) ? undefined : key
}
