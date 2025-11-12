import {
  getModuleInstallationCalls,
  getModuleUninstallationCalls,
} from '../accounts'
import { type Module, toModuleTypeId } from '../modules/common'
import type { LazyCallInput, ModuleInput } from '../types'

/**
 * Install a custom module
 * @param module Module to install
 * @returns Calls to install the module
 */
function installModule(module: ModuleInput): LazyCallInput {
  const moduleData: Module = getModule(module)
  return {
    async resolve({ config }) {
      return getModuleInstallationCalls(config, moduleData)
    },
  }
}

/**
 * Uninstall a custom module
 * @param module Module to uninstall
 * @returns Calls to uninstall the module
 */
function uninstallModule(module: ModuleInput): LazyCallInput {
  const moduleData: Module = getModule(module)
  return {
    async resolve({ config }) {
      return getModuleUninstallationCalls(config, moduleData)
    },
  }
}

function getModule(module: ModuleInput): Module {
  return {
    type: toModuleTypeId(module.type),
    address: module.address,
    initData: module.initData ?? '0x',
    deInitData: module.deInitData ?? '0x',
    additionalContext: module.additionalContext ?? '0x',
  }
}

export { installModule, uninstallModule }
