import type { Address, Hex } from 'viem'

import type { RhinestoneAccount } from '..'
import {
  getModuleInstallationCalls,
  getModuleUninstallationCalls,
} from '../accounts'
import { type Module, type ModuleType, toModuleTypeId } from '../modules/common'

interface ModuleInput {
  type: ModuleType
  address: Address
  initData?: Hex
  deInitData?: Hex
  additionalContext?: Hex
}

/**
 * Install a custom module
 * @param rhinestoneAccount Account to install the module on
 * @param module Module to install
 * @returns Calls to install the module
 */
function installModule({
  rhinestoneAccount,
  module,
}: {
  rhinestoneAccount: RhinestoneAccount
  module: ModuleInput
}) {
  const moduleData: Module = getModule(module)
  const calls = getModuleInstallationCalls(rhinestoneAccount.config, moduleData)
  return calls
}

/**
 * Uninstall a custom module
 * @param rhinestoneAccount Account to uninstall the module on
 * @param module Module to uninstall
 * @returns Calls to uninstall the module
 */
function uninstallModule({
  rhinestoneAccount,
  module,
}: {
  rhinestoneAccount: RhinestoneAccount
  module: ModuleInput
}) {
  const moduleData: Module = getModule(module)
  const calls = getModuleUninstallationCalls(
    rhinestoneAccount.config,
    moduleData,
  )
  return calls
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
