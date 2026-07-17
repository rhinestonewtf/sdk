import type { Address, Hex } from 'viem'

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INSUFFICIENT_LIQUIDITY'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'KEY_SCOPE_DENIED'
  | 'CONFLICT'
  | 'UNPROCESSABLE_CONTENT'
  | 'TOO_MANY_REQUESTS'
  | 'SETTLEMENT_QUOTE_ERROR'
  | 'SETTLEMENT_EXECUTION_ERROR'
  | 'SIMULATION_FAILED'
  | 'EXTERNAL_SERVICE_TIMEOUT'
  | 'RELAYER_MARKET_UNAVAILABLE'
  | 'INTERNAL_ERROR'

export interface ErrorDetail {
  readonly message: string
  readonly context?: Readonly<Record<string, unknown>>
}

export interface ValidationIssue {
  readonly message: string
  readonly context?: Readonly<Record<string, unknown>>
}

export type SimulationAction = 'claim' | 'fill'
export type SimulationRetryHint = 'RE_PREPARE' | 'RETRY_LATER'
export type SimulationErrorCategory =
  | 'QUOTE_EXPIRED'
  | 'ORDER_EXPIRED'
  | 'PERMIT_EXPIRED'
  | 'PERMIT2_NONCE_CONSUMED'
  | 'EXECUTOR_NONCE_CONSUMED'
  | 'INVALID_SIGNATURE'
  | 'INVALID_PERMIT2_SIGNATURE'
  | 'INVALID_CONTRACT_SIGNATURE'
  | 'INVALID_SIGNER'
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_ALLOWANCE'
  | 'ACCOUNT_CREATION_FAILED'
  | 'ACCOUNT_UNAUTHORIZED'
  | 'ADAPTER_CALL_FAILED'
  | 'EXECUTION_FAILED'
  | 'CLAIM_FAILED'
  | 'ROUTER_PAUSED'
  | 'ADAPTER_NOT_FOUND'
  | 'PANIC'
  | 'REQUIRE_FAILED'
  | 'UNCLASSIFIED_REVERT'
  | 'EMPTY_REVERT'

export interface SimulationCall {
  readonly chainId?: string
  readonly to?: Address
  readonly data?: Hex
  readonly value?: string
}

export interface SimulationDetails {
  readonly stateOverride?: unknown
  readonly blockNumber?: string
  readonly relayer?: Address
  readonly simulationUrls?: string[]
}

export interface SimulationFailureSimulation {
  readonly success: false
  readonly action?: SimulationAction
  readonly chainId?: string
  readonly call?: SimulationCall
  readonly errorSelector?: string
  readonly errorName?: string
  readonly errorArgs?: Readonly<Record<string, unknown>>
  readonly errorCategory?: SimulationErrorCategory
  readonly details?: SimulationDetails
}

export interface OrchestratorClientErrorInput {
  readonly message: string
  readonly status: number
  readonly code?: string
  readonly traceId?: string
  readonly retryAfter?: string
  readonly details?: unknown
  readonly cause?: unknown
}

/**
 * Base orchestrator API error. Mirrors the published legacy shape (`code`,
 * `traceId`, `statusCode`) while retaining the transport `status` the retry
 * loop reads. Subclasses match the legacy taxonomy one-to-one so error
 * identity survives the facade cutover.
 */
export class OrchestratorClientError extends Error {
  readonly status: number
  readonly code: string
  readonly traceId: string
  readonly retryAfter?: string
  readonly details?: unknown

  constructor(input: OrchestratorClientErrorInput) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    )
    this.name = 'OrchestratorClientError'
    this.status = input.status
    this.code = input.code ?? 'UNKNOWN'
    this.traceId = input.traceId ?? ''
    this.retryAfter = input.retryAfter
    this.details = input.details
  }

  /** Legacy-compatible alias for the transport status. */
  get statusCode(): number {
    return this.status
  }
}

export class ValidationError extends OrchestratorClientError {
  readonly issues: readonly ValidationIssue[]

  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
    this.issues = Array.isArray(input.details)
      ? (input.details as ValidationIssue[])
      : []
  }
}

export class InsufficientLiquidityError extends OrchestratorClientError {
  readonly availableIntents: readonly Record<string, bigint>[]
  readonly unfillable: Readonly<Record<string, bigint>>

  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
    const details = isRecord(input.details) ? input.details : {}
    this.availableIntents = Array.isArray(details.availableIntents)
      ? details.availableIntents
          .filter(isRecord)
          .map((entry) => parseTokenAmounts(entry as Record<string, string>))
      : []
    this.unfillable = parseTokenAmounts(
      (isRecord(details.unfillable) ? details.unfillable : {}) as Record<
        string,
        string
      >,
    )
  }
}

