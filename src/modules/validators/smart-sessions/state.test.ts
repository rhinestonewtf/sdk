import { base } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { accountA } from '../../../../test/consts'
import persistedClaims from '../../../../test/utils/persisted-claim-sessions.json'
import { toEvmChainReference } from '../../../chains/caip2'
import type { RpcReadPort } from '../../../clients/rpc/port'
import { getSmartSessionEmissaryAddress } from './module'
import {
  readSessionEnabled,
  readSessionNonce,
  readSessionNonceAndEnabled,
} from './state'
import type { Session } from './types'

const session = {
  ...persistedClaims.claimPolicies,
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
} as unknown as Session
const input = {
  chain: toEvmChainReference(base.id),
  account: accountA.address,
  session,
  lockTag: '0x000000000000000000000000' as const,
}

describe('session state reads preserve resolved artifact identity', () => {
  test.each(['production', 'development'] as const)(
    'ordinary reads use the stored permissionId (%s)',
    async (environment) => {
      const readContract = vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(7n)
      const rpc = { readContract } as unknown as RpcReadPort
      expect(await readSessionEnabled({ ...input, environment, rpc })).toBe(
        true,
      )
      expect(await readSessionNonce({ ...input, environment, rpc })).toBe(7n)
      expect(readContract).toHaveBeenNthCalledWith(
        1,
        { chain: input.chain },
        expect.objectContaining({
          address: getSmartSessionEmissaryAddress(environment),
          functionName: 'isPermissionEnabled',
          args: [input.account, session.permissionId],
        }),
      )
      expect(readContract).toHaveBeenNthCalledWith(
        2,
        { chain: input.chain },
        expect.objectContaining({
          functionName: 'getNonce',
          args: [input.account, input.lockTag],
        }),
      )
    },
  )

  test.each([false, true])(
    'coherent reads preserve enabled=%s including zero nonce',
    async (enabled) => {
      const multicall = vi
        .fn()
        .mockResolvedValue([{ result: 0n }, { result: enabled }])
      const readContract = vi.fn()
      const rpc = { multicall, readContract } as unknown as RpcReadPort
      expect(
        await readSessionNonceAndEnabled({
          ...input,
          environment: 'production',
          rpc,
        }),
      ).toEqual({ nonce: 0n, enabled })
      expect(multicall).toHaveBeenCalledTimes(1)
      const [scope, calls] = multicall.mock.calls[0]
      expect(scope).toEqual({ chain: input.chain })
      expect(
        calls.map((call: { functionName: string }) => call.functionName),
      ).toEqual(['getNonce', 'isPermissionEnabled'])
      expect(calls[1].args).toEqual([input.account, session.permissionId])
      expect(readContract).not.toHaveBeenCalled()
    },
  )

  test.each([
    { label: 'empty', results: [] },
    { label: 'missing enabled', results: [{ result: 1n }] },
    {
      label: 'nonce failure',
      results: [{ error: new Error('nonce failed') }, { result: false }],
    },
    {
      label: 'state failure',
      results: [{ result: 1n }, { error: new Error('state failed') }],
    },
  ])('partial multicall fails closed ($label)', async ({ results }) => {
    const multicall = vi.fn().mockResolvedValue(results)
    const readContract = vi.fn()
    await expect(
      readSessionNonceAndEnabled({
        ...input,
        environment: 'production',
        rpc: { multicall, readContract } as unknown as RpcReadPort,
      }),
    ).rejects.toThrow(/Could not read the session nonce and enabled state/)
    expect(readContract).not.toHaveBeenCalled()
  })
})
