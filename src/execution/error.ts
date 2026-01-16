class ExecutionError extends Error {
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
    this._message = params?.message || 'ExecutionError'
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

class SignerNotSupportedError extends ExecutionError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message:
        'Sending a transaction is not supported for this type of signers. Use user operations instead.',
      ...params,
    })
  }
}

class OrderPathRequiredForIntentsError extends ExecutionError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message: 'Order path is required when using intents',
      ...params,
    })
  }
}

class SessionChainRequiredError extends ExecutionError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message:
        'Specifying a chain is required when using multi-chain smart sessions',
      ...params,
    })
  }
}

class IntentFailedError extends ExecutionError {
  constructor(params?: {
    intentId?: string
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message: 'Intent failed',
      ...params,
    })
  }
}

class IntentStatusTimeoutError extends ExecutionError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message: 'Intent status polling timed out',
      ...params,
    })
  }
}

function isExecutionError(error: Error): error is ExecutionError {
  return error instanceof ExecutionError
}

export {
  isExecutionError,
  ExecutionError,
  OrderPathRequiredForIntentsError,
  SessionChainRequiredError,
  IntentFailedError,
  IntentStatusTimeoutError,
  SignerNotSupportedError,
}
