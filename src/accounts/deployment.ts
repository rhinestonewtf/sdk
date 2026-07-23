import type { Address, Hex } from 'viem'
import type {
  AccountDefinition,
  AccountDeploymentPlan,
  AccountInitData,
  AccountValueSelection,
} from './types'

export interface DeploymentMaterial {
  readonly address: Address
  readonly factory?: Address
  readonly factoryData?: Hex
}

export function selectedValue<Value, Profile extends string>(
  selection: AccountValueSelection<Value, Profile>,
  defaults: Readonly<Record<Profile, Value>>,
): Value {
  return selection.source === 'explicit'
    ? selection.value
    : defaults[selection.profile]
}

export function deploymentPlan(
  chain: AccountDeploymentPlan['chain'],
  material: DeploymentMaterial,
  deployed: boolean,
): AccountDeploymentPlan {
  return {
    chain,
    address: material.address,
    ...(material.factory ? { factory: material.factory } : {}),
    ...(material.factoryData ? { factoryData: material.factoryData } : {}),
    ...(material.factory && material.factoryData
      ? {
          initCode:
            `${material.factory}${material.factoryData.slice(2)}` as Hex,
        }
      : {}),
    deployed,
  }
}

export function initDataMaterial(
  initData: AccountInitData | undefined,
): DeploymentMaterial | undefined {
  if (!initData) return undefined
  return 'factory' in initData
    ? {
        address: initData.address,
        factory: initData.factory,
        factoryData: initData.factoryData,
      }
    : { address: initData.address }
}

export function accountKind(
  definition: AccountDefinition,
): AccountDefinition['kind'] {
  return definition.kind
}
