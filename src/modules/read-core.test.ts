import type { Address } from 'viem'
import { describe, expect, test } from 'vitest'
import type { RpcReadPort } from '../clients/rpc/port'
import type { ContractRead, RpcReadContext } from '../clients/rpc/types'
import {
  encodeAccountModuleDeInitData,
  readInstalledModules,
  readValidatorInitialized,
} from './read-core'

const chain = { kind: 'evm', id: 1, caip2: 'eip155:1' } as const
const account = '0x0000000000000000000000000000000000000001'
const validator = '0x0000000000000000000000000000000000000002'

function fakeReader(results: readonly unknown[]) {
  const reads: ContractRead[] = []
  let index = 0
  const rpc: RpcReadPort = {
    getCode: async () => ({ code: '0x' }),
    readContract: async <TResult>(
      _context: RpcReadContext,
      request: ContractRead<TResult>,
    ) => {
      reads.push(request)
      return results[index++] as TResult
    },
    multicall: async () => [] as never,
  }
  return { rpc, reads }
}

describe('module reads', () => {
  test('reads paginated validator state through the narrow port', async () => {
    const fake = fakeReader([[[validator], account]])
    await expect(
      readInstalledModules({
        rpc: fake.rpc,
        chain,
        accountKind: 'nexus',
        account,
        kind: 'validator',
      }),
    ).resolves.toEqual([validator])
    expect(fake.reads[0]).toMatchObject({
      address: account,
      functionName: 'getValidatorsPaginated',
      args: ['0x0000000000000000000000000000000000000001', 100n],
    })
  })

  test('does not coerce validator read failures or false values', async () => {
    const fake = fakeReader([false])
    await expect(
      readValidatorInitialized({
        rpc: fake.rpc,
        chain,
        account,
        validator,
      }),
    ).resolves.toBe(false)
  })

  test('encodes SentinelList predecessors only for compatible accounts', () => {
    const module = {
      kind: 'validator',
      address: validator,
      initData: '0x' as const,
      deInitData: '0x1234' as const,
      additionalContext: '0x' as const,
    }
    const previous = '0x0000000000000000000000000000000000000003' as Address
    expect(
      encodeAccountModuleDeInitData({
        accountKind: 'safe',
        module,
        installed: [previous, validator],
      }),
    ).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000021234000000000000000000000000000000000000000000000000000000000000',
    )
    expect(
      encodeAccountModuleDeInitData({
        accountKind: 'kernel',
        module,
        installed: [validator],
      }),
    ).toBe('0x1234')
  })
})
