import { ACCEPTED, type AcceptedDifference, applyAccepted } from './accepted'
import { type BuildLoader, type LoadedBuild, loadBuild } from './builds'
import { adapterFor, project } from './canonical/project'
import { LAYERS, type Layer } from './canonical/types'
import { compare, type Diff } from './compare'
import { type BuildId, orchestratorOrigins, type ParityConfig } from './config'
import {
  als,
  createRunContext,
  type HttpRecord,
  type RunContext,
  type RunRecords,
} from './context'
import { type FundedEnv, liveFundedEnv } from './funded/lifecycle'
import { type FixtureBalance, shortfalls, topUpLine } from './funded/preflight'
import { settle } from './funded/settle'
import { checkGolden, type GoldenOutcome, goldenView } from './golden'
import { normalize, type RuleHits } from './normalize'
import type { ApiVersion } from './routing'
import {
  createScenarioContext,
  describeError,
  type ExecutionExpectation,
  HarnessError,
  type Scenario,
  wasRecorded,
} from './scenario'

type Role = 'baseline' | 'candidate'
type SideRole = RunContext['role']

type Verdict = 'match' | 'diff' | 'error'

// `error` outranks any diff: the run could not prove what it set out to.
type ErrorKind = 'funding' | 'fixture' | 'execution' | 'harness'

interface ScenarioError {
  kind: ErrorKind
  message: string
}

// One live submit and where its intent ended up.
interface ExecutionRecord {
  role: SideRole
  step: string
  submitStatus: number
  intentId?: string
  // COMPLETED, FAILED or EXPIRED once settled; REJECTED when the submit was
  // refused; otherwise the last status seen before the settle timeout.
  status: string
  settled: boolean
  // From the start of the side to the end of its settle.
  elapsedMs: number
  submitTraceId?: string
}

interface FixtureBalanceReport {
  fixture: string
  address: string
  chainId: number
  token: string
  balance: string
  required: string
}

interface FundedReport {
  fixtures: FixtureBalanceReport[]
  topUps?: string[]
  warmUp?: {
    reasons: string[]
    execution: ExecutionRecord[]
    // Failed steps of the warm-up run, which is otherwise not recorded.
    errors: string[]
    remaining: string[]
  }
}

interface BuildMeta {
  id: BuildId
  label: string
  version: string
  commit?: string
  dirty?: boolean
  apiVersions: string[]
}

type LayerStatus = 'match' | 'diff' | 'accepted' | 'drift'

interface LayerResult {
  status: LayerStatus
  diffs: Diff[]
  accepted: (Diff & { reason: string })[]
  drift: Diff[]
}

interface HarnessErrorEntry {
  role: Role
  step: string
  message: string
}

interface ScenarioResult {
  scenarioId: string
  iteration: number
  verdict: Verdict
  error?: ScenarioError
  fault?: string
  // Funded scenarios: every live submit on both sides, and (first iteration
  // only) fixture balances at preflight and any warm-up.
  execution?: ExecutionRecord[]
  funded?: FundedReport
  skippedSides?: Role[]
  // Scenario or harness defects; any entry fails the run.
  harnessErrors: HarnessErrorEntry[]
  baseline: BuildMeta
  candidate: BuildMeta
  layers: Record<Layer, LayerResult>
  golden: GoldenOutcome
  ruleHits: { baseline: RuleHits; candidate: RuleHits }
  raw: { baseline: RunRecords; candidate: RunRecords }
}

interface RunnerOptions {
  config: ParityConfig
  loadBuild?: BuildLoader
  goldenDir?: string
  accepted?: AcceptedDifference[]
  funded?: FundedEnv
}

interface SideRun {
  meta: BuildMeta
  records: RunRecords
  durationMs: number
}

function apiVersionsSeen(records: RunRecords): string[] {
  const seen = new Set<string>()
  for (const record of records.http) {
    seen.add(
      record.apiVersionHeader ??
        `${record.apiVersion as ApiVersion} (no header)`,
    )
  }
  return [...seen].sort()
}

function buildMeta(build: LoadedBuild, records: RunRecords): BuildMeta {
  return {
    id: build.id,
    label: build.label,
    version: build.version,
    commit: build.commit,
    dirty: build.dirty,
    apiVersions: apiVersionsSeen(records),
  }
}

