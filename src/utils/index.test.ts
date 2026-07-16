import { keccak256 } from 'viem'
import { describe, expect, test } from 'vitest'

import { accountA } from '../../test/consts'
import {
  experimental_getModuleSetup,
  experimental_getRhinestoneInitData,
  experimental_getV0InitData,
  toViewOnlyAccount,
} from './index'

describe('Utils', () => {
  test('experimental_getV0InitData accepts session-enabled safe config', () => {
    const baseConfig = {
      account: {
        type: 'safe' as const,
      },
      owners: {
        type: 'ecdsa' as const,
        accounts: [accountA],
      },
    }

    const withoutSessions = experimental_getV0InitData(baseConfig)
    const withSessions = experimental_getV0InitData({
      ...baseConfig,
      experimental_sessions: {
        enabled: true,
      },
    })

    expect(withSessions.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(withSessions.factoryData).not.toEqual(withoutSessions.factoryData)
  })

  test('experimental_getRhinestoneInitData accepts session-enabled safe config', () => {
    const initData = experimental_getRhinestoneInitData({
      account: {
        type: 'safe',
      },
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
      experimental_sessions: {
        enabled: true,
      },
    })

    expect('factory' in initData).toBe(true)
    if (!('factory' in initData)) throw new Error('Expected factory init data')
    expect(initData.address).toBe('0xe2F9e65cff1e5EBc5dFe7650872ad36619875650')
    expect(keccak256(initData.factoryData)).toBe(
      '0x992af00b8e5aee13d34cca3ac7248973d12daa7c7a1e41032c241e912fbd612f',
    )
  })

  test('preserves v0 factory data with the current account address', () => {
    const initData = experimental_getV0InitData({
      account: { type: 'safe' },
      owners: { type: 'ecdsa', accounts: [accountA] },
      experimental_sessions: { enabled: true },
    })

    expect(initData.address).toBe('0xe2F9e65cff1e5EBc5dFe7650872ad36619875650')
    expect(keccak256(initData.factoryData)).toBe(
      '0x050f3e643db4bbef56cb4de48dd635e150be03bdde3392308b63fceafde36c83',
    )
  })

  test('projects canonical module setup to the published legacy shape', () => {
    const setup = experimental_getModuleSetup({
      account: { type: 'safe' },
      owners: { type: 'ecdsa', accounts: [accountA] },
      experimental_sessions: { enabled: true },
    })

    expect(
      setup.validators.map(({ address, type }) => ({ address, type })),
    ).toEqual([
      {
        address: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
        type: 1n,
      },
      {
        address: '0xad568b3f825a8d5ffc06dd3253526b64d810ae89',
        type: 1n,
      },
    ])
    expect(setup.executors[0]).toMatchObject({
      address: '0x00000000005aD9ce1f5035FD62CA96CEf16AdAAF',
      type: 2n,
    })
    expect(setup.fallbacks[0]).toMatchObject({
      address: '0x000000000052e9685932845660777DF43C2dC496',
      type: 3n,
    })
  })

  test('view-only accounts retain their address and reject every signer method', async () => {
    const account = toViewOnlyAccount(accountA.address)
    expect(account.address).toBe(accountA.address)
    await expect(account.signMessage({ message: 'test' })).rejects.toThrow(
      'Signing is not supported for view-only accounts',
    )
    await expect(
      account.signTypedData({
        domain: {},
        types: { Test: [{ name: 'value', type: 'uint256' }] },
        primaryType: 'Test',
        message: { value: 1n },
      }),
    ).rejects.toThrow('Signing is not supported for view-only accounts')
    await expect(
      account.signTransaction({ to: accountA.address }),
    ).rejects.toThrow('Signing is not supported for view-only accounts')
  })
})
