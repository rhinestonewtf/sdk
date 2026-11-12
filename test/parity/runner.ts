import { ACCEPTED, type AcceptedDifference, applyAccepted } from './accepted'
import { type BuildLoader, type LoadedBuild, loadBuild } from './builds'
import { project } from './canonical/project'
import { LAYERS, type Layer } from './canonical/types'
import { compare, type Diff } from './compare'
import { type BuildId, orchestratorOrigins, type ParityConfig } from './config'
import { als, createRunContext, type RunRecords } from './context'
import { checkGolden, type GoldenOutcome, goldenView } from './golden'
import { normalize, type RuleHits } from './normalize'
import type { ApiVersion } from './routing'
import {
  createScenarioContext,
  describeError,
  type Scenario,
  wasRecorded,
} from './scenario'

type Role = 'baseline' | 'candidate'

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

interface ScenarioResult {
  scenarioId: string
  iteration: number
  verdict: 'match' | 'diff'
  fault?: string
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
}

interface SideRun {
  meta: BuildMeta
  records: RunRecords
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
  scenario: Scenario,
  role: Role,
  buildId: BuildId,
  options: RunnerOptions,
): Promise<SideRun> {
  const { config } = options
  const build = await (options.loadBuild ?? loadBuild)(buildId)
  const run = createRunContext({
    buildId,
    role,
    scenarioId: scenario.id,
    submitMode: scenario.submitMode,
    fault: role === 'candidate' ? config.fault : undefined,
    origins: orchestratorOrigins(config),
  })
  const ctx = createScenarioContext(build, run, config)
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
      })
    }
  }
  return { meta: buildMeta(build, run.records), records: run.records }
}

function emptyLayerResult(): LayerResult {
  return { status: 'match', diffs: [], accepted: [], drift: [] }
}

async function runOnce(
  scenario: Scenario,
  iteration: number,
  options: RunnerOptions,
): Promise<ScenarioResult> {
  const { config } = options
  // Sequential on purpose: funded scenarios share one account.
  const baseline = await runSide(scenario, 'baseline', config.baseline, options)
  const candidate = await runSide(
    scenario,
    'candidate',
    config.candidate,
    options,
  )

  const a = normalize(project(baseline.records), {
    tolerances: scenario.tolerances,
  })
  const b = normalize(project(candidate.records), {
    tolerances: scenario.tolerances,
  })

  const entries = [
    ...(options.accepted ?? ACCEPTED),
    ...(scenario.accepted ?? []),
  ]
  const layers = {} as Record<Layer, LayerResult>
  for (const layer of LAYERS) {
    const diffs = compare(layer, a.layers[layer], b.layers[layer])
    const { unaccepted, accepted } = applyAccepted(diffs, scenario.id, entries)
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

  let golden: GoldenOutcome = {
    status: 'skipped',
    reason: 'baseline is not the published build',
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

  const hasDiff = LAYERS.some((layer) => layers[layer].diffs.length > 0)
  const goldenOk = golden.status !== 'drift' && golden.status !== 'missing'
  return {
    scenarioId: scenario.id,
    iteration,
    verdict: !hasDiff && goldenOk ? 'match' : 'diff',
    fault: config.fault?.id,
    baseline: baseline.meta,
    candidate: candidate.meta,
    layers,
    golden,
    ruleHits: { baseline: a.hits, candidate: b.hits },
    raw: { baseline: baseline.records, candidate: candidate.records },
  }
}

async function runParity(
  scenario: Scenario,
  options: RunnerOptions,
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = []
  for (let i = 0; i < options.config.repeat; i++) {
    results.push(await runOnce(scenario, i, options))
  }
  return results
}

export type {
  BuildMeta,
  LayerResult,
  LayerStatus,
  RunnerOptions,
  ScenarioResult,
}
export { runParity }