export class NotFoundError extends OrchestratorClientError {
  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
  }
}

export class UnauthorizedError extends OrchestratorClientError {
  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
  }
}

export class ForbiddenError extends OrchestratorClientError {
  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
  }
}

/**
 * Thrown when an API key's scope denies the request. Subclass of
 * `ForbiddenError` carrying the failed `scope` and the `required` / `actual`
 * levels — distinct from a generic 403 so integrators can prompt the user to
 * widen the key's scope rather than rotate it.
 */
export class KeyScopeDeniedError extends ForbiddenError {
  readonly scope: string
  readonly required: string | boolean
  readonly actual: string | boolean

  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
    const detail = Array.isArray(input.details)
      ? (input.details[0] as { context?: unknown } | undefined)
      : undefined
    const context = (isRecord(detail?.context) ? detail?.context : {}) as {
      scope?: string
      required?: string | boolean
      actual?: string | boolean
    }
    this.scope = context.scope ?? ''
    this.required = context.required ?? ''
    this.actual = context.actual ?? ''
  }
}

export class ConflictError extends OrchestratorClientError {
  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
  }
}

export class UnprocessableContentError extends OrchestratorClientError {
  readonly details: readonly ErrorDetail[]

  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
    this.details = parseErrorDetails(input.details)
  }
}

export class RateLimitedError extends OrchestratorClientError {
  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
  }
}

export class SettlementQuoteError extends OrchestratorClientError {
  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
  }
}

export class SettlementExecutionError extends OrchestratorClientError {
  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
  }
}

export class SimulationFailedError extends OrchestratorClientError {
  readonly nonce?: string
  readonly category?: SimulationErrorCategory
  readonly errorSelector?: string
  readonly errorName?: string
  readonly errorArgs?: Readonly<Record<string, unknown>>
  readonly retryable: boolean
  readonly retryHint?: SimulationRetryHint
  readonly simulations: readonly SimulationFailureSimulation[]

  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
    const details = isRecord(input.details) ? input.details : {}
    this.nonce = stringValue(details.nonce)
    this.category = oneOf(details.category, SIMULATION_ERROR_CATEGORIES)
    this.errorSelector = stringValue(details.errorSelector)
    this.errorName = stringValue(details.errorName)
    this.errorArgs = recordValue(details.errorArgs)
    this.retryable = details.retryable === true
    this.retryHint = oneOf(details.retryHint, SIMULATION_RETRY_HINTS)
    this.simulations = Array.isArray(details.simulations)
      ? details.simulations
          .map(parseSimulationFailureSimulation)
          .filter(
            (simulation): simulation is SimulationFailureSimulation =>
              simulation !== undefined,
          )
      : []
  }
}

export class ExternalServiceTimeoutError extends OrchestratorClientError {
  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
  }
}

export class RelayerMarketUnavailableError extends OrchestratorClientError {
  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
  }
}

export class InternalServerError extends OrchestratorClientError {
  constructor(input: OrchestratorClientErrorInput) {
    super(input)
    this.name = 'Error'
  }
}

export function createOrchestratorClientError(
  input: OrchestratorClientErrorInput,
): OrchestratorClientError {
  switch (input.code) {
    case 'VALIDATION_ERROR':
      return new ValidationError(input)
    case 'INSUFFICIENT_LIQUIDITY':
      return new InsufficientLiquidityError(input)
    case 'NOT_FOUND':
      return new NotFoundError(input)
    case 'UNAUTHORIZED':
      return new UnauthorizedError(input)
    case 'FORBIDDEN':
      return new ForbiddenError(input)
    case 'KEY_SCOPE_DENIED':
      return new KeyScopeDeniedError(input)
    case 'CONFLICT':
      return new ConflictError(input)
    case 'UNPROCESSABLE_CONTENT':
      return new UnprocessableContentError(input)
    case 'TOO_MANY_REQUESTS':
      return new RateLimitedError(input)
    case 'SETTLEMENT_QUOTE_ERROR':
      return new SettlementQuoteError(input)
    case 'SETTLEMENT_EXECUTION_ERROR':
      return new SettlementExecutionError(input)
    case 'SIMULATION_FAILED':
      return new SimulationFailedError(input)
    case 'EXTERNAL_SERVICE_TIMEOUT':
      return new ExternalServiceTimeoutError(input)
    case 'RELAYER_MARKET_UNAVAILABLE':
      return new RelayerMarketUnavailableError(input)
    case 'INTERNAL_ERROR':
      return new InternalServerError(input)
    default:
      return new OrchestratorClientError(input)
  }
}

