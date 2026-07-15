import type {
  CharacterizationSubject as CatalogSubject,
  ExecutionMode,
  WorkflowKind,
} from './types'

export type CharacterizationMode = ExecutionMode
export type CharacterizationSubject = CatalogSubject
export type CharacterizationWorkflow = WorkflowKind

export type ErrorPhase =
  | 'construction'
  | 'prepare'
  | 'sign'
  | 'authorize'
  | 'simulate'
  | 'submit'
  | 'execution'
  | 'wait'
  | 'assert'

export interface ErrorObservation {
  phase: ErrorPhase
  class: string
  name: string
  message: string
  code?: string | number
  status?: string | number
  cause?: ErrorObservation
}

export type ObservationOutcome =
  | { status: 'success' }
  | { status: 'failure'; error: ErrorObservation }

export interface ObservationContext {
  scenarioId: string
  workflow: CharacterizationWorkflow
  subject: CharacterizationSubject
  runId: string
  comparisonGroup: string
}

export interface SigningObservation {
  account?: unknown
  prepared?: unknown
  signing?: unknown
  artifacts?: unknown
  authorizations?: unknown
}

export type ModeDetails =
  | { mode: 'sign'; sign: SigningObservation }
  | {
      mode: 'dryRun'
      sign: SigningObservation
      simulation: unknown
    }
  | {
      mode: 'execute'
      sign: SigningObservation
      execution: unknown
    }

export type CharacterizationObservation = ObservationContext &
  ModeDetails & {
    schemaVersion: 1
    outcome: ObservationOutcome
  }

function readProperty(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

function scalarProperty(
  value: object,
  key: string,
): string | number | undefined {
  const property = readProperty(value, key)
  return typeof property === 'string' || typeof property === 'number'
    ? property
    : undefined
}

export function observeError(
  error: unknown,
  phase: ErrorPhase,
  seen = new WeakSet<object>(),
): ErrorObservation {
  if (typeof error !== 'object' || error === null) {
    const className = error === null ? 'null' : typeof error
    return {
      phase,
      class: className,
      name: 'NonErrorThrow',
      message: String(error),
    }
  }

  const constructorName = error.constructor?.name
  const name = scalarProperty(error, 'name')
  const message = scalarProperty(error, 'message')
  const code = scalarProperty(error, 'code')
  const status =
    scalarProperty(error, 'status') ?? scalarProperty(error, 'statusCode')
  const observation: ErrorObservation = {
    phase,
    class:
      typeof constructorName === 'string' && constructorName.length > 0
        ? constructorName
        : typeof name === 'string'
          ? name
          : 'UnknownError',
    name: typeof name === 'string' ? name : 'Error',
    message: typeof message === 'string' ? message : String(error),
  }

  if (code !== undefined) observation.code = code
  if (status !== undefined) observation.status = status

  if (!seen.has(error)) {
    seen.add(error)
    const cause = readProperty(error, 'cause')
    if (cause !== undefined && cause !== error) {
      observation.cause = observeError(cause, phase, seen)
    }
  }

  return observation
}

export function successfulOutcome(): ObservationOutcome {
  return { status: 'success' }
}

export function failedOutcome(
  error: unknown,
  phase: ErrorPhase,
): ObservationOutcome {
  return { status: 'failure', error: observeError(error, phase) }
}

export function createModeObservation(
  context: ObservationContext,
  details: ModeDetails,
  outcome: ObservationOutcome,
): CharacterizationObservation {
  return {
    schemaVersion: 1,
    ...context,
    ...details,
    outcome,
  } as CharacterizationObservation
}
