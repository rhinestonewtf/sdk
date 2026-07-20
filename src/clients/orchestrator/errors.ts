import type { Address, Hex } from 'viem'

type ErrorCode =
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

interface ValidationIssue {
  message: string
  context?: Record<string, unknown>
}

interface ErrorDetail {
  message: string
  context?: Record<string, unknown>
}

interface BaseErrorParams {
  message: string
  traceId?: string
  statusCode?: number
}

type SimulationAction = 'claim' | 'fill'
type SimulationRetryHint = 'RE_PREPARE' | 'RETRY_LATER'
type SimulationErrorCategory =
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

interface SimulationCall {
  chainId?: string
  to?: Address
  data?: Hex
  value?: string
}

interface SimulationDetails {
  stateOverride?: unknown
  blockNumber?: string
  relayer?: Address
  simulationUrls?: string[]
}

interface SimulationFailureSimulation {
  success: false
  action?: SimulationAction
  chainId?: string
  call?: SimulationCall
  errorSelector?: string
  errorName?: string
  errorArgs?: Record<string, unknown>
  errorCategory?: SimulationErrorCategory
  details?: SimulationDetails
}

interface SimulationFailureDetails {
  nonce?: string
  category?: SimulationErrorCategory
  errorSelector?: string
  errorName?: string
  errorArgs?: Record<string, unknown>
  retryable?: boolean
  retryHint?: SimulationRetryHint
  simulations?: SimulationFailureSimulation[]
}

class OrchestratorError extends Error {
  readonly code: ErrorCode | 'UNKNOWN'
  readonly traceId: string
  readonly statusCode?: number

  constructor(params: BaseErrorParams & { code?: ErrorCode | 'UNKNOWN' }) {
    super(params.message)
    this.code = params.code ?? 'UNKNOWN'
    this.traceId = params.traceId ?? ''
    this.statusCode = params.statusCode
  }
}

class ValidationError extends OrchestratorError {
  readonly issues: ValidationIssue[]

  constructor(params: BaseErrorParams & { issues?: ValidationIssue[] }) {
    super({ ...params, code: 'VALIDATION_ERROR' })
    this.issues = params.issues ?? []
  }
}

class InsufficientLiquidityError extends OrchestratorError {
  readonly availableIntents: Record<string, bigint>[]
  readonly unfillable: Record<string, bigint>

  constructor(
    params: BaseErrorParams & {
      availableIntents: Record<string, bigint>[]
      unfillable: Record<string, bigint>
    },
  ) {
    super({ ...params, code: 'INSUFFICIENT_LIQUIDITY' })
    this.availableIntents = params.availableIntents
    this.unfillable = params.unfillable
  }
}

class NotFoundError extends OrchestratorError {
  constructor(params: BaseErrorParams) {
    super({ ...params, code: 'NOT_FOUND' })
  }
}

class UnauthorizedError extends OrchestratorError {
  constructor(params: BaseErrorParams) {
    super({ ...params, code: 'UNAUTHORIZED' })
  }
}

class ForbiddenError extends OrchestratorError {
  constructor(params: BaseErrorParams & { code?: ErrorCode }) {
    super({ ...params, code: params.code ?? 'FORBIDDEN' })
  }
}

/**
 * Thrown when an API key's scope denies the request.
 *
 * Subclass of `ForbiddenError` carrying the failed `scope` and the
 * `required` / `actual` levels — distinct from a generic 403 so integrators
 * can prompt the user to widen the key's scope rather than rotate it.
 */
class KeyScopeDeniedError extends ForbiddenError {
  readonly scope: string
  readonly required: string | boolean
  readonly actual: string | boolean

  constructor(
    params: BaseErrorParams & {
      scope: string
      required: string | boolean
      actual: string | boolean
    },
  ) {
    super({ ...params, code: 'KEY_SCOPE_DENIED' })
    this.scope = params.scope
    this.required = params.required
    this.actual = params.actual
  }
}

class ConflictError extends OrchestratorError {
  constructor(params: BaseErrorParams) {
    super({ ...params, code: 'CONFLICT' })
  }
}

class UnprocessableContentError extends OrchestratorError {
  readonly details: ErrorDetail[]

  constructor(params: BaseErrorParams & { details?: ErrorDetail[] }) {
    super({ ...params, code: 'UNPROCESSABLE_CONTENT' })
    this.details = params.details ?? []
  }
}

class RateLimitedError extends OrchestratorError {
  readonly retryAfter?: string

  constructor(params: BaseErrorParams & { retryAfter?: string }) {
    super({ ...params, code: 'TOO_MANY_REQUESTS' })
    this.retryAfter = params.retryAfter
  }
}

class SettlementQuoteError extends OrchestratorError {
  constructor(params: BaseErrorParams) {
    super({ ...params, code: 'SETTLEMENT_QUOTE_ERROR' })
  }
}

class SettlementExecutionError extends OrchestratorError {
  constructor(params: BaseErrorParams) {
    super({ ...params, code: 'SETTLEMENT_EXECUTION_ERROR' })
  }
}

