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

export function installModule(module: ModuleInput): LazyCallInput {
  const resolved = resolveModule(module)
  return {
    resolve: (context) => resolveModuleInstallation(context, resolved),
  }
}

export function uninstallModule(module: ModuleInput): LazyCallInput {
  const resolved = resolveModule(module)
  return {
    resolve: (context) => resolveModuleUninstallation(context, resolved),
  }
}
