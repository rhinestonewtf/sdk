import type { CharacterizationObservation, ErrorPhase } from './observe'
import type { CharacterizationScenario } from './types'

export type ExpectationResult =
  | { readonly passed: true }
  | { readonly passed: false; readonly reasons: readonly string[] }

const EXPECTED_PHASES: Readonly<
  Record<
    Extract<CharacterizationScenario['expected'], { kind: 'failure' }>['stage'],
    readonly ErrorPhase[]
  >
> = {
  prepare: ['prepare'],
  sign: ['sign'],
  authorize: ['authorize'],
  submit: ['simulate', 'submit'],
  execution: ['execution', 'wait', 'assert'],
}

export function evaluateScenarioObservation(
  scenario: CharacterizationScenario,
  observation: CharacterizationObservation,
): ExpectationResult {
  const reasons: string[] = []

  if (scenario.expected.kind === 'success') {
    if (observation.outcome.status === 'failure') {
      reasons.push(
        `expected success, received ${observation.outcome.error.phase} ${observation.outcome.error.class}: ${observation.outcome.error.message}`,
      )
    }
    return reasons.length === 0 ? { passed: true } : { passed: false, reasons }
  }

  if (observation.outcome.status === 'success') {
    return {
      passed: false,
      reasons: [
        `expected ${scenario.expected.stage} failure, received success`,
      ],
    }
  }

  const error = observation.outcome.error
  if (!EXPECTED_PHASES[scenario.expected.stage].includes(error.phase)) {
    reasons.push(
      `expected phase ${scenario.expected.stage}, received ${error.phase}`,
    )
  }
  if (error.class !== scenario.expected.errorClass) {
    reasons.push(
      `expected error class ${scenario.expected.errorClass}, received ${error.class}`,
    )
  }
  if (
    scenario.expected.code !== undefined &&
    String(error.code) !== scenario.expected.code
  ) {
    reasons.push(
      `expected error code ${scenario.expected.code}, received ${String(error.code)}`,
    )
  }
  if (!error.message.includes(scenario.expected.messageInvariant)) {
    reasons.push(
      `error message does not include ${JSON.stringify(scenario.expected.messageInvariant)}`,
    )
  }

  return reasons.length === 0 ? { passed: true } : { passed: false, reasons }
}
