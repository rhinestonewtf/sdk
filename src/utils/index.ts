import type { Account, Address, Hex } from 'viem'
import { createAccountConstruction } from '../accounts/construction'
import { getRhinestoneInitData, getV0InitData } from '../accounts/legacy'
import { toViewOnlyAccount as createViewOnlyAccount } from '../accounts/wallet-account'
import type {
  RhinestoneAccountConfig,
  RhinestoneConfig,
} from '../config/account'
import { resolveStandaloneAccountConfig } from '../config/resolve'
import { assertAccountOwnersConfigured } from '../config/validate'
import { toLegacyModuleSetup } from '../modules/legacy-core'
import {
  walletClientToAccount,
  wrapParaAccount,
} from '../signing/signers/compatibility'

function standaloneConstruction(
  config: RhinestoneConfig,
  profile: 'current-v2' | 'legacy-v0',
) {
  const resolved = resolveStandaloneAccountConfig(config, profile)
  assertAccountOwnersConfigured(resolved)
  const module =
    resolved.sessions.module.source === 'explicit'
      ? resolved.sessions.module.address
      : undefined
  const compatibilityFallback =
    resolved.sessions.compatibilityFallback.source === 'explicit'
      ? resolved.sessions.compatibilityFallback.address
      : undefined
  return createAccountConstruction({
    material: {
      account: resolved.account,
      ...(resolved.owners ? { owner: resolved.owners } : {}),
      modules: resolved.modules,
      ...(resolved.initData ? { initData: resolved.initData } : {}),
      ...(resolved.eoa ? { eoa: resolved.eoa } : {}),
      sessions: {
        enabled: resolved.sessions.enabled,
        environment:
          config.useDevContracts === true
            ? 'development'
            : resolved.sessions.environment,
        ...(module ? { module } : {}),
        ...(compatibilityFallback ? { compatibilityFallback } : {}),
      },
    },
    chain: { kind: 'evm', id: 1, caip2: 'eip155:1' },
    deployed: false,
  })
}

/**
 * Compute the v0 (legacy) initialization data for an account configuration.
 *
 * Use this to reconstruct the `initData` for an account originally created with
 * the Rhinestone SDK v0, then pass it back into `createAccount`.
 * @param config Account configuration
 * @returns The account address, factory, factory data, and whether the intent executor is installed
 * @example
 * ```ts
 * import { experimental_getV0InitData } from '@rhinestone/sdk/utils'
 *
 * const initData = experimental_getV0InitData({
 *   owners: { type: 'ecdsa', accounts: [owner] },
 * })
 *
 * const account = await sdk.createAccount({
 *   owners: { type: 'ecdsa', accounts: [owner] },
 *   initData,
 * })
 * ```
 */
function experimental_getV0InitData(config: RhinestoneAccountConfig): {
  address: Address
  factory: Address
  factoryData: Hex
  intentExecutorInstalled: boolean
} {
  return getV0InitData(standaloneConstruction(config, 'legacy-v0'))
}

/**
 * Compute the Rhinestone initialization data for an account configuration.
 *
 * Use this to reconstruct the `initData` for an account originally created with
 * the Rhinestone SDK, then pass it back into `createAccount` instead of
 * providing the factory and factory data manually.
 * @param config Account configuration
 * @returns The account address, plus factory data when the account is not yet deployed
 * @example
 * ```ts
 * import { experimental_getRhinestoneInitData } from '@rhinestone/sdk/utils'
 *
 * const initData = experimental_getRhinestoneInitData({
 *   owners: { type: 'ecdsa', accounts: [owner] },
 * })
 *
 * const account = await sdk.createAccount({
 *   owners: { type: 'ecdsa', accounts: [owner] },
 *   initData,
 * })
 * ```
 */
function experimental_getRhinestoneInitData(config: RhinestoneAccountConfig):
  | {
      address: Address
      factory: Address
      factoryData: Hex
      intentExecutorInstalled: boolean
    }
  | {
      address: Address
    } {
  if (
    config.initData &&
    !('factory' in config.initData) &&
    !config.eoa &&
    config.account?.type !== 'eoa' &&
    config.account?.type !== 'kernel'
  ) {
    return { address: config.initData.address }
  }
  return getRhinestoneInitData(standaloneConstruction(config, 'current-v2'))
}

/**
 * Create a view-only viem `Account` for an address. Any signing operation throws.
 *
 * Useful as an account owner when signing happens elsewhere (e.g. a server-held
 * session signer), so the SDK can read from the account without holding a key.
 * @param address Address to wrap
 * @returns A viem account that can be read from but not signed with
 * @example
 * ```ts
 * import { toViewOnlyAccount } from '@rhinestone/sdk/utils'
 *
 * const account = await sdk.createAccount({
 *   owners: { type: 'ecdsa', accounts: [toViewOnlyAccount(userAddress)] },
 * })
 * ```
 */
function toViewOnlyAccount(address: Address): Account {
  return createViewOnlyAccount(address)
}

/**
 * Compute the ERC-7579 module setup for an account configuration.
 * @param config Account and module configuration
 * @returns Validators, executors, hooks, and fallbacks to install
 */
function getSetup(config: RhinestoneConfig) {
  return toLegacyModuleSetup(standaloneConstruction(config, 'current-v2').setup)
}

export {
  experimental_getV0InitData,
  getSetup as experimental_getModuleSetup,
  experimental_getRhinestoneInitData,
  toViewOnlyAccount,
  walletClientToAccount,
  wrapParaAccount,
}
