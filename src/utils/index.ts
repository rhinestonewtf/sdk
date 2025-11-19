import type { Account, Address, Hex } from 'viem'
import { toAccount } from 'viem/accounts'
import { getAddress, getInitCode } from '../accounts'
import { getSetup as experimental_getModuleSetup } from '../modules'
import type { AccountProviderConfig, OwnerSet } from '../types'

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
  const signingError = new Error(
    'Signing is not supported for view-only accounts',
  )
  return toAccount({
    address,
    signMessage: async () => {
      throw signingError
    },
    signTypedData: async () => {
      throw signingError
    },
    signTransaction: async () => {
      throw signingError
    },
  })
}

export {
  experimental_getModuleSetup,
  experimental_getRhinestoneInitData,
  toViewOnlyAccount,
}
