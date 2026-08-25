import { decodeFunctionData, pad, toHex } from 'viem'
import { describe, expect, test } from 'vitest'

import {
  buildOneTimeUseBurnOp,
  encodeOneTimeUseIdInitData,
  oneTimeUseIdErc1271Policy,
  oneTimeUseIdPolicyAbi,
} from './one-time-use'

const POLICY = '0x00000000000000000000000000000000000000aa' as const

describe('encodeOneTimeUseIdInitData', () => {
  test('encodes the id as a bytes32', () => {
    expect(encodeOneTimeUseIdInitData(42n)).toBe(pad(toHex(42n), { size: 32 }))
  })
  test('rejects a zero id (policy treats 0 as "not configured")', () => {
    expect(() => encodeOneTimeUseIdInitData(0n)).toThrow()
  })
})

describe('oneTimeUseIdErc1271Policy', () => {
  test('produces a {policy, initData} entry pinning the id', () => {
    expect(oneTimeUseIdErc1271Policy({ policy: POLICY, id: 7n })).toEqual({
      policy: POLICY,
      initData: pad(toHex(7n), { size: 32 }),
    })
  })
})

describe('buildOneTimeUseBurnOp', () => {
  test('executor route → consume(id), no witness', () => {
    const op = buildOneTimeUseBurnOp({
      policy: POLICY,
      id: 42n,
      route: 'executor',
    })
    expect(op.to).toBe(POLICY)
    expect(op.value).toBe(0n)
    const { functionName, args } = decodeFunctionData({
      abi: oneTimeUseIdPolicyAbi,
      data: op.data,
    })
    expect(functionName).toBe('consume')
    expect(args).toEqual([42n])
  })

  test('permit2 route → consumeFor(id, 0) placeholder for the orchestrator to stamp', () => {
    const op = buildOneTimeUseBurnOp({
      policy: POLICY,
      id: 42n,
      route: 'permit2',
    })
    const { functionName, args } = decodeFunctionData({
      abi: oneTimeUseIdPolicyAbi,
      data: op.data,
    })
    expect(functionName).toBe('consumeFor')
    // Placeholder witness 0 — the real Permit2 order nonce is stamped in by the
    // orchestrator before the mandate is signed.
    expect(args).toEqual([42n, 0n])
  })

  test('rejects id=0 (cannot emit a burn op for an unpinnable id)', () => {
    expect(() =>
      buildOneTimeUseBurnOp({ policy: POLICY, id: 0n, route: 'executor' }),
    ).toThrow(/non-zero uint256/)
    expect(() =>
      buildOneTimeUseBurnOp({ policy: POLICY, id: 0n, route: 'permit2' }),
    ).toThrow(/non-zero uint256/)
  })
})
