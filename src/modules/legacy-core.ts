import { type Address, encodeAbiParameters, type Hex } from 'viem'
import type { ModuleKind, ModuleSetup, ResolvedModule } from './types'

// Legacy module-setup shapes preserved for the `experimental_getModuleSetup`
// compatibility surface (note the historical `ModeleSetup` spelling, which is
// part of the published type name).
const MODULE_TYPE_ID_VALIDATOR = 1n
const MODULE_TYPE_ID_EXECUTOR = 2n
const MODULE_TYPE_ID_FALLBACK = 3n
const MODULE_TYPE_ID_HOOK = 4n

export type ModuleTypeId =
  | typeof MODULE_TYPE_ID_VALIDATOR
  | typeof MODULE_TYPE_ID_EXECUTOR
  | typeof MODULE_TYPE_ID_FALLBACK
  | typeof MODULE_TYPE_ID_HOOK

export interface Module {
  address: Address
  initData: Hex
  deInitData: Hex
  additionalContext: Hex
  type: ModuleTypeId
}

export interface ModeleSetup {
  validators: Module[]
  executors: Module[]
  fallbacks: Module[]
  hooks: Module[]
}

const RHINESTONE_ATTESTER_ADDRESS =
  '0x000000333034E9f539ce08819E12c1b8Cb29084d' as const
const OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS =
  '0x6D0515e8E499468DCe9583626f0cA15b887f9d03' as const
const HOOK_ADDRESS = '0x0000000000f6Ed8Be424d673c63eeFF8b9267420' as const
const TARGET_MODULE_ADDRESS =
  '0x0000000000E5a37279A001301A837a91b5de1D5E' as const
const SAME_CHAIN_MODULE_ADDRESS =
  '0x000000000043ff16d5776c7F0f65Ec485C17Ca04' as const

const moduleType = (kind: ModuleKind): 1n | 2n | 3n | 4n => {
  switch (kind) {
    case 'validator':
      return 1n
    case 'executor':
      return 2n
    case 'fallback':
      return 3n
    case 'hook':
      return 4n
  }
}

export function toLegacyModule(module: ResolvedModule): Module {
  return { ...module, type: moduleType(module.kind) }
}

export function toLegacyModuleSetup(setup: ModuleSetup): ModeleSetup {
  return {
    validators: setup.validators.map(toLegacyModule),
    executors: setup.executors.map(toLegacyModule),
    fallbacks: setup.fallbacks.map(toLegacyModule),
    hooks: setup.hooks.map(toLegacyModule),
  }
}

export function getV0Attesters(): {
  readonly addresses: readonly `0x${string}`[]
  readonly threshold: number
} {
  return {
    addresses: [
      RHINESTONE_ATTESTER_ADDRESS,
      OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS,
    ],
    threshold: 1,
  }
}

function v0Module(
  kind: Exclude<ModuleKind, 'validator' | 'hook'>,
  address: `0x${string}`,
  initData: `0x${string}` = '0x',
): ResolvedModule {
  return {
    kind,
    address,
    initData,
    deInitData: '0x',
    additionalContext: '0x',
  }
}

export function planV0ModuleSetup(setup: ModuleSetup): ModuleSetup {
  return {
    validators: setup.validators,
    executors: [
      v0Module('executor', SAME_CHAIN_MODULE_ADDRESS),
      v0Module('executor', TARGET_MODULE_ADDRESS),
      v0Module('executor', HOOK_ADDRESS),
      ...setup.executors,
    ],
    fallbacks: [
      v0Module(
        'fallback',
        TARGET_MODULE_ADDRESS,
        encodeAbiParameters(
          [
            { name: 'selector', type: 'bytes4' },
            { name: 'flags', type: 'bytes1' },
            { name: 'data', type: 'bytes' },
          ],
          ['0x3a5be8cb', '0x00', '0x'],
        ),
      ),
      ...setup.fallbacks,
    ],
    hooks: setup.hooks,
  }
}
