import type { AccountRuntime } from '../accounts/adapter'
import type { AccountConstructionMaterial } from '../accounts/construction'
import { createAccountConstruction } from '../accounts/construction'
import { createAccountAdapter } from '../accounts/registry'
import type { EvmChainReference } from '../chains/types'
import type { ResolvedAccountConfig } from './resolved'

export function createStaticAccountRuntime(
  resolved: ResolvedAccountConfig,
  chain: EvmChainReference,
  deployed: boolean,
): AccountRuntime {
  const construction = createAccountConstruction({
    material: accountMaterial(resolved),
    chain,
    deployed,
  })
  const adapter = createAccountAdapter(construction)
  return {
    construction,
    adapter,
    identity: adapter.getIdentity(construction),
  }
}

export function accountMaterial(
  resolved: ResolvedAccountConfig,
): AccountConstructionMaterial {
  return {
    account: resolved.account,
    ...(resolved.owners ? { owner: resolved.owners } : {}),
    modules: resolved.modules,
    ...(resolved.initData ? { initData: resolved.initData } : {}),
    ...(resolved.eoa ? { eoa: resolved.eoa } : {}),
    sessions: {
      enabled: resolved.sessions.enabled,
      environment: resolved.sessions.environment,
      ...(resolved.sessions.module.source === 'explicit'
        ? { module: resolved.sessions.module.address }
        : {}),
      ...(resolved.sessions.compatibilityFallback.source === 'explicit'
        ? {
            compatibilityFallback:
              resolved.sessions.compatibilityFallback.address,
          }
        : {}),
    },
  }
}
