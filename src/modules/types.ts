import type { Address, Hex } from 'viem'

export type ModuleKind = 'validator' | 'executor' | 'fallback' | 'hook'

export interface ModuleInput {
  type: ModuleKind
  address: Address
  initData?: Hex
  deInitData?: Hex
  additionalContext?: Hex
}

export type ModuleDataSelection =
  | { readonly source: 'explicit'; readonly value: Hex }
  | { readonly source: 'omitted' }

export interface ConfiguredModule extends ModuleId {
  readonly initData: ModuleDataSelection
  readonly deInitData: ModuleDataSelection
  readonly additionalContext: ModuleDataSelection
}

export interface ModuleId {
  readonly kind: ModuleKind
  readonly address: Address
}

export interface ResolvedModule extends ModuleId {
  readonly initData: Hex
  readonly deInitData: Hex
  readonly additionalContext: Hex
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

export interface ModuleSetup {
  readonly validators: readonly ResolvedModule[]
  readonly executors: readonly ResolvedModule[]
  readonly hooks: readonly ResolvedModule[]
  readonly fallbacks: readonly ResolvedModule[]
}
