import type { Account } from 'viem'
import type { EvmChainReference } from '../chains/types'
import { planModuleSetup } from '../modules/plan'
import type { ConfiguredModule, ModuleSetup } from '../modules/types'
import { resolveValidator } from '../modules/validators/resolve'
import type { ResolvedValidatorDefinition } from '../modules/validators/types'
import type {
  AccountConstruction,
  AccountDefinition,
  AccountInitData,
} from './types'

export interface AccountConstructionMaterial {
  readonly account: AccountDefinition
  readonly owner?: ResolvedValidatorDefinition
  readonly modules: readonly ConfiguredModule[]
  readonly initData?: AccountInitData
  readonly eoa?: Account
  readonly sessions: {
    readonly enabled: boolean
    readonly environment: 'production' | 'development'
    readonly module?: `0x${string}`
    readonly compatibilityFallback?: `0x${string}`
  }
}

export function createAccountConstruction(input: {
  readonly material: AccountConstructionMaterial
  readonly chain: EvmChainReference
  readonly deployed: boolean
  readonly setup?: ModuleSetup
}): AccountConstruction {
  const ownerModule = input.material.owner
    ? resolveValidator(input.material.owner)
    : undefined
  if (!ownerModule && input.material.account.kind !== 'eoa') {
    throw new Error('Smart account owner is required')
  }
  const setup =
    input.setup ??
    (ownerModule
      ? planModuleSetup({
          accountKind: input.material.account.kind,
          owner: ownerModule,
          configured: input.material.modules,
          environment: input.material.sessions.environment,
          sessions: input.material.sessions,
        })
      : { validators: [], executors: [], hooks: [], fallbacks: [] })
  return {
    account: input.material.account,
    ...(input.material.owner ? { owner: input.material.owner } : {}),
    modules: input.material.modules,
    setup,
    sessions: {
      enabled: input.material.sessions.enabled,
      environment: input.material.sessions.environment,
    },
    ...(input.material.initData ? { initData: input.material.initData } : {}),
    ...(input.material.eoa ? { eoa: input.material.eoa } : {}),
    chain: input.chain,
    deployed: input.deployed,
  }
}