class SimulationFailedError extends OrchestratorError {
  readonly nonce?: string
  readonly category?: SimulationErrorCategory
  readonly errorSelector?: string
  readonly errorName?: string
  readonly errorArgs?: Record<string, unknown>
  readonly retryable: boolean
  readonly retryHint?: SimulationRetryHint
  readonly simulations: SimulationFailureSimulation[]

  constructor(params: BaseErrorParams & SimulationFailureDetails) {
    super({ ...params, code: 'SIMULATION_FAILED' })
    this.nonce = params.nonce
    this.category = params.category
    this.errorSelector = params.errorSelector
    this.errorName = params.errorName
    this.errorArgs = params.errorArgs
    this.retryable = params.retryable ?? false
    this.retryHint = params.retryHint
    this.simulations = params.simulations ?? []
  }
}

class ExternalServiceTimeoutError extends OrchestratorError {
  constructor(params: BaseErrorParams) {
    super({ ...params, code: 'EXTERNAL_SERVICE_TIMEOUT' })
  }
}

class RelayerMarketUnavailableError extends OrchestratorError {
  constructor(params: BaseErrorParams) {
    super({ ...params, code: 'RELAYER_MARKET_UNAVAILABLE' })
  }
}

class InternalServerError extends OrchestratorError {
  constructor(params: BaseErrorParams) {
    super({ ...params, code: 'INTERNAL_ERROR' })
  }
}

interface ErrorEnvelope {
  code: ErrorCode
  message: string
  traceId: string
  details?: unknown
}

