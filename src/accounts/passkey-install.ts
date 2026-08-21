import { type Address, encodeAbiParameters, type Hex, keccak256 } from 'viem'
import {
  hasDuplicateWebauthnCredentials,
  type WebauthnInstallCredential,
  webauthnCredentialsAreAscending,
} from '../modules/validators/webauthn'
import {
  KERNEL_SALT_DEFAULTS,
  NEXUS_SALT_DEFAULTS,
  SAFE_NONCE_DEFAULTS,
  STARTALE_SALT_DEFAULTS,
  selectedValue,
} from './deployment'
import { PasskeyConfigurationNotInstallableError } from './error'
import type { AccountDefinition } from './types'

// The validator's install data must list credentials with strictly ascending
// `keccak(x, y, account)`, so the number of salts that have to be tried grows
// with the factorial of the credential count. Six passkeys is ~0.2s of
// synchronous work in the worst realistic case; beyond that the remaining
// passkeys are added after deployment, which the validator accepts in any order.
export const MAX_DEPLOYMENT_PASSKEYS = 6
// The validator's own `MAX_CREDENTIALS`.
export const MAX_PASSKEY_CREDENTIALS = 32
// A fixed attempt count, never a wall-clock budget: a slower host must derive
// the same address as a faster one.
export const MAX_PASSKEY_SALT_ATTEMPTS = 65_536

const MEMO_LIMIT = 256
const memo = new Map<Hex, AccountDefinition>()

export function accountSupportsSaltSearch(account: AccountDefinition): boolean {
  return (
    account.kind === 'nexus' ||
    account.kind === 'kernel' ||
    account.kind === 'startale' ||
    account.kind === 'safe'
  )
}

function saltAttempt(base: Hex, attempt: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }],
      [base, BigInt(attempt)],
    ),
  )
}

// Attempt 0 is the caller's own salt, so a configuration that already installs
// cleanly keeps the address it derives today.
export function accountWithSaltAttempt(
  account: AccountDefinition,
  attempt: number,
): AccountDefinition {
  if (attempt === 0) return account
  switch (account.kind) {
    case 'nexus':
      return {
        ...account,
        salt: {
          source: 'explicit',
          value: saltAttempt(
            selectedValue(account.salt, NEXUS_SALT_DEFAULTS),
            attempt,
          ),
        },
      }
    case 'kernel':
      return {
        ...account,
        salt: {
          source: 'explicit',
          value: saltAttempt(
            selectedValue(account.salt, KERNEL_SALT_DEFAULTS),
            attempt,
          ),
        },
      }
    case 'startale':
      return {
        ...account,
        salt: {
          source: 'explicit',
          value: saltAttempt(
            selectedValue(account.salt, STARTALE_SALT_DEFAULTS),
            attempt,
          ),
        },
      }
    case 'safe': {
      const nonce = selectedValue(account.nonce, SAFE_NONCE_DEFAULTS)
      return {
        ...account,
        nonce: {
          source: 'explicit',
          value: BigInt(
            keccak256(
              encodeAbiParameters(
                [{ type: 'uint256' }, { type: 'uint256' }],
                [nonce, BigInt(attempt)],
              ),
            ),
          ),
        },
      }
    }
    case 'hca':
    case 'eoa':
      throw new PasskeyConfigurationNotInstallableError(
        `${account.kind} accounts have no salt to search`,
      )
  }
}

export function assertPasskeySetInstallable(input: {
  readonly credentials: readonly WebauthnInstallCredential[]
  readonly atDeployment: boolean
}): void {
  if (hasDuplicateWebauthnCredentials(input.credentials)) {
    throw new PasskeyConfigurationNotInstallableError(
      'the owner set contains duplicate passkeys',
    )
  }
  if (input.credentials.length > MAX_PASSKEY_CREDENTIALS) {
    throw new PasskeyConfigurationNotInstallableError(
      `the WebAuthn validator supports at most ${MAX_PASSKEY_CREDENTIALS} passkeys, received ${input.credentials.length}`,
    )
  }
  if (
    input.atDeployment &&
    input.credentials.length > MAX_DEPLOYMENT_PASSKEYS
  ) {
    throw new PasskeyConfigurationNotInstallableError(
      `at most ${MAX_DEPLOYMENT_PASSKEYS} passkeys can be installed at deployment, received ${input.credentials.length}. Deploy with ${MAX_DEPLOYMENT_PASSKEYS} or fewer and add the rest with \`passkeys.addOwner\``,
    )
  }
}

/**
 * Picks the account salt whose derived address makes the (canonically ordered)
 * passkey set installable. Deterministic: the same inputs select the same salt
 * on every host and in every run.
 */
export function selectPasskeyAccount(input: {
  readonly account: AccountDefinition
  readonly credentials: readonly WebauthnInstallCredential[]
  readonly fingerprint: Hex
  readonly deriveAddress: (account: AccountDefinition) => Address
  // Test seam only: production callers must use the fixed budget so a slower
  // host cannot derive a different address.
  readonly maxAttempts?: number
}): AccountDefinition {
  const cached = memo.get(input.fingerprint)
  if (cached) return cached
  const maxAttempts = input.maxAttempts ?? MAX_PASSKEY_SALT_ATTEMPTS
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = accountWithSaltAttempt(input.account, attempt)
    const address = input.deriveAddress(candidate)
    if (webauthnCredentialsAreAscending(input.credentials, address)) {
      if (memo.size >= MEMO_LIMIT) memo.clear()
      memo.set(input.fingerprint, candidate)
      return candidate
    }
  }
  throw new PasskeyConfigurationNotInstallableError(
    `no account salt in ${maxAttempts} attempts installs these ${input.credentials.length} passkeys. Deploy with fewer passkeys and add the rest with \`passkeys.addOwner\``,
  )
}
