import type { AccountType } from '../types'

class AccountError extends Error {
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
    this._message = params?.message || 'AccountError'
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

class Eip7702AccountMustHaveEoaError extends AccountError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message: 'EIP-7702 accounts must have an EOA account',
      ...params,
    })
  }
}

class ExistingEip7702AccountsNotSupportedError extends AccountError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message: 'Existing EIP-7702 accounts are not yet supported',
      ...params,
    })
  }
}

class FactoryArgsNotAvailableError extends AccountError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message: 'Factory args not available',
      ...params,
    })
  }
}

class SmartSessionsNotEnabledError extends AccountError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message: 'Smart sessions are not enabled for this account',
      ...params,
    })
  }
}

class SigningNotSupportedForAccountError extends AccountError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message: 'Signing not supported for the account',
      ...params,
    })
  }
}

class Eip7702NotSupportedForAccountError extends AccountError {
  constructor(
    account: AccountType,
    params?: { context?: any; errorType?: string; traceId?: string },
  ) {
    const accountName = getAccountName(account)
    super({
      message: `EIP-7702 is not supported for ${accountName} accounts`,
      ...params,
    })
  }
}

class AccountConfigurationNotSupportedError extends AccountError {
  constructor(
    message: string,
    account: AccountType,
    params?: {
      context?: any
      errorType?: string
      traceId?: string
    },
  ) {
    super({
      message: `Account configuration for ${getAccountName(account)} account is not supported: ${message}`,
      ...params,
    })
  }
}

class WalletClientNoConnectedAccountError extends AccountError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message:
        'WalletClient is missing a default account. Ensure the wallet is connected and the client has an account.',
      ...params,
    })
  }
}

class ModuleInstallationNotSupportedError extends AccountError {
  constructor(
    account: AccountType,
    params?: { context?: any; errorType?: string; traceId?: string },
  ) {
    const accountName = getAccountName(account)
    super({
      message: `Module installation is not supported for ${accountName} accounts`,
      ...params,
    })
  }
}

class EoaSigningNotSupportedError extends AccountError {
  constructor(
    method: string,
    params?: { context?: any; errorType?: string; traceId?: string },
  ) {
    super({
      message: `EOA account provider does not support ${method} signing`,
      ...params,
    })
  }
}

class EoaSigningMethodNotConfiguredError extends AccountError {
  constructor(
    method: string,
    params?: { context?: any; errorType?: string; traceId?: string },
  ) {
    super({
      message: `EOA account provider must have ${method} method configured`,
      ...params,
    })
  }
}

class OwnersFieldRequiredError extends AccountError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message: 'Owners field is required for smart accounts',
      ...params,
    })
  }
}

function isAccountError(error: Error): error is AccountError {
  return error instanceof AccountError
}

function getAccountName(account: AccountType) {
  switch (account) {
    case 'safe':
      return 'Safe'
    case 'kernel':
      return 'Kernel'
    case 'nexus':
      return 'Nexus'
    case 'startale':
      return 'Startale'
    case 'eoa':
      return 'EOA'
  }
}

export {
  isAccountError,
  AccountError,
  Eip7702AccountMustHaveEoaError,
  ExistingEip7702AccountsNotSupportedError,
  FactoryArgsNotAvailableError,
  SmartSessionsNotEnabledError,
  SigningNotSupportedForAccountError,
  Eip7702NotSupportedForAccountError,
  AccountConfigurationNotSupportedError,
  WalletClientNoConnectedAccountError,
  ModuleInstallationNotSupportedError,
  EoaSigningNotSupportedError,
  EoaSigningMethodNotConfiguredError,
  OwnersFieldRequiredError,
}
