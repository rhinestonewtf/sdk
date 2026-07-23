import { encodeAbiParameters, type Hex } from 'viem'
import { getIntentExecutorModule } from './intent-executor'
import { normalizeModules } from './normalize'
import type {
  ConfiguredModule,
  ModuleInstallationPlan,
  ModuleSetup,
  ResolvedModule,
} from './types'
import { resolveSmartSessionModule } from './validators/smart-sessions/module'

export type ModuleCallEncoder = (
  module: ResolvedModule,
  operation: ModuleInstallationPlan['operation'],
) => Hex

export function planModuleOperation(
  module: ResolvedModule,
  operation: ModuleInstallationPlan['operation'],
  encodeAccountCall: ModuleCallEncoder,
): ModuleInstallationPlan {
  return {
    module,
    operation,
    accountCallData: encodeAccountCall(module, operation),
  }
}

const SAFE_SESSION_COMPATIBILITY_FALLBACK_ADDRESS =
  '0x000000000052e9685932845660777DF43C2dC496' as const

export function planModuleSetup(input: {
  readonly accountKind: string
  readonly owner: ResolvedModule
  readonly configured: readonly ConfiguredModule[]
  readonly environment: 'production' | 'development'
  readonly sessions: {
    readonly enabled: boolean
    readonly module?: `0x${string}`
    readonly compatibilityFallback?: `0x${string}`
  }
}): ModuleSetup {
  const custom = normalizeModules(input.configured)
  const session = resolveSmartSessionModule({
    enabled: input.sessions.enabled,
    address: input.sessions.module,
    environment: input.environment,
  })
  const validators = [
    input.owner,
    ...(session ? [session] : []),
    ...custom.filter((module) => module.kind === 'validator'),
  ]
  const executors = [
    getIntentExecutorModule(input.environment),
    ...custom.filter((module) => module.kind === 'executor'),
  ]
  const fallbacks: ResolvedModule[] = []
  if (input.sessions.enabled && input.accountKind === 'safe') {
    fallbacks.push({
      kind: 'fallback',
      address:
        input.sessions.compatibilityFallback ??
        SAFE_SESSION_COMPATIBILITY_FALLBACK_ADDRESS,
      initData: encodeAbiParameters(
        [
          { name: 'selector', type: 'bytes4' },
          { name: 'flags', type: 'bytes1' },
          { name: 'data', type: 'bytes' },
        ],
        ['0x84b0196e', '0xfe', '0x'],
      ),
      deInitData: '0x',
      additionalContext: '0x',
    })
  }
  fallbacks.push(...custom.filter((module) => module.kind === 'fallback'))
  return {
    validators,
    executors,
    fallbacks,
    hooks: custom.filter((module) => module.kind === 'hook'),
  }
}
