import type { Address, Hex } from 'viem'

export type ModuleKind = 'validator' | 'executor' | 'fallback' | 'hook'

export interface ModuleId {
  readonly kind: ModuleKind
  readonly address: Address
}

export interface ResolvedModule extends ModuleId {
  readonly initData: Hex
  readonly deInitData: Hex
}

export interface ModuleCapabilities {
  readonly installable: boolean
  readonly uninstallable: boolean
  readonly supportsInitializationRead: boolean
}

export interface ModuleInstallationPlan {
  readonly module: ResolvedModule
  readonly operation: 'install' | 'uninstall'
  readonly accountCallData: Hex
}
