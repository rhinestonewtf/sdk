import path from 'node:path'
import { assignScenariosToShards, type Shard } from './sharding'
import {
  CHARACTERIZATION_SUBJECTS,
  type CharacterizationScenario,
  type CharacterizationSubject,
  EXECUTION_MODES,
  type ExecutionMode,
  SCENARIO_TAGS,
  type ScenarioTag,
  WORKFLOW_KINDS,
  type WorkflowKind,
} from './types'

const FULL_SHA = /^[0-9a-f]{40}$/
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/

type TagFilter = {
  readonly match: 'all' | 'any'
  readonly tags: readonly ScenarioTag[]
}

type ScenarioFilters = {
  readonly workflows: readonly WorkflowKind[]
  readonly modes: readonly ExecutionMode[]
  readonly tags?: TagFilter
}

type CommonEnvironment = {
  readonly baseSha?: string
  readonly runId?: string
  readonly shard?: Shard
  readonly filters: ScenarioFilters
  readonly updateBaseline: boolean
  readonly resultsDir: string
}

export type CharacterizationEnvironment =
  | (CommonEnvironment & {
      readonly command: 'single'
      readonly subject: CharacterizationSubject
    })
  | (CommonEnvironment & {
      readonly command: 'compare'
      readonly subjects: readonly [
        CharacterizationSubject,
        CharacterizationSubject,
      ]
    })
  | (CommonEnvironment & {
      readonly command: 'aggregate'
      readonly subjects?: readonly [
        CharacterizationSubject,
        CharacterizationSubject,
      ]
    })

export function parseCharacterizationEnvironment(
  command: CharacterizationEnvironment['command'],
  environment: NodeJS.ProcessEnv = process.env,
): CharacterizationEnvironment {
  const baseSha = parseBaseSha(environment.SDK_ITEST_BASE_SHA)
  const runId = parseRunId(environment.SDK_ITEST_RUN_ID)
  const shard = parseShard(environment.SDK_ITEST_SHARD)
  const filters = parseFilters(environment)
  const updateBaseline = parseUpdateBaseline(
    environment.SDK_ITEST_UPDATE_BASELINE,
  )
  const resultsDir = path.resolve(
    environment.SDK_ITEST_RESULTS_DIR ?? '.artifacts/characterization',
  )
  const isFullRun =
    filters.workflows.length === 0 &&
    filters.modes.length === 0 &&
    filters.tags === undefined

  if ((isFullRun || shard || command === 'aggregate') && !runId) {
    throw new Error(
      'SDK_ITEST_RUN_ID is required for full, sharded, and aggregate runs',
    )
  }

  if (command === 'single') {
    const subject = parseSubject(environment.SDK_ITEST_SUBJECT)
    if (environment.SDK_ITEST_COMPARE) {
      throw new Error(
        'SDK_ITEST_COMPARE is only accepted by the compare or aggregate command',
      )
    }
    if (subject === 'legacy' && !baseSha) {
      throw new Error('SDK_ITEST_BASE_SHA is required for the legacy subject')
    }
    if (updateBaseline && subject !== 'legacy') {
      throw new Error('Baselines can only be updated by the legacy subject')
    }
    return {
      command,
      subject,
      baseSha,
      runId,
      shard,
      filters,
      updateBaseline,
      resultsDir,
    }
  }

  if (environment.SDK_ITEST_SUBJECT) {
    throw new Error(
      'SDK_ITEST_SUBJECT is only accepted by the single-subject command',
    )
  }
  if (updateBaseline) {
    throw new Error('Baseline updates require a single legacy-subject run')
  }

  const subjects = environment.SDK_ITEST_COMPARE
    ? parseSubjectPair(environment.SDK_ITEST_COMPARE)
    : undefined
  if (command === 'compare') {
    if (!subjects) {
      throw new Error(
        'SDK_ITEST_COMPARE is required for the compare command, for example legacy,rewrite',
      )
    }
    if (!baseSha) {
      throw new Error('SDK_ITEST_BASE_SHA is required for paired runs')
    }
    return {
      command,
      subjects,
      baseSha,
      runId,
      shard,
      filters,
      updateBaseline,
      resultsDir,
    }
  }

  return {
    command,
    subjects,
    baseSha,
    runId,
    shard,
    filters,
    updateBaseline,
    resultsDir,
  }
}

