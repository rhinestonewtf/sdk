import type { CharacterizationScenario } from './types'

export type Shard = {
  readonly index: number
  readonly total: number
}

type WeightedScenario = {
  readonly scenario: CharacterizationScenario
  readonly weight: number
  readonly tieBreaker: number
}

export function assignScenariosToShards(
  scenarios: readonly CharacterizationScenario[],
  total: number,
): ReadonlyMap<string, number> {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error('Shard total must be a positive integer')
  }

  const lanes = Array.from({ length: total }, (_, index) => ({
    index: index + 1,
    weight: 0,
  }))
  const assignments = new Map<string, number>()
  const weighted: WeightedScenario[] = scenarios.map((scenario) => ({
    scenario,
    weight: scenarioWeight(scenario),
    tieBreaker: stableHash(
      `${scenario.id}:${scenario.workflow}:${scenario.mode}:${scenario.primaryCategory}`,
    ),
  }))

  weighted.sort(
    (left, right) =>
      right.weight - left.weight ||
      left.tieBreaker - right.tieBreaker ||
      left.scenario.id.localeCompare(right.scenario.id),
  )

  for (const item of weighted) {
    lanes.sort(
      (left, right) => left.weight - right.weight || left.index - right.index,
    )
    const lane = lanes[0]
    assignments.set(item.scenario.id, lane.index)
    lane.weight += item.weight
  }

  return assignments
}

function scenarioWeight(scenario: CharacterizationScenario): number {
  const modeWeight = { sign: 1, dryRun: 3, execute: 8 }[scenario.mode]
  const stateWeight = scenario.tags.includes('stateful') ? 3 : 0
  const fundingWeight = scenario.setup.funding === 'none' ? 0 : 2
  const timeoutWeight = Math.max(1, Math.ceil(scenario.timeoutMs / 60_000))
  return modeWeight + stateWeight + fundingWeight + timeoutWeight
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
