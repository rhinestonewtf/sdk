class OrchestratorError extends Error {
  private readonly _message: string
  private readonly _context: any
  private readonly _errorType: string
  private readonly _traceId: string

  constructor(params?: {
    message?: string
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super()
    this._message = params?.message || 'OrchestratorError '
    this._context = params?.context || {}
    this._errorType = params?.errorType || 'Unknown'
    this._traceId = params?.traceId || ''
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
}

class InsufficientBalanceError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
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
    params?: { context?: any; errorType?: string; traceId?: string },
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
    params?: { context?: any; errorType?: string; traceId?: string },
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
    params?: { context?: any; errorType?: string; traceId?: string },
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
  }) {
    super({
      message: 'Invalid API key',
      ...params,
    })
  }
}

class InvalidBundleSignatureError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message: 'Invalid bundle signature',
      ...params,
    })
  }
}

class OnlyOneTargetTokenAmountCanBeUnsetError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
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
  }) {
    super({
      message: 'No Path Found',
      ...params,
    })
  }
}

class OrderBundleNotFoundError extends OrchestratorError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message: 'Order bundle not found',
      ...params,
    })
  }
}

function isOrchestratorError(error: Error): error is OrchestratorError {
  return error instanceof OrchestratorError
}

export {
  isOrchestratorError,
  OrchestratorError,
  InsufficientBalanceError,
  UnsupportedChainIdError,
  UnsupportedChainError,
  UnsupportedTokenError,
  TokenNotSupportedError,
  AuthenticationRequiredError,
  InvalidApiKeyError,
  InvalidBundleSignatureError,
  OnlyOneTargetTokenAmountCanBeUnsetError,
  NoPathFoundError,
  OrderBundleNotFoundError,
}