function parseTokenAmounts(
  record: Record<string, string>,
): Record<string, bigint> {
  return Object.fromEntries(
    Object.entries(record).map(([addr, amount]) => [addr, BigInt(amount)]),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function parseErrorDetails(details: unknown): ErrorDetail[] {
  if (!Array.isArray(details)) {
    return []
  }

  return details.flatMap((detail): ErrorDetail[] => {
    if (!isRecord(detail) || typeof detail.message !== 'string') {
      return []
    }

    const context = recordValue(detail.context)
    return [
      {
        message: detail.message,
        ...(context ? { context } : {}),
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
    ? value
    : undefined
}

function stringArrayValue(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined
}

function parseSimulationCall(value: unknown): SimulationCall | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  return {
    chainId: stringValue(value.chainId),
    to: stringValue(value.to) as Address | undefined,
    data: stringValue(value.data) as Hex | undefined,
    value: stringValue(value.value),
  }
}

function parseSimulationDetails(value: unknown): SimulationDetails | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  return {
    stateOverride: value.stateOverride,
    blockNumber: stringValue(value.blockNumber),
    relayer: stringValue(value.relayer) as Address | undefined,
    simulationUrls: stringArrayValue(value.simulationUrls),
  }
}

function isSimulationFailureSimulation(
  value: unknown,
): value is SimulationFailureSimulation {
  return isRecord(value) && value.success === false
}

function parseSimulationFailureSimulation(
  value: unknown,
): SimulationFailureSimulation | undefined {
  if (!isSimulationFailureSimulation(value)) {
    return undefined
  }

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

function parseSimulationFailureDetails(
  details: unknown,
): SimulationFailureDetails {
  if (!isRecord(details)) {
    return {}
  }

  return {
    nonce: stringValue(details.nonce),
    category: oneOf(details.category, SIMULATION_ERROR_CATEGORIES),
    errorSelector: stringValue(details.errorSelector),
    errorName: stringValue(details.errorName),
    errorArgs: recordValue(details.errorArgs),
    retryable: booleanValue(details.retryable),
    retryHint: oneOf(details.retryHint, SIMULATION_RETRY_HINTS),
    simulations: Array.isArray(details.simulations)
      ? details.simulations
          .map(parseSimulationFailureSimulation)
          .filter(
            (simulation): simulation is SimulationFailureSimulation =>
              simulation !== undefined,
          )
      : undefined,
  }
}

function parseErrorEnvelope(
  envelope: ErrorEnvelope,
  statusCode: number,
  retryAfter?: string,
): OrchestratorError {
  const base = {
    message: envelope.message,
    traceId: envelope.traceId,
    statusCode,
  }

  switch (envelope.code) {
    case 'VALIDATION_ERROR': {
      const issues = Array.isArray(envelope.details)
        ? (envelope.details as ValidationIssue[])
        : []
      return new ValidationError({ ...base, issues })
    }
    case 'INSUFFICIENT_LIQUIDITY': {
      const details = (envelope.details ?? {}) as {
        availableIntents?: Record<string, string>[]
        unfillable?: Record<string, string>
      }
      return new InsufficientLiquidityError({
        ...base,
        availableIntents: (details.availableIntents ?? []).map(
          parseTokenAmounts,
        ),
        unfillable: parseTokenAmounts(details.unfillable ?? {}),
      })
    }
    case 'NOT_FOUND':
      return new NotFoundError(base)
    case 'UNAUTHORIZED':
      return new UnauthorizedError(base)
    case 'FORBIDDEN':
      return new ForbiddenError(base)
    case 'KEY_SCOPE_DENIED': {
      const detail = Array.isArray(envelope.details)
        ? (envelope.details[0] as { context?: unknown } | undefined)
        : undefined
      const context = (detail?.context ?? {}) as {
        scope?: string
        required?: string | boolean
        actual?: string | boolean
      }
      return new KeyScopeDeniedError({
        ...base,
        scope: context.scope ?? '',
        required: context.required ?? '',
        actual: context.actual ?? '',
      })
    }
    case 'CONFLICT':
      return new ConflictError(base)
    case 'UNPROCESSABLE_CONTENT':
      return new UnprocessableContentError({
        ...base,
        details: parseErrorDetails(envelope.details),
      })
    case 'TOO_MANY_REQUESTS':
      return new RateLimitedError({ ...base, retryAfter })
    case 'SETTLEMENT_QUOTE_ERROR':
      return new SettlementQuoteError(base)
    case 'SETTLEMENT_EXECUTION_ERROR':
      return new SettlementExecutionError(base)
    case 'SIMULATION_FAILED':
      return new SimulationFailedError({
        ...base,
        ...parseSimulationFailureDetails(envelope.details),
      })
    case 'EXTERNAL_SERVICE_TIMEOUT':
      return new ExternalServiceTimeoutError(base)
    case 'RELAYER_MARKET_UNAVAILABLE':
      return new RelayerMarketUnavailableError(base)
    case 'INTERNAL_ERROR':
      return new InternalServerError(base)
    default:
      return new OrchestratorError({ ...base, code: 'UNKNOWN' })
  }
}

function isOrchestratorError(error: unknown): error is OrchestratorError {
  return error instanceof OrchestratorError
}

function isRateLimited(error: unknown): error is RateLimitedError {
  return error instanceof RateLimitedError
}

function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError
}

function isAuthError(
  error: unknown,
): error is UnauthorizedError | ForbiddenError {
  return error instanceof UnauthorizedError || error instanceof ForbiddenError
}

function isSimulationFailed(error: unknown): error is SimulationFailedError {
  return error instanceof SimulationFailedError
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof InternalServerError ||
    error instanceof ExternalServiceTimeoutError ||
    error instanceof RelayerMarketUnavailableError ||
    (error instanceof SimulationFailedError && error.retryable)
  )
}

// Transport-level error codes that escape `fetch` as raw errors rather than
// typed HTTP envelopes. Spans Node/undici and common system codes.
const CONNECTION_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

const CONNECTION_ERROR_MESSAGES = [
  'socket connection was closed', // Bun
  'fetch failed', // undici/Node (the coded cause is matched separately)
  'failed to fetch', // Chrome/Edge
  'networkerror when attempting to fetch', // Firefox
  'network request failed',
  'connection closed',
  'connection reset',
]

/**
 * Detects transport-level failures (connection reset, socket closed, DNS, TLS)
 * that `fetch` rejects with instead of returning an HTTP response. Unlike HTTP
 * errors — which the client converts into typed {@link OrchestratorError}s —
 * these carry no status and bubble up untyped, so {@link isRetryable} misses
 * them. They are safe to retry for idempotent reads (e.g. intent-status
 * polling). We match by `code` and message across the cause chain — never by
 * error type: `fetch` rejects network failures as `TypeError`, but `TypeError`
 * is also thrown for logic bugs, bad URLs, and response-decoding errors that
 * must NOT be retried (`waitForExecution` has no SDK-side deadline). Runtimes
 * differ (Bun throws a plain `Error` with a socket message; undici/Node a
 * `TypeError` with a coded `cause`), hence both signals. Caller-initiated
 * aborts are excluded so deadlines/cancellation still propagate.
 */
function isConnectionError(error: unknown): boolean {
  // HTTP-status errors are already typed and classified elsewhere.
  if (isOrchestratorError(error)) {
    return false
  }
  // Caller cancellation / deadline must propagate, not retry.
  if (error instanceof Error && error.name === 'AbortError') {
    return false
  }
  // Walk the `cause` chain; `seen` guards against cyclic causes looping forever.
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current != null && !seen.has(current)) {
    seen.add(current)
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) {
      return true
    }
    const message =
      current instanceof Error ? current.message.toLowerCase() : ''
    if (CONNECTION_ERROR_MESSAGES.some((m) => message.includes(m))) {
      return true
    }
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export type {
  ErrorCode,
  ErrorDetail,
  ErrorEnvelope,
  SimulationAction,
  SimulationCall,
  SimulationDetails,
  SimulationErrorCategory,
  SimulationFailureDetails,
  SimulationFailureSimulation,
  SimulationRetryHint,
  ValidationIssue,
}
export {
  parseErrorEnvelope,
  isOrchestratorError,
  isRetryable,
  isConnectionError,
  isAuthError,
  isValidationError,
  isRateLimited,
  isSimulationFailed,
  OrchestratorError,
  ValidationError,
  InsufficientLiquidityError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  KeyScopeDeniedError,
  ConflictError,
  UnprocessableContentError,
  RateLimitedError,
  SettlementQuoteError,
  SettlementExecutionError,
  SimulationFailedError,
  ExternalServiceTimeoutError,
  RelayerMarketUnavailableError,
  InternalServerError,
}
