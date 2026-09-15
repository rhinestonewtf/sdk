class AccountCapabilityError extends Error {
  readonly context: Readonly<Record<string, unknown>>

  constructor(
    message: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = 'AccountCapabilityError'
    this.context = context
  }
}

/** Thrown when a composite account configuration is malformed. */
class InvalidAccountConfigError extends AccountCapabilityError {
  constructor(message: string) {
    super(`Invalid account configuration: ${message}`)
    this.name = 'InvalidAccountConfigError'
  }
}

/** Thrown when managed Solana capability is requested outside development. */
class ManagedSolanaAccountNotSupportedError extends AccountCapabilityError {
  constructor(message?: string) {
    super(
      message ??
        'Managed Solana accounts are available only when `useDevContracts: true`. Production has no enabled Swig namespace; use an address-only Solana receiver instead.',
      { vm: 'solana' },
    )
    this.name = 'ManagedSolanaAccountNotSupportedError'
  }
}

/** Thrown when an address is requested for a VM absent from the account. */
class AccountVmNotConfiguredError extends AccountCapabilityError {
  constructor(vm: string) {
    super(`The ${vm} VM is not configured on this account.`, { vm })
    this.name = 'AccountVmNotConfiguredError'
  }
}

/** Thrown when a transaction requests an unsupported account capability. */
class UnsupportedAccountCapabilityError extends AccountCapabilityError {
  constructor(message: string, context?: Readonly<Record<string, unknown>>) {
    super(message, context)
    this.name = 'UnsupportedAccountCapabilityError'
  }
}

function isAccountCapabilityError(
  error: unknown,
): error is AccountCapabilityError {
  return error instanceof AccountCapabilityError
}

export {
  AccountCapabilityError,
  AccountVmNotConfiguredError,
  InvalidAccountConfigError,
  ManagedSolanaAccountNotSupportedError,
  UnsupportedAccountCapabilityError,
  isAccountCapabilityError,
}
