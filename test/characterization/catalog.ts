import { accountScenarios } from './scenarios/accounts'
import { failureScenarios } from './scenarios/failures'
import { intentScenarios } from './scenarios/intents'
import { sessionScenarios } from './scenarios/sessions'
import { userOperationAndDirectSigningScenarios } from './scenarios/user-operations'
import { validatorScenarios } from './scenarios/validators'
import type {
  CharacterizationScenario,
  ScenarioCaseId,
  ScenarioFixtureId,
  WorkflowKind,
} from './types'

export const characterizationScenarios: readonly CharacterizationScenario[] = [
  ...accountScenarios,
  ...validatorScenarios,
  ...sessionScenarios,
  ...intentScenarios,
  ...userOperationAndDirectSigningScenarios,
  ...failureScenarios,
]

export type ScenarioHandlerKey =
  `${WorkflowKind}:${ScenarioFixtureId}:${ScenarioCaseId}`

export function getScenarioHandlerKey(
  scenario: CharacterizationScenario,
): ScenarioHandlerKey {
  return `${scenario.workflow}:${scenario.fixtureId}:${scenario.caseId}`
}

export function isExecutableCharacterizationScenario(
  scenario: CharacterizationScenario,
): boolean {
  return (
    scenario.workflow === 'direct-signing' ||
    scenario.support.level !== 'offline-only'
  )
}

export const CHARACTERIZATION_HANDLER_KEYS = [
  ...new Set(characterizationScenarios.map(getScenarioHandlerKey)),
].sort() as ScenarioHandlerKey[]

export const EXECUTABLE_CHARACTERIZATION_HANDLER_KEYS = [
  ...new Set(
    characterizationScenarios
      .filter(isExecutableCharacterizationScenario)
      .map(getScenarioHandlerKey),
  ),
].sort() as ScenarioHandlerKey[]
