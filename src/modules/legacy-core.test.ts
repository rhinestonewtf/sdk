import { describe, expect, test } from 'vitest'
import { toLegacyModule, toLegacyModuleSetup } from './legacy-core'
import type { ModuleKind, ResolvedModule } from './types'

const module = (kind: ModuleKind): ResolvedModule => ({
  kind,
  address: '0x0000000000000000000000000000000000000099',
  initData: '0x1234',
  deInitData: '0x5678',
  additionalContext: '0x',
})

describe('legacy module setup', () => {
  test('maps every module kind to its ERC-7579 type id', () => {
    expect(
      (['validator', 'executor', 'fallback', 'hook'] as const).map(
        (kind) => toLegacyModule(module(kind)).type,
      ),
    ).toEqual([1n, 2n, 3n, 4n])
  })

  test('preserves module data across the legacy setup shape', () => {
    const setup = toLegacyModuleSetup({
      validators: [module('validator')],
      executors: [module('executor')],
      fallbacks: [module('fallback')],
      hooks: [module('hook')],
    })
    expect(setup.validators[0]).toEqual({
      address: module('validator').address,
      initData: '0x1234',
      deInitData: '0x5678',
      additionalContext: '0x',
      type: 1n,
    })
    expect([
      setup.executors[0].type,
      setup.fallbacks[0].type,
      setup.hooks[0].type,
    ]).toEqual([2n, 3n, 4n])
  })
})
