import type { ScenarioHandlerKey } from '../catalog'
import type { CharacterizationSubject, UserOperationScenario } from '../types'

export type LegacyUserOperationHandlerKey = Extract<
  ScenarioHandlerKey,
  `user-operation:${string}`
>

export type LegacyUserOperationRunInput = {
  readonly scenario: UserOperationScenario
  readonly subject: Extract<CharacterizationSubject, 'legacy' | 'rewrite'>
  readonly baseSha: string
  readonly runId: string
}

export const LEGACY_USER_OPERATION_HANDLER_KEYS =
  [] as const satisfies readonly LegacyUserOperationHandlerKey[]

export class LegacyUserOperationNotExecutableError extends Error {
  readonly scenarioId: string
  readonly handlerKey: LegacyUserOperationHandlerKey
  readonly limitation?: string
  readonly coverageRef?: string

  constructor(
    scenario: UserOperationScenario,
    handlerKey: LegacyUserOperationHandlerKey,
  ) {
    const gap =
      scenario.support.level === 'offline-only' ? scenario.support : undefined
    super(
      gap
        ? `Legacy UserOperation scenario ${scenario.id} is an offline-only gap: ${gap.limitation} Coverage: ${gap.coverageRef}`
        : `No legacy UserOperation handler is registered for ${handlerKey}`,
    )
    this.name = 'LegacyUserOperationNotExecutableError'
    this.scenarioId = scenario.id
    this.handlerKey = handlerKey
    this.limitation = gap?.limitation
    this.coverageRef = gap?.coverageRef
  }
}

export async function runLegacyUserOperationScenario({
  scenario,
}: LegacyUserOperationRunInput): Promise<never> {
  throw new LegacyUserOperationNotExecutableError(
    scenario,
    getLegacyUserOperationHandlerKey(scenario),
  )
}

export function getLegacyUserOperationHandlerKey(
  scenario: UserOperationScenario,
): LegacyUserOperationHandlerKey {
  return `user-operation:${scenario.fixtureId}:${scenario.caseId}`
}
