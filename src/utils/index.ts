import type { Account, Address, Hex } from 'viem'
import { toAccount } from 'viem/accounts'
import { getAddress, getInitCode, getV0InitCode } from '../accounts'
import { getSetup as experimental_getModuleSetup } from '../modules'
import type { AccountProviderConfig, OwnerSet } from '../types'

function experimental_getV0InitData(config: {
  account?: AccountProviderConfig
  owners?: OwnerSet
}): {
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

function experimental_getRhinestoneInitData(config: {
  account?: AccountProviderConfig
  owners?: OwnerSet
}):
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
}
