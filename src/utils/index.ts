import type { Address, Hex } from 'viem'
import { getAddress, getInitCode } from '../accounts'
import { getSetup as experimental_getModuleSetup } from '../modules'
import type { AccountProviderConfig, OwnerSet } from '../types'

function experimental_getRhinestoneInitData(config: {
  account?: AccountProviderConfig
  owners?: OwnerSet
}): {
  address: Address
  factory: Address
  factoryData: Hex
  intentExecutorInstalled: boolean
} {
  const initCode = getInitCode(config)
  if (!initCode) {
    throw new Error('Init code not available')
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

export { experimental_getModuleSetup, experimental_getRhinestoneInitData }