async function runSide(
  scenario: Pick<Scenario, 'submitMode' | 'run'>,
  role: SideRole,
  buildId: BuildId,
  options: RunnerOptions,
  clock: number,
): Promise<SideRun> {
  const { config } = options
  const started = Date.now()
  const build = await (options.loadBuild ?? loadBuild)(buildId)
  const run = createRunContext({
    role,
    submitMode: scenario.submitMode,
    fault: role === 'candidate' ? config.fault : undefined,
    origins: orchestratorOrigins(config),
  })
  const ctx = createScenarioContext(build, run, config, clock)
  try {
    await als.run(run, () => scenario.run(ctx))
  } catch (error) {
    // An escaping error is the terminal outcome; the comparison still runs.
    if (!wasRecorded(error)) {
      run.records.steps.push({
        seq: run.seq + 1,
        name: '(terminal)',
        kind: 'other',
        ok: false,
        error: describeError(error),
        ...(error instanceof HarnessError ? { harness: true as const } : {}),
      })
    }
  }
  return {
    meta: buildMeta(build, run.records),
    records: run.records,
    durationMs: Date.now() - started,
  }
}

function isOk(record: HttpRecord): boolean {
  return record.status >= 200 && record.status < 300
}

async function settleSide(
  role: SideRole,
  side: SideRun,
  env: FundedEnv,
  timeoutMs: number,
): Promise<ExecutionRecord[]> {
  const submits = side.records.http.filter(
    (record) => record.op === 'submit' && !record.captured,
  )
  const records: ExecutionRecord[] = []
  for (const submit of submits) {
    const base = {
      role,
      step: submit.step ?? '(no step)',
      submitStatus: submit.status,
      submitTraceId: submit.responseHeaders['x-trace-id'],
    }
    const intentId = isOk(submit)
      ? adapterFor(submit.apiVersion).submittedIntentId(submit.responseBody)
      : undefined
    if (!intentId) {
      records.push({
        ...base,
        status: 'REJECTED',
        settled: true,
        elapsedMs: side.durationMs,
      })
      continue
    }
    const [outcome] = await settle([intentId], {
      status: env.intentStatus,
      timeoutMs,
      intervalMs: env.settleIntervalMs,
    })
    records.push({
      ...base,
      intentId,
      status: outcome.status,
      settled: outcome.settled,
      elapsedMs: side.durationMs + outcome.elapsedMs,
    })
  }
  return records
}

function executionProblems(
  expectation: ExecutionExpectation,
  role: Role,
  records: ExecutionRecord[],
): string[] {
  const label = (record: ExecutionRecord) =>
    `${role} ${record.intentId ?? record.step} ${record.status}${record.settled ? '' : ' (not settled)'}`
  if (expectation === 'none') {
    return records.map((record) => `${label(record)}: nothing may be submitted`)
  }
  if (records.length === 0) return [`${role}: nothing was submitted`]
  if (expectation === 'complete') {
    return records.filter((record) => record.status !== 'COMPLETED').map(label)
  }
  return records
    .filter((record) => record.status === 'COMPLETED' || !record.settled)
    .map((record) => `${label(record)}: expected a refusal or failure`)
}

function harnessErrorsOf(role: Role, records: RunRecords): HarnessErrorEntry[] {
  return records.steps
    .filter((step) => step.harness)
    .map((step) => ({
      role,
      step: step.name,
      message: step.error?.message ?? '',
    }))
}

function emptyLayerResult(): LayerResult {
  return { status: 'match', diffs: [], accepted: [], drift: [] }
}

interface FundedRun {
  env: FundedEnv
  report?: FundedReport
}

function emptyRecords(): RunRecords {
  return { http: [], signer: [], steps: [], identities: [] }
}

