export class OrchestratorClientError extends Error {
  readonly status: number
  readonly code?: string
  readonly traceId?: string
  readonly retryAfter?: string
  readonly details?: unknown

  constructor(input: {
    readonly message: string
    readonly status: number
    readonly code?: string
    readonly traceId?: string
    readonly retryAfter?: string
    readonly details?: unknown
    readonly cause?: unknown
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    )
    this.name = 'OrchestratorClientError'
    this.status = input.status
    this.code = input.code
    this.traceId = input.traceId
    this.retryAfter = input.retryAfter
    this.details = input.details
  }
}

export interface OrchestratorErrorDetail {
  readonly message: string
  readonly context?: Readonly<Record<string, unknown>>
}

export class UnprocessableContentError extends OrchestratorClientError {
  readonly details: readonly OrchestratorErrorDetail[]

  constructor(input: ConstructorParameters<typeof OrchestratorClientError>[0]) {
    super(input)
    this.name = 'Error'
    this.details = parseErrorDetails(input.details)
  }
}

export class RateLimitedError extends OrchestratorClientError {
  constructor(input: ConstructorParameters<typeof OrchestratorClientError>[0]) {
    super(input)
    this.name = 'Error'
  }
}

export class SimulationFailedError extends OrchestratorClientError {
  readonly nonce?: string
  readonly category?: string
  readonly errorSelector?: string
  readonly errorName?: string
  readonly errorArgs?: Readonly<Record<string, unknown>>
  readonly retryable: boolean
  readonly retryHint?: string
  readonly simulations: readonly unknown[]

  constructor(input: ConstructorParameters<typeof OrchestratorClientError>[0]) {
    super(input)
    this.name = 'Error'
    const details = isRecord(input.details) ? input.details : {}
    this.nonce = stringValue(details.nonce)
    this.category = stringValue(details.category)
    this.errorSelector = stringValue(details.errorSelector)
    this.errorName = stringValue(details.errorName)
    this.errorArgs = isRecord(details.errorArgs) ? details.errorArgs : undefined
    this.retryable = details.retryable === true
    this.retryHint = stringValue(details.retryHint)
    this.simulations = Array.isArray(details.simulations)
      ? details.simulations
      : []
  }
}

export function createOrchestratorClientError(
  input: ConstructorParameters<typeof OrchestratorClientError>[0],
): OrchestratorClientError {
  switch (input.code) {
    case 'UNPROCESSABLE_CONTENT':
      return new UnprocessableContentError(input)
    case 'TOO_MANY_REQUESTS':
      return new RateLimitedError(input)
    case 'SIMULATION_FAILED':
      return new SimulationFailedError(input)
    default:
      return new OrchestratorClientError(input)
  }
}

export function isRetryableOrchestratorError(error: unknown): boolean {
  return (
    error instanceof OrchestratorClientError &&
    (error.status === 429 || error.status >= 500)
  )
}

function parseErrorDetails(value: unknown): readonly OrchestratorErrorDetail[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((detail) => {
    if (!isRecord(detail) || typeof detail.message !== 'string') return []
    return [
      {
        message: detail.message,
        ...(isRecord(detail.context) ? { context: detail.context } : {}),
      },
    ]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
