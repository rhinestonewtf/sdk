import type { Address, Hex } from 'viem'

type ModuleTypeId =
  | typeof MODULE_TYPE_ID_VALIDATOR
  | typeof MODULE_TYPE_ID_EXECUTOR
  | typeof MODULE_TYPE_ID_FALLBACK
  | typeof MODULE_TYPE_ID_HOOK

type ModuleType =
  | typeof MODULE_TYPE_VALIDATOR
  | typeof MODULE_TYPE_EXECUTOR
  | typeof MODULE_TYPE_FALLBACK
  | typeof MODULE_TYPE_HOOK

interface Module {
  address: Address
  initData: Hex
  deInitData: Hex
  additionalContext: Hex
  type: ModuleTypeId
}

const MODULE_TYPE_ID_VALIDATOR = 1n
const MODULE_TYPE_ID_EXECUTOR = 2n
const MODULE_TYPE_ID_FALLBACK = 3n
const MODULE_TYPE_ID_HOOK = 4n

const MODULE_TYPE_VALIDATOR = 'validator'
const MODULE_TYPE_EXECUTOR = 'executor'
const MODULE_TYPE_FALLBACK = 'fallback'
const MODULE_TYPE_HOOK = 'hook'

function toModuleTypeId(type: ModuleType): ModuleTypeId {
  switch (type) {
    case MODULE_TYPE_VALIDATOR:
      return MODULE_TYPE_ID_VALIDATOR
    case MODULE_TYPE_EXECUTOR:
      return MODULE_TYPE_ID_EXECUTOR
    case MODULE_TYPE_FALLBACK:
      return MODULE_TYPE_ID_FALLBACK
    case MODULE_TYPE_HOOK:
      return MODULE_TYPE_ID_HOOK
  }
}

export {
  MODULE_TYPE_ID_VALIDATOR,
  MODULE_TYPE_ID_EXECUTOR,
  MODULE_TYPE_ID_FALLBACK,
  MODULE_TYPE_ID_HOOK,
  MODULE_TYPE_VALIDATOR,
  MODULE_TYPE_EXECUTOR,
  MODULE_TYPE_FALLBACK,
  MODULE_TYPE_HOOK,
  toModuleTypeId,
}
export type { Module, ModuleType, ModuleTypeId }