async function runOnce(
  scenario: Scenario,
  iteration: number,
  options: RunnerOptions,
  funded?: FundedRun,
): Promise<ScenarioResult> {
  const { config } = options
  const clock = Math.floor(Date.now() / 1000)
  const sides: Partial<Record<Role, SideRun>> = {}
  const execution: ExecutionRecord[] = []
  const hookErrors: HarnessErrorEntry[] = []
  const buildIds: Record<Role, BuildId> = {
    baseline: config.baseline,
    candidate: config.candidate,
  }
  // Sequential on purpose: funded scenarios share fixture accounts, and each
  // side's intents settle before the next side starts.
  for (const role of ['baseline', 'candidate'] as const) {
    if (funded && scenario.beforeSide) {
      try {
        await scenario.beforeSide({ sdk: await funded.env.sdk() })
      } catch (error) {
        hookErrors.push({
          role,
          step: '(beforeSide)',
          message: error instanceof Error ? error.message : String(error),
        })
        break
      }
    }
    const side = await runSide(scenario, role, buildIds[role], options, clock)
    sides[role] = side
    if (!funded) continue
    const records = await settleSide(
      role,
      side,
      funded.env,
      config.settleTimeoutMs,
    )
    execution.push(...records)
    if (role === 'baseline' && records.some((record) => !record.settled)) break
  }

  const skippedSides = (['baseline', 'candidate'] as const).filter(
    (role) => !sides[role],
  )
  const baseline =
    sides.baseline ?? (await placeholderSide(buildIds.baseline, options))
  const candidate =
    sides.candidate ?? (await placeholderSide(buildIds.candidate, options))

  const layers = {} as Record<Layer, LayerResult>
  let golden: GoldenOutcome = {
    status: 'skipped',
    reason: 'baseline is not the published build',
  }
  let ruleHits = { baseline: {} as RuleHits, candidate: {} as RuleHits }
  if (skippedSides.length > 0) {
    for (const layer of LAYERS) layers[layer] = emptyLayerResult()
    golden = { status: 'skipped', reason: 'a side did not run' }
  } else {
    const a = normalize(project(baseline.records), {
      tolerances: scenario.tolerances,
    })
    const b = normalize(project(candidate.records), {
      tolerances: scenario.tolerances,
    })
    ruleHits = { baseline: a.hits, candidate: b.hits }
    const entries = [
      ...(options.accepted ?? ACCEPTED),
      ...(scenario.accepted ?? []),
    ]
    for (const layer of LAYERS) {
      const diffs = compare(layer, a.layers[layer], b.layers[layer])
      const { unaccepted, accepted } = applyAccepted(
        diffs,
        scenario.id,
        entries,
      )
      layers[layer] = {
        ...emptyLayerResult(),
        status:
          unaccepted.length > 0
            ? 'diff'
            : accepted.length > 0
              ? 'accepted'
              : 'match',
        diffs: unaccepted,
        accepted,
      }
    }
    if (config.baseline === 'published') {
      golden = checkGolden(
        scenario.id,
        goldenView(a.layers, scenario.goldenLayers, scenario.goldenIgnore),
        {
          update: config.updateGoldens && iteration === 0,
          dir: options.goldenDir,
        },
      )
      if (golden.status === 'drift') {
        for (const diff of golden.diffs) {
          const layer = layers[diff.layer]
          layer.drift.push(diff)
          if (layer.status !== 'diff') layer.status = 'drift'
        }
      }
    }
  }

  const hasDiff = LAYERS.some((layer) => layers[layer].diffs.length > 0)
  const goldenOk = golden.status !== 'drift' && golden.status !== 'missing'
  const harnessErrors = [
    ...hookErrors,
    ...harnessErrorsOf('baseline', baseline.records),
    ...harnessErrorsOf('candidate', candidate.records),
  ]
  const problems = funded
    ? [
        ...executionProblems(
          scenario.execution ?? 'complete',
          'baseline',
          execution.filter((record) => record.role === 'baseline'),
        ),
        ...(sides.candidate
          ? executionProblems(
              scenario.execution ?? 'complete',
              'candidate',
              execution.filter((record) => record.role === 'candidate'),
            )
          : ['candidate skipped']),
      ]
    : []
  const error: ScenarioError | undefined =
    harnessErrors.length > 0
      ? {
          kind: 'harness',
          message: harnessErrors
            .map((entry) => `${entry.role} ${entry.step}: ${entry.message}`)
            .join('; '),
        }
      : problems.length > 0
        ? { kind: 'execution', message: problems.join('; ') }
        : undefined
  return {
    scenarioId: scenario.id,
    iteration,
    verdict: error ? 'error' : !hasDiff && goldenOk ? 'match' : 'diff',
    ...(error ? { error } : {}),
    fault: config.fault?.id,
    ...(funded ? { execution } : {}),
    ...(funded?.report ? { funded: funded.report } : {}),
    ...(skippedSides.length > 0 ? { skippedSides } : {}),
    harnessErrors,
    baseline: baseline.meta,
    candidate: candidate.meta,
    layers,
    golden,
    ruleHits,
    raw: { baseline: baseline.records, candidate: candidate.records },
  }
}

async function placeholderSide(
  buildId: BuildId,
  options: RunnerOptions,
): Promise<SideRun> {
  const build = await (options.loadBuild ?? loadBuild)(buildId)
  const records = emptyRecords()
  return { meta: buildMeta(build, records), records, durationMs: 0 }
}

async function preflightResult(
  scenario: Scenario,
  options: RunnerOptions,
  error: ScenarioError,
  report: FundedReport,
): Promise<ScenarioResult> {
  const baseline = await placeholderSide(options.config.baseline, options)
  const candidate = await placeholderSide(options.config.candidate, options)
  const layers = {} as Record<Layer, LayerResult>
  for (const layer of LAYERS) layers[layer] = emptyLayerResult()
  return {
    scenarioId: scenario.id,
    iteration: 0,
    verdict: 'error',
    error,
    fault: options.config.fault?.id,
    execution: report.warmUp?.execution ?? [],
    funded: report,
    skippedSides: ['baseline', 'candidate'],
    harnessErrors: [],
    baseline: baseline.meta,
    candidate: candidate.meta,
    layers,
    golden: { status: 'skipped', reason: 'no side ran' },
    ruleHits: { baseline: {}, candidate: {} },
    raw: { baseline: baseline.records, candidate: candidate.records },
  }
}

