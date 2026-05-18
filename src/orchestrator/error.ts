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
  | 'EXTERNAL_SERVICE_TIMEOUT'
  | 'RELAYER_MARKET_UNAVAILABLE'
  | 'INTERNAL_ERROR'

interface ValidationIssue {
  message: string
  context?: Record<string, unknown>
}

interface BaseErrorParams {
  message: string
  traceId?: string
  statusCode?: number
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
  constructor(params: BaseErrorParams) {
    super({ ...params, code: 'UNPROCESSABLE_CONTENT' })
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

/**
 * Thrown by the SDK's local token/chain registry — not an orchestrator API
 * error. Distinct from `OrchestratorError` so consumers can catch them
 * separately from server-side failures.
 */
class UnsupportedChainError extends Error {
  readonly chainId: number
  constructor(chainId: number) {
    super(`Unsupported chain ${chainId}`)
    this.chainId = chainId
  }
}

class UnsupportedTokenError extends Error {
  readonly tokenSymbol: string
  readonly chainId: number
  constructor(tokenSymbol: string, chainId: number) {
    super(`Unsupported token ${tokenSymbol} for chain ${chainId}`)
    this.tokenSymbol = tokenSymbol
    this.chainId = chainId
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
      return new UnprocessableContentError(base)
    case 'TOO_MANY_REQUESTS':
      return new RateLimitedError({ ...base, retryAfter })
    case 'SETTLEMENT_QUOTE_ERROR':
      return new SettlementQuoteError(base)
    case 'SETTLEMENT_EXECUTION_ERROR':
      return new SettlementExecutionError(base)
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

function isRetryable(error: unknown): boolean {
  return (
    error instanceof InternalServerError ||
    error instanceof ExternalServiceTimeoutError ||
    error instanceof RelayerMarketUnavailableError
  )
}

export type { ErrorCode, ErrorEnvelope, ValidationIssue }
export {
  parseErrorEnvelope,
  isOrchestratorError,
  isRetryable,
  isAuthError,
  isValidationError,
  isRateLimited,
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
  ExternalServiceTimeoutError,
  RelayerMarketUnavailableError,
  InternalServerError,
  UnsupportedChainError,
  UnsupportedTokenError,
}
