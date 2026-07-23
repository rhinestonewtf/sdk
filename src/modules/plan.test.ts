import { describe, expect, test } from 'vitest'
import { planModuleOperation, planModuleSetup } from './plan'
import type { ConfiguredModule, ResolvedModule } from './types'

const owner: ResolvedModule = {
  kind: 'validator',
  address: '0x0000000000000000000000000000000000000001',
  initData: '0x01',
  deInitData: '0x',
  additionalContext: '0x',
}

const custom: ConfiguredModule = {
  kind: 'validator',
  address: '0x0000000000000000000000000000000000000002',
  initData: { source: 'omitted' },
  deInitData: { source: 'omitted' },
  additionalContext: { source: 'omitted' },
}

describe('module setup planning', () => {
  test('preserves default and configured module order', () => {
    const setup = planModuleSetup({
      accountKind: 'nexus',
      owner,
      configured: [custom, custom],
      environment: 'production',
      sessions: { enabled: true },
    })
    expect(setup.validators.map(({ address }) => address)).toEqual([
      owner.address,
      '0xad568b3f825a8d5ffc06dd3253526b64d810ae89',
      custom.address,
      custom.address,
    ])
    expect(setup.executors).toEqual([
      {
        kind: 'executor',
        address: '0x00000000005aD9ce1f5035FD62CA96CEf16AdAAF',
        initData: '0x',
        deInitData: '0x',
        additionalContext: '0x',
      },
    ])
  })

  test('adds the exact Safe session compatibility fallback', () => {
    const setup = planModuleSetup({
      accountKind: 'safe',
      owner,
      configured: [],
      environment: 'development',
      sessions: { enabled: true },
    })
    expect(setup.fallbacks).toEqual([
      {
        kind: 'fallback',
        address: '0x000000000052e9685932845660777DF43C2dC496',
        initData:
          '0x84b0196e00000000000000000000000000000000000000000000000000000000fe0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000',
        deInitData: '0x',
        additionalContext: '0x',
      },
    ])
  })

  test('uses custom fallbacks and groups every configured module kind', () => {
    const configured = (['executor', 'fallback', 'hook'] as const).map(
      (kind, index): ConfiguredModule => ({
        ...custom,
        kind,
        address: `0x${String(index + 3).padStart(40, '0')}` as `0x${string}`,
      }),
    )
    const setup = planModuleSetup({
      accountKind: 'safe',
      owner,
      configured,
      environment: 'production',
      sessions: {
        enabled: true,
        module: '0x0000000000000000000000000000000000000010',
        compatibilityFallback: '0x0000000000000000000000000000000000000011',
      },
    })
    expect(setup.validators[1]?.address).toBe(
      '0x0000000000000000000000000000000000000010',
    )
    expect(setup.executors.at(-1)?.kind).toBe('executor')
    expect(setup.fallbacks.map(({ address }) => address)).toEqual([
      '0x0000000000000000000000000000000000000011',
      configured[1].address,
    ])
    expect(setup.hooks).toHaveLength(1)
  })

  test('omits session modules when disabled and plans account calldata', () => {
    const setup = planModuleSetup({
      accountKind: 'nexus',
      owner,
      configured: [],
      environment: 'production',
      sessions: { enabled: false },
    })
    expect(setup.validators).toEqual([owner])
    expect(setup.fallbacks).toEqual([])
    expect(planModuleOperation(owner, 'uninstall', () => '0x1234')).toEqual({
      module: owner,
      operation: 'uninstall',
      accountCallData: '0x1234',
    })
  })

  test.each([
    ['validator', 1n],
    ['executor', 2n],
    ['fallback', 3n],
    ['hook', 4n],
  ] as const)('maps %s to ERC-7579 type %s', async (kind, expected) => {
    const { moduleTypeId } = await import('./erc7579-abi')
    expect(moduleTypeId(kind)).toBe(expected)
  })
})