function balanceReport(balances: FixtureBalance[]): FixtureBalanceReport[] {
  return balances.map((entry) => ({
    fixture: entry.fixture,
    address: entry.address,
    chainId: entry.chainId,
    token: entry.token,
    balance: entry.balance.toString(),
    required: entry.required.toString(),
  }))
}

// Funding, steady state and warm-up, before the first iteration. Returns a
// result only when the scenario cannot run.
async function prepareFunded(
  scenario: Scenario,
  options: RunnerOptions,
  env: FundedEnv,
): Promise<{ report: FundedReport } | { result: ScenarioResult }> {
  const { config } = options
  const fail = async (
    kind: ErrorKind,
    message: string,
    report: FundedReport,
  ) => ({
    result: await preflightResult(scenario, options, { kind, message }, report),
  })
  if (config.env !== 'prod') {
    return fail('harness', 'Funded scenarios run only against prod', {
      fixtures: [],
    })
  }
  let report: FundedReport = { fixtures: [] }
  try {
    const reasons = await env.steady(scenario.steady ?? [])
    const warmUps =
      reasons.length === 0
        ? []
        : scenario.warmUp
          ? [scenario.warmUp, scenario.run]
          : [scenario.run]
    // Every side of every iteration, plus each warm-up that may run.
    const sides = 2 * config.repeat + warmUps.length
    const balances = await env.balances(scenario.fixtures ?? [], sides)
    report = { fixtures: balanceReport(balances) }
    const short = shortfalls(balances)
    if (short.length > 0) {
      const topUps = short.map(topUpLine)
      return fail(
        'funding',
        `Fixtures cannot cover ${sides} sides; nothing was submitted. Top up:\n${topUps.join('\n')}`,
        { ...report, topUps },
      )
    }
    if (warmUps.length === 0) return { report }
    // Unrecorded published runs settle one-off state (deployment, session
    // enable, Permit2 approval) outside the comparison.
    const execution: ExecutionRecord[] = []
    const errors: string[] = []
    let remaining = reasons
    for (const run of warmUps) {
      if (scenario.beforeSide)
        await scenario.beforeSide({ sdk: await env.sdk() })
      const side = await runSide(
        { submitMode: 'live', run },
        'warmup',
        'published',
        options,
        Math.floor(Date.now() / 1000),
      )
      execution.push(
        ...(await settleSide('warmup', side, env, config.settleTimeoutMs)),
      )
      errors.push(
        ...side.records.steps
          .filter((step) => !step.ok)
          .map((step) => `${step.name}: ${step.error?.message ?? ''}`),
      )
      remaining = await env.steady(scenario.steady ?? [])
      if (remaining.length === 0) break
    }
    report = { ...report, warmUp: { reasons, execution, errors, remaining } }
    if (remaining.length > 0) {
      return fail(
        'fixture',
        `Fixture still not steady after a warm-up: ${remaining.join('; ')}`,
        report,
      )
    }
    return { report }
  } catch (error) {
    return fail(
      'harness',
      `Funded preflight failed: ${error instanceof Error ? error.message : String(error)}`,
      report,
    )
  }
}

async function runParity(
  scenario: Scenario,
  options: RunnerOptions,
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = []
  let funded: FundedRun | undefined
  if (scenario.funded) {
    const env = options.funded ?? liveFundedEnv(options.config)
    const prepared = await prepareFunded(scenario, options, env)
    if ('result' in prepared) return [prepared.result]
    funded = { env, report: prepared.report }
  }
  for (let i = 0; i < options.config.repeat; i++) {
    const result = await runOnce(scenario, i, options, funded)
    results.push(result)
    // Report preflight and warm-up once, on the first iteration.
    if (funded) funded = { env: funded.env }
    // Don't keep spending on a scenario that cannot prove anything.
    if (result.verdict === 'error' && scenario.funded) break
  }
  return results
}

export type {
  BuildMeta,
  ErrorKind,
  ExecutionRecord,
  FixtureBalanceReport,
  FundedReport,
  HarnessErrorEntry,
  LayerResult,
  LayerStatus,
  RunnerOptions,
  ScenarioError,
  ScenarioResult,
  Verdict,
}
export { runParity }
