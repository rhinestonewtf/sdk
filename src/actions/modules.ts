import type { LazyCallInput, ModuleInput } from '../config/account'
import type { ResolvedModule } from '../modules/types'
import {
  resolveModuleInstallation,
  resolveModuleUninstallation,
} from './runtime'

function resolveModule(module: ModuleInput): ResolvedModule {
  return {
    kind: module.type,
    address: module.address,
    initData: module.initData ?? '0x',
    deInitData: module.deInitData ?? '0x',
    additionalContext: module.additionalContext ?? '0x',
  }
}

/**
 * Build a call to install an EVM account module.
 * @param module Module kind, address and initialization data supported by the account
 * @returns A lazy call resolved for the executing account
 */
export function installModule(module: ModuleInput): LazyCallInput {
  const resolved = resolveModule(module)
  return {
    resolve: (context) => resolveModuleInstallation(context, resolved),
  }
}

/**
 * Build a call to uninstall an EVM account module.
 * @param module Installed module kind, address and deinitialization data
 * @returns A lazy call resolved for the executing account
 */
export function uninstallModule(module: ModuleInput): LazyCallInput {
  const resolved = resolveModule(module)
  return {
    resolve: (context) => resolveModuleUninstallation(context, resolved),
  }
}
