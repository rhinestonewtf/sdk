import type { Address, Hex } from 'viem'

type ModuleType =
  | typeof MODULE_TYPE_ID_VALIDATOR
  | typeof MODULE_TYPE_ID_EXECUTOR
  | typeof MODULE_TYPE_ID_FALLBACK
  | typeof MODULE_TYPE_ID_HOOK

interface Module {
  address: Address
  initData: Hex
  deInitData: Hex
  additionalContext: Hex
  type: ModuleType
}

const MODULE_TYPE_ID_VALIDATOR = 1n
const MODULE_TYPE_ID_EXECUTOR = 2n
const MODULE_TYPE_ID_FALLBACK = 3n
const MODULE_TYPE_ID_HOOK = 4n

export {
  MODULE_TYPE_ID_VALIDATOR,
  MODULE_TYPE_ID_EXECUTOR,
  MODULE_TYPE_ID_FALLBACK,
  MODULE_TYPE_ID_HOOK,
}
export type { Module, ModuleType }
