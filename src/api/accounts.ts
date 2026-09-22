import { type Address, type Hex, isAddress } from 'viem'
import { locateSwigWallet } from '../accounts/solana/address'
import { type SolanaAddress, solanaAddress } from '../chains/non-evm'
import type {
  EvmAccountConfig,
  RhinestoneAccountConfig,
  SolanaOwner,
  SolanaSwig,
} from '../config/account'
import type {
  AccountConstructionInput,
  SdkConstructionInput,
} from '../config/input'
import {
  captureLegacySdkConfig,
  createLegacyAccountConfig,
  type LegacyAccountConfig,
  type LegacySdkConfigSnapshot,
} from '../config/legacy'
import {
  materializeAccountInvocationContext,
  resolveSdkConfig,
} from '../config/resolve'
import { assertAccountOwnersConfigured } from '../config/validate'
import {
  AccountVmNotConfiguredError,
  InvalidAccountConfigError,
  ManagedSolanaAccountNotSupportedError,
} from '../errors/capability'
import { compressP256PublicKey } from '../transactions/intents/solana'
import {
  createAccountFacade,
  createSolanaAccountFacade,
  type RhinestoneAccount,
  type RhinestoneAccountBase,
} from './account'
import { createConfiguredCoreComposition } from './compose'
import type { CoreComposition } from './compose-types'

export interface SdkComposition {
  readonly composition: CoreComposition<LegacyAccountConfig<unknown>>
  readonly snapshot: LegacySdkConfigSnapshot<unknown>
}

export function composeSdk(input: SdkConstructionInput): SdkComposition {
  const resolved = resolveSdkConfig(input)
  return {
    composition:
      createConfiguredCoreComposition<LegacyAccountConfig<unknown>>(resolved),
    snapshot: captureLegacySdkConfig(input, resolved.auth),
  }
}

const ACCOUNT_KEYS = ['evm', 'solana']
const MANAGED_SOLANA_ORCHESTRATOR_URL =
  'https://dev.v1.orchestrator.rhinestone.dev'
const EVM_KEYS = [
  'account',
  'owners',
  'sessions',
  'recovery',
  'eoa',
  'modules',
  'initData',
]

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidAccountConfigError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key))
  if (unknown) {
    throw new InvalidAccountConfigError(`unknown ${label} field \`${unknown}\``)
  }
}

function isEcdsaAccount(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { address?: unknown }).address === 'string' &&
    isAddress((value as { address: string }).address)
  )
}

function isPasskeyAccount(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const account = value as Record<string, unknown>
  if (
    account.type !== 'webAuthn' ||
    typeof account.id !== 'string' ||
    account.id.length === 0 ||
    typeof account.sign !== 'function' ||
    typeof account.publicKey !== 'string'
  ) {
    return false
  }
  try {
    compressP256PublicKey(account.publicKey as Hex)
    return true
  } catch {
    return false
  }
}

function parseSwig(value: unknown): SolanaSwig {
  const swig = record(value, 'managed Solana Swig')
  exactKeys(swig, ['address', 'swigAccount'], 'managed Solana Swig')
  try {
    const swigAccount = solanaAddress(swig.swigAccount as string)
    const address = locateSwigWallet(swigAccount).address
    if (swig.address === address) return { address, swigAccount }
  } catch {}
  throw new InvalidAccountConfigError(
    '`swig.address` must be the wallet of the Solana address `swig.swigAccount`',
  )
}