export function selectScenarios(
  catalog: readonly CharacterizationScenario[],
  environment: Pick<CharacterizationEnvironment, 'filters' | 'shard'>,
): CharacterizationScenario[] {
  const assignments = environment.shard
    ? assignScenariosToShards(catalog, environment.shard.total)
    : undefined
  const { workflows, modes, tags } = environment.filters

  return catalog.filter((scenario) => {
    if (workflows.length > 0 && !workflows.includes(scenario.workflow)) {
      return false
    }
    if (modes.length > 0 && !modes.includes(scenario.mode)) return false
    if (tags) {
      const predicate = (tag: ScenarioTag) => scenario.tags.includes(tag)
      if (tags.match === 'all' && !tags.tags.every(predicate)) return false
      if (tags.match === 'any' && !tags.tags.some(predicate)) return false
    }
    if (
      environment.shard &&
      assignments?.get(scenario.id) !== environment.shard.index
    ) {
      return false
    }
    return true
  })
}

function parseFilters(environment: NodeJS.ProcessEnv): ScenarioFilters {
  return {
    workflows: parseRegisteredList(
      'SDK_ITEST_WORKFLOW',
      environment.SDK_ITEST_WORKFLOW,
      WORKFLOW_KINDS,
    ),
    modes: parseRegisteredList(
      'SDK_ITEST_MODE',
      environment.SDK_ITEST_MODE,
      EXECUTION_MODES,
    ),
    tags: parseTags(environment.SDK_ITEST_TAGS),
  }
}

function parseSubject(value: string | undefined): CharacterizationSubject {
  if (!value) throw new Error('SDK_ITEST_SUBJECT is required')
  if (!isIncluded(CHARACTERIZATION_SUBJECTS, value)) {
    throw new Error(
      `SDK_ITEST_SUBJECT must be one of ${CHARACTERIZATION_SUBJECTS.join(', ')}`,
    )
  }
  return value
}

function parseSubjectPair(
  value: string,
): readonly [CharacterizationSubject, CharacterizationSubject] {
  const parts = value.split(',').map((part) => parseSubject(part.trim()))
  if (parts.length !== 2 || parts[0] === parts[1]) {
    throw new Error(
      'SDK_ITEST_COMPARE must contain two different ordered subjects',
    )
  }
  return [parts[0], parts[1]]
}

function parseBaseSha(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!FULL_SHA.test(value)) {
    throw new Error('SDK_ITEST_BASE_SHA must be a full lowercase Git SHA')
  }
  return value
}

function parseRunId(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!SAFE_RUN_ID.test(value)) {
    throw new Error(
      'SDK_ITEST_RUN_ID must be 1-80 safe non-secret identifier characters',
    )
  }
  return value
}

function parseShard(value: string | undefined): Shard | undefined {
  if (!value) return undefined
  const match = /^(\d+)\/(\d+)$/.exec(value)
  if (!match) {
    throw new Error('SDK_ITEST_SHARD must use the one-based index/total form')
  }
  const index = Number(match[1])
  const total = Number(match[2])
  if (index < 1 || total < 1 || index > total) {
    throw new Error('SDK_ITEST_SHARD index must be between 1 and its total')
  }
  return { index, total }
}

function parseUpdateBaseline(value: string | undefined): boolean {
  if (value === undefined) return false
  if (value !== '1') {
    throw new Error('SDK_ITEST_UPDATE_BASELINE must equal 1 when set')
  }
  return true
}

function parseTags(value: string | undefined): TagFilter | undefined {
  if (!value) return undefined
  const match = /^(all|any):(.*)$/.exec(value)
  const tags = parseRegisteredList(
    'SDK_ITEST_TAGS',
    match?.[2] ?? value,
    SCENARIO_TAGS,
  )
  if (tags.length === 0) {
    throw new Error('SDK_ITEST_TAGS must contain at least one tag')
  }
  return { match: (match?.[1] as 'all' | 'any' | undefined) ?? 'all', tags }
}

function parseRegisteredList<const TValues extends readonly string[]>(
  name: string,
  value: string | undefined,
  registered: TValues,
): Values<TValues>[] {
  if (!value) return []
  const parsed = value.split(',').map((part) => part.trim())
  if (parsed.some((part) => part.length === 0)) {
    throw new Error(`${name} contains an empty value`)
  }
  for (const part of parsed) {
    if (!isIncluded(registered, part)) {
      throw new Error(`${name} contains unregistered value ${part}`)
    }
  }
  return [...new Set(parsed)] as Values<TValues>[]
}

function isIncluded<const TValues extends readonly string[]>(
  registered: TValues,
  value: string,
): value is Values<TValues> {
  return (registered as readonly string[]).includes(value)
}

type Values<T extends readonly string[]> = T[number]
