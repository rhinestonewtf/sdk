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

class QuoteNotInPreparedTransactionError extends ExecutionError {
  constructor(params?: {
    context?: { intentId?: string }
    errorType?: string
    traceId?: string
  }) {
    super({
      message:
        'Selected quote does not belong to the prepared transaction. Re-prepare and try again.',
      ...params,
    })
  }
}

class InvalidSourceCallsError extends ExecutionError {
  constructor(params?: {
    chainId?: number
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message:
        params?.chainId !== undefined
          ? `sourceCalls includes chainId ${params.chainId} which is not in sourceChains (or the target chain for same-chain transactions)`
          : 'sourceCalls includes a chainId not in sourceChains (or the target chain for same-chain transactions)',
      ...params,
    })
  }
}

class Eip7702InitSignatureRequiredError extends ExecutionError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message:
        'EIP-7702 initialization signature is required for 7702 accounts. This signature is needed during transaction preparation, even if your account is already deployed on all chains. Use `getEip7702InitSignature()` to generate it.',
      ...params,
    })
  }
}

class UnknownOwnerError extends ExecutionError {
  constructor(params?: {
    context?: { signer?: string; publicKey?: string; validatorId?: number }
    errorType?: string
    traceId?: string
  }) {
    super({
      message:
        'The provided owner is not part of the account owner set. Pass an account that matches one of the configured `owners` (for multi-factor owner sets, also pass the matching `validatorId`).',
      ...params,
    })
  }
}

class MismatchedOwnerSignaturesError extends ExecutionError {
  constructor(params?: {
    message?: string
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message:
        params?.message ??
        'Owner signatures are inconsistent and cannot be assembled. All owners must sign the same prepared transaction and quote using `signTransaction` with the `owner` option.',
      ...params,
    })
  }
}

class InsufficientOwnerSignaturesError extends ExecutionError {
  constructor(params?: {
    required?: number
    provided?: number
    validatorId?: number
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message:
        params?.required !== undefined
          ? params?.validatorId !== undefined
            ? `Not enough owner signatures to meet the threshold of validator ${params.validatorId}: ${params.provided ?? 0} of ${params.required} required. Collect the missing owner signatures before calling \`assembleTransaction\`.`
            : `Not enough owner signatures to meet the account threshold: ${params.provided ?? 0} of ${params.required} required. Collect the missing owner signatures before calling \`assembleTransaction\`.`
          : 'Not enough owner signatures to meet the account threshold. Collect the missing owner signatures before calling `assembleTransaction`.',
      context: {
        required: params?.required,
        provided: params?.provided,
        validatorId: params?.validatorId,
        ...params?.context,
      },
      errorType: params?.errorType,
      traceId: params?.traceId,
    })
  }
}

class InvalidOwnerSigningOptionsError extends ExecutionError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message:
        'Invalid per-owner signing options. Pass `validatorId` only for multi-factor accounts, where it must identify the factor containing `owner`.',
      ...params,
    })
  }
}

class IndependentSigningNotSupportedError extends ExecutionError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message:
        'Independent owner signing is only supported for smart accounts using ECDSA, passkey, or multi-factor owners. EOA accounts, smart sessions, and K1/ERC-7739 validators must use the standard `signTransaction` flow.',
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
  Eip7702InitSignatureRequiredError,
  IndependentSigningNotSupportedError,
  InsufficientOwnerSignaturesError,
  InvalidOwnerSigningOptionsError,
  InvalidSourceCallsError,
  MismatchedOwnerSignaturesError,
  OrderPathRequiredForIntentsError,
  QuoteNotInPreparedTransactionError,
  IntentFailedError,
  UnknownOwnerError,
}
