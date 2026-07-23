import { describe, expect, test } from 'vitest'
import {
  accountKind,
  deploymentPlan,
  initDataMaterial,
  selectedValue,
} from './deployment'

const chain = { kind: 'evm', id: 1, caip2: 'eip155:1' } as const
const address = '0x0000000000000000000000000000000000000001' as const
const factory = '0x0000000000000000000000000000000000000002' as const

describe('account deployment primitives', () => {
  test('selects explicit and profiled default values', () => {
    expect(selectedValue({ source: 'explicit', value: 2 }, { base: 1 })).toBe(2)
    expect(
      selectedValue({ source: 'default', profile: 'base' }, { base: 1 }),
    ).toBe(1)
  })

  test('materializes complete and address-only plans', () => {
    expect(
      deploymentPlan(chain, { address, factory, factoryData: '0x1234' }, false),
    ).toEqual({
      chain,
      address,
      factory,
      factoryData: '0x1234',
      initCode: `${factory}1234`,
      deployed: false,
    })
    expect(deploymentPlan(chain, { address }, true)).toEqual({
      chain,
      address,
      deployed: true,
    })
  })

  test('projects every init-data form and account kind', () => {
    expect(initDataMaterial(undefined)).toBeUndefined()
    expect(initDataMaterial({ address })).toEqual({ address })
    expect(
      initDataMaterial({
        address,
        factory,
        factoryData: '0x1234',
        intentExecutorInstalled: true,
      }),
    ).toEqual({ address, factory, factoryData: '0x1234' })
    expect(accountKind({ kind: 'eoa' })).toBe('eoa')
  })
})
