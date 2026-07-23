import type { Address, Hex } from 'viem'
import { planV0ModuleSetup } from '../modules/legacy-core'
import type { AccountAdapter } from './adapter'
import { safeV0FactoryMaterial } from './adapters/safe'
import { createAccountAdapter } from './registry'
import type { AccountConstruction } from './types'

export type LegacyInitData =
  | LegacyFactoryInitData
  | { readonly address: Address }

export interface LegacyFactoryInitData {
  readonly address: Address
  readonly factory: Address
  readonly factoryData: Hex
  readonly intentExecutorInstalled: boolean
}

function currentPlan(
  construction: AccountConstruction,
  adapter: AccountAdapter = createAccountAdapter(construction),
) {
  return adapter.getDeploymentPlan(construction)
}

export function getRhinestoneInitData(
  construction: AccountConstruction,
): LegacyInitData {
  if (construction.account.kind === 'eoa' || construction.eoa) {
    throw new Error('Init code not available')
  }
  const plan = currentPlan(construction)
  if (!plan.factory || !plan.factoryData) {
    if (construction.initData && !('factory' in construction.initData)) {
      return { address: plan.address }
    }
    throw new Error('Init code not available')
  }
  return {
    address: plan.address,
    factory: plan.factory,
    factoryData: plan.factoryData,
    intentExecutorInstalled: true,
  }
}

export function getV0InitData(
  construction: AccountConstruction,
): LegacyFactoryInitData {
  if (construction.account.kind !== 'safe') {
    throw new Error(`Unsupported account type: ${construction.account.kind}`)
  }
  const address = currentPlan(construction).address
  const v0 = safeV0FactoryMaterial({
    ...construction,
    setup: planV0ModuleSetup(construction.setup),
  })
  return {
    address,
    factory: v0.factory,
    factoryData: v0.factoryData,
    intentExecutorInstalled: true,
  }
}
