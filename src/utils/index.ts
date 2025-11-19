import type { Address, Hex } from 'viem'
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

export { experimental_getModuleSetup, experimental_getRhinestoneInitData }