export function isOrchestratorError(
  error: unknown,
): error is OrchestratorClientError {
  return error instanceof OrchestratorClientError
}

export function isRateLimited(error: unknown): error is RateLimitedError {
  return error instanceof RateLimitedError
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError
}

export function isAuthError(
  error: unknown,
): error is UnauthorizedError | ForbiddenError {
  return error instanceof UnauthorizedError || error instanceof ForbiddenError
}

export function isSimulationFailed(
  error: unknown,
): error is SimulationFailedError {
  return error instanceof SimulationFailedError
}

/**
 * Published retryability predicate (legacy semantics): retry only on transient
 * server-side conditions, never on client (4xx) errors. Distinct from the
 * transport-status check the internal polling loop uses.
 */
export function isRetryable(error: unknown): boolean {
  return (
    error instanceof InternalServerError ||
    error instanceof ExternalServiceTimeoutError ||
    error instanceof RelayerMarketUnavailableError ||
    (error instanceof SimulationFailedError && error.retryable)
  )
}

/**
 * Transport-level retryability used by the intent status poller: retry on rate
 * limits (429) and server errors (5xx). Synthetic connection failures (status
 * 0) are handled separately by the poller. Coarser than {@link isRetryable}.
 */
export function isRetryableOrchestratorError(error: unknown): boolean {
  return (
    error instanceof OrchestratorClientError &&
    (error.status === 429 || error.status >= 500)
  )
}

function parseTokenAmounts(
  record: Record<string, string>,
): Record<string, bigint> {
  return Object.fromEntries(
    Object.entries(record).map(([addr, amount]) => [addr, BigInt(amount)]),
  )
}

function parseErrorDetails(value: unknown): readonly ErrorDetail[] {
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

const SIMULATION_ACTIONS = ['claim', 'fill'] as const
const SIMULATION_RETRY_HINTS = ['RE_PREPARE', 'RETRY_LATER'] as const
const SIMULATION_ERROR_CATEGORIES = [
  'QUOTE_EXPIRED',
  'ORDER_EXPIRED',
  'PERMIT_EXPIRED',
  'PERMIT2_NONCE_CONSUMED',
  'EXECUTOR_NONCE_CONSUMED',
  'INVALID_SIGNATURE',
  'INVALID_PERMIT2_SIGNATURE',
  'INVALID_CONTRACT_SIGNATURE',
  'INVALID_SIGNER',
  'INSUFFICIENT_BALANCE',
  'INSUFFICIENT_ALLOWANCE',
  'ACCOUNT_CREATION_FAILED',
  'ACCOUNT_UNAUTHORIZED',
  'ADAPTER_CALL_FAILED',
  'EXECUTION_FAILED',
  'CLAIM_FAILED',
  'ROUTER_PAUSED',
  'ADAPTER_NOT_FOUND',
  'PANIC',
  'REQUIRE_FAILED',
  'UNCLASSIFIED_REVERT',
  'EMPTY_REVERT',
] as const

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  return typeof value === 'string' && allowed.includes(value)
    ? (value as T[number])
    : undefined
}

function stringArrayValue(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined
}

function parseSimulationCall(value: unknown): SimulationCall | undefined {
  if (!isRecord(value)) return undefined
  return {
    chainId: stringValue(value.chainId),
    to: stringValue(value.to) as Address | undefined,
    data: stringValue(value.data) as Hex | undefined,
    value: stringValue(value.value),
  }
}

function parseSimulationDetails(value: unknown): SimulationDetails | undefined {
  if (!isRecord(value)) return undefined
  return {
    stateOverride: value.stateOverride,
    blockNumber: stringValue(value.blockNumber),
    relayer: stringValue(value.relayer) as Address | undefined,
    simulationUrls: stringArrayValue(value.simulationUrls),
  }
}

function parseSimulationFailureSimulation(
  value: unknown,
): SimulationFailureSimulation | undefined {
  if (!isRecord(value) || value.success !== false) return undefined
  return {
    success: false,
    action: oneOf(value.action, SIMULATION_ACTIONS),
    chainId: stringValue(value.chainId),
    call: parseSimulationCall(value.call),
    errorSelector: stringValue(value.errorSelector),
    errorName: stringValue(value.errorName),
    errorArgs: recordValue(value.errorArgs),
    errorCategory: oneOf(value.errorCategory, SIMULATION_ERROR_CATEGORIES),
    details: parseSimulationDetails(value.details),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}
