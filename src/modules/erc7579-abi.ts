import type { ModuleKind } from './types'

export type ModuleTypeId = 1n | 2n | 3n | 4n

export function moduleTypeId(kind: ModuleKind): ModuleTypeId {
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
