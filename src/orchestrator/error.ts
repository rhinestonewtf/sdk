import { Address, Hex } from 'viem'

interface Simulation {
  success: boolean
  call: {
    chainId: number
    to: Address
    data: Hex
    value: string
  }
  details: {
    stateOverride: unknown[]
    blockNumber: string
    relayer: string
    simulationUrl: string
  }
}

class OrchestratorError extends Error {
  private readonly _message: string
  private readonly _context: any
  private readonly _errorType: string
  private readonly _traceId: string
  private readonly _statusCode?: number

  constructor(params?: {
    message?: string
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super()
    this._message = params?.message || 'OrchestratorError '
    this._context = params?.context || {}
    this._errorType = params?.errorType || 'Unknown'
    this._traceId = params?.traceId || ''
    this._statusCode = params?.statusCode
  }

  get message() {
    return this._message
  }

  get context() {
    return this._context
  }

  get errorType() {
    return this._errorType
  }

  get traceId() {
    return this._traceId
  }

  get statusCode() {
    return this._statusCode
  }
}

class InsufficientBalanceError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'Insufficient balance',
      ...params,
    })
  }
}

class UnsupportedChainIdError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'Unsupported chain id',
      ...params,
    })
  }
}

class UnsupportedChainError extends OrchestratorError {
  constructor(
    chainId: number,
    params?: {
      context?: any
      errorType?: string
      traceId?: string
      statusCode?: number
    },
  ) {
    super({
      message: `Unsupported chain ${chainId}`,
      ...params,
    })
  }
}

class UnsupportedTokenError extends OrchestratorError {
  constructor(
    tokenSymbol: string,
    chainId: number,
    params?: {
      context?: any
      errorType?: string
      traceId?: string
      statusCode?: number
    },
  ) {
    super({
      message: `Unsupported token ${tokenSymbol} for chain ${chainId}`,
      ...params,
    })
  }
}

class TokenNotSupportedError extends OrchestratorError {
  constructor(
    tokenAddress: string,
    chainId: number,
    params?: {
      context?: any
      errorType?: string
      traceId?: string
      statusCode?: number
    },
  ) {
    super({
      message: `Token ${tokenAddress} not supported on chain ${chainId}`,
      ...params,
    })
  }
}

class AuthenticationRequiredError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'Authentication is required',
      ...params,
    })
  }
}

class InvalidApiKeyError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'Invalid API key',
      ...params,
    })
  }
}

class InvalidIntentSignatureError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'Invalid intent signature',
      ...params,
    })
  }
}

class OnlyOneTargetTokenAmountCanBeUnsetError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'Only one target token amount can be unset',
      ...params,
    })
  }
}

class NoPathFoundError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'No Path Found',
      ...params,
    })
  }
}

class IntentNotFoundError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'Intent not found',
      ...params,
    })
  }
}

class SchemaValidationError extends OrchestratorError {
  constructor(params?: {
    message?: string
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: params?.message || 'Schema validation error',
      ...params,
    })
  }
}

class RateLimitedError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'Too Many Requests',
      ...params,
    })
  }
}

class ServiceUnavailableError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'Service Unavailable',
      ...params,
    })
  }
}

class UnauthorizedError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'Unauthorized',
      ...params,
    })
  }
}

class ForbiddenError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'Forbidden',
      ...params,
    })
  }
}

class ResourceNotFoundError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'Not Found',
      ...params,
    })
  }
}

class ConflictError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'Conflict',
      ...params,
    })
  }
}

class BadRequestError extends OrchestratorError {
  constructor(params?: {
    message?: string
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: params?.message || 'Bad Request',
      ...params,
    })
  }
}

class UnprocessableEntityError extends OrchestratorError {
  constructor(params?: {
    message?: string
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: params?.message || 'Unprocessable Entity',
      ...params,
    })
  }
}

class InternalServerError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: 'Internal Server Error',
      ...params,
    })
  }
}

class BodyParserError extends OrchestratorError {
  constructor(params?: {
    message?: string
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
  }) {
    super({
      message: params?.message || 'Body parser error',
      ...params,
    })
  }
}

class SimulationFailedError extends OrchestratorError {
  constructor(params?: {
    message?: string
    context?: any
    errorType?: string
    traceId?: string
    statusCode?: number
    simulations?: Simulation[]
  }) {
    super({
      message: params?.message || 'Simulation failed',
      ...params,
    })
  }
}

function isOrchestratorError(error: Error): error is OrchestratorError {
  return error instanceof OrchestratorError
}

function isRateLimited(error: unknown): error is RateLimitedError {
  return (
    error instanceof RateLimitedError ||
    (error instanceof OrchestratorError && error.statusCode === 429)
  )
}

function isValidationError(error: unknown): boolean {
  if (!(error instanceof OrchestratorError)) return false
  return error.statusCode === 400 || error.statusCode === 422
}

function isAuthError(error: unknown): boolean {
  if (!(error instanceof OrchestratorError)) return false
  return (
    error.statusCode === 401 || error instanceof AuthenticationRequiredError
  )
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof OrchestratorError)) return false
  return error.statusCode === 500 || error.statusCode === 503
}

export {
  isOrchestratorError,
  isRetryable,
  isAuthError,
  isValidationError,
  isRateLimited,
  OrchestratorError,
  InsufficientBalanceError,
  UnsupportedChainIdError,
  UnsupportedChainError,
  UnsupportedTokenError,
  TokenNotSupportedError,
  AuthenticationRequiredError,
  InvalidApiKeyError,
  InvalidIntentSignatureError,
  OnlyOneTargetTokenAmountCanBeUnsetError,
  NoPathFoundError,
  IntentNotFoundError,
  SchemaValidationError,
  RateLimitedError,
  ServiceUnavailableError,
  UnauthorizedError,
  ForbiddenError,
  ResourceNotFoundError,
  ConflictError,
  BadRequestError,
  UnprocessableEntityError,
  InternalServerError,
  BodyParserError,
  SimulationFailedError,
}