export function attachAccount<const C extends RhinestoneAccountConfig>(
  sdk: SdkComposition,
  config: C,
): RhinestoneAccount<C> {
  const input = record(config, 'account configuration')
  exactKeys(input, ACCOUNT_KEYS, 'account')
  if (
    (!Object.hasOwn(input, 'evm') && !Object.hasOwn(input, 'solana')) ||
    (input.evm === undefined && input.solana === undefined)
  ) {
    throw new InvalidAccountConfigError('at least one VM must be configured')
  }

  let evmReceiver: Address | undefined
  let managedEvm: EvmAccountConfig | undefined
  let managedSolanaOwner: SolanaOwner | undefined
  let managedSolanaSwig: SolanaSwig | undefined
  let solanaReceiver: SolanaAddress | undefined

  if (input.evm !== undefined) {
    const evm = record(input.evm, 'EVM configuration')
    if (Object.hasOwn(evm, 'address')) {
      exactKeys(evm, ['address'], 'EVM receiver')
      if (typeof evm.address !== 'string' || !isAddress(evm.address)) {
        throw new InvalidAccountConfigError('EVM receiver address is invalid')
      }
      evmReceiver = evm.address
    } else {
      exactKeys(evm, EVM_KEYS, 'managed EVM')
      managedEvm = input.evm as EvmAccountConfig
    }
  }

  if (input.solana !== undefined) {
    const solana = record(input.solana, 'Solana configuration')
    if (Object.hasOwn(solana, 'address')) {
      exactKeys(solana, ['address'], 'Solana receiver')
      if (typeof solana.address !== 'string') {
        throw new InvalidAccountConfigError(
          'Solana receiver address is invalid',
        )
      }
      try {
        solanaReceiver = solanaAddress(solana.address)
      } catch {
        throw new InvalidAccountConfigError(
          'Solana receiver address is invalid',
        )
      }
    } else {
      exactKeys(solana, ['owner', 'swig'], 'managed Solana')
      const owner = record(solana.owner, 'managed Solana owner')
      exactKeys(owner, ['type', 'account'], 'managed Solana owner')
      if (owner.type === 'ecdsa' && isEcdsaAccount(owner.account)) {
        managedSolanaOwner = owner as SolanaOwner
      } else if (owner.type === 'passkey' && isPasskeyAccount(owner.account)) {
        managedSolanaOwner = owner as SolanaOwner
      } else {
        throw new ManagedSolanaAccountNotSupportedError(
          "Managed Solana requires `{ owner: { type: 'ecdsa', account } }` with a valid viem ECDSA account, or `{ owner: { type: 'passkey', account } }` with a viem WebAuthn account holding a P-256 public key.",
        )
      }
      if (solana.swig !== undefined) managedSolanaSwig = parseSwig(solana.swig)
    }
  }

  if (managedSolanaSwig && input.evm !== undefined) {
    throw new InvalidAccountConfigError(
      '`solana.swig` is for an account with no `evm` entry',
    )
  }
  if (managedSolanaOwner && !managedEvm && !managedSolanaSwig) {
    throw new ManagedSolanaAccountNotSupportedError(
      'Managed Solana requires a managed EVM account, whose address selects the Swig, or `swig: { address, swigAccount }`.',
    )
  }
  if (
    managedSolanaOwner &&
    sdk.composition.config.environment !== 'development'
  ) {
    throw new ManagedSolanaAccountNotSupportedError()
  }
  if (
    managedSolanaOwner &&
    sdk.composition.config.orchestratorUrl.replace(/\/+$/u, '') !==
      MANAGED_SOLANA_ORCHESTRATOR_URL
  ) {
    throw new ManagedSolanaAccountNotSupportedError(
      `Managed Solana requires \`endpointUrl: '${MANAGED_SOLANA_ORCHESTRATOR_URL}'\` in addition to \`useDevContracts: true\`.`,
    )
  }

  const capturedSolana =
    managedSolanaOwner &&
    Object.freeze({
      owner: Object.freeze({
        type: managedSolanaOwner.type,
        account: managedSolanaOwner.account,
      }),
      ...(managedSolanaSwig
        ? { swig: Object.freeze({ ...managedSolanaSwig }) }
        : {}),
    })
  if (managedSolanaOwner && managedSolanaSwig) {
    return createSolanaAccountFacade(
      {
        owner: managedSolanaOwner,
        walletAddress: managedSolanaSwig.address,
        swigAddress: managedSolanaSwig.swigAccount,
        endpoint: sdk.composition.config.orchestratorUrl,
      },
      Object.freeze({ ...config, solana: capturedSolana }) as Readonly<C>,
      sdk.composition,
    ) as RhinestoneAccount<C>
  }

  const captured = Object.freeze({ ...config }) as Readonly<C>
  if (!managedEvm) {
    const receiver: RhinestoneAccountBase<C> = {
      config: captured,
      getAddress(vm) {
        if (vm === 'evm' && evmReceiver) return evmReceiver as never
        if (vm === 'solana' && solanaReceiver) return solanaReceiver as never
        throw new AccountVmNotConfiguredError(String(vm))
      },
    }
    return Object.freeze(receiver) as RhinestoneAccount<C>
  }

  const compatibilityConfig = createLegacyAccountConfig(
    managedEvm as AccountConstructionInput,
    sdk.snapshot,
  )
  assertAccountOwnersConfigured(
    materializeAccountInvocationContext(
      sdk.composition.config,
      compatibilityConfig,
      'get-address',
    ).account,
  )
  const managedCaptured = Object.freeze({
    ...config,
    evm: compatibilityConfig,
    ...(capturedSolana ? { solana: capturedSolana } : {}),
  }) as Readonly<C>
  return createAccountFacade(
    compatibilityConfig,
    managedCaptured,
    sdk.composition,
  )
}
