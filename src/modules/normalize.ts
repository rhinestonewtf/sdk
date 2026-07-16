import type { ConfiguredModule, ResolvedModule } from './types'

function materializeData(
  selection: ConfiguredModule['initData'],
): `0x${string}` {
  return selection.source === 'explicit' ? selection.value : '0x'
}

export function normalizeModule(module: ConfiguredModule): ResolvedModule {
  return {
    kind: module.kind,
    address: module.address,
    initData: materializeData(module.initData),
    deInitData: materializeData(module.deInitData),
    additionalContext: materializeData(module.additionalContext),
  }
}

export function normalizeModules(
  modules: readonly ConfiguredModule[],
): readonly ResolvedModule[] {
  return modules.map(normalizeModule)
}
