import type { Account, Address, Hex } from 'viem'
import { toAccount } from 'viem/accounts'
import { getAddress, getInitCode, getV0InitCode } from '../accounts'
import { getSetup as experimental_getModuleSetup } from '../modules'
import type { RhinestoneAccountConfig } from '../types'
import { walletClientToAccount, wrapParaAccount } from './walletClient'

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
  const initCode = getV0InitCode(config)
  if (!initCode) {
    throw new Error('Init code not available')
  }
  if (!('factory' in initCode)) {
    throw new Error('Factory not available')
  }
  const { factory, factoryData } = initCode
  const address = getAddress(config)
  return {
    address,
    factory,
    factoryData,
    intentExecutorInstalled: true,
  }
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
  const initCode = getInitCode(config)
  if (!initCode) {
    throw new Error('Init code not available')
  }
  const address = getAddress(config)
  if ('factory' in initCode) {
    const { factory, factoryData } = initCode
    return {
      address,
      factory,
      factoryData,
      intentExecutorInstalled: true,
    }
  } else {
    return {
      address,
    }
  }
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
  const errorMessage = 'Signing is not supported for view-only accounts'
  return toAccount({
    address,
    signMessage: async () => {
      throw new Error(errorMessage)
    },
    signTypedData: async () => {
      throw new Error(errorMessage)
    },
    signTransaction: async () => {
      throw new Error(errorMessage)
    },
  })
}

export {
  experimental_getV0InitData,
  experimental_getModuleSetup,
  experimental_getRhinestoneInitData,
  toViewOnlyAccount,
  walletClientToAccount,
  wrapParaAccount,
}
