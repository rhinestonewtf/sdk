import { decodeAbiParameters, decodeFunctionData, size, slice } from 'viem'
import { describe, expect, test } from 'vitest'

import {
  buildOneTimeUseBurnOp,
  encodeOneTimeUseIdInitData,
  oneTimeUseIdErc1271Policy,
  oneTimeUseIdPolicyAbi,
} from './one-time-use'

const POLICY = '0x00000000000000000000000000000000000000aa' as const

// source: OneTimeUseIdPolicy.initializeWithMultiplexer (smart-sessions-v2#56 @ 493fd86):
// `initData.length != 64` reverts InvalidInitDataLength; id = initData[0:32],
// deadline = initData[32:64], and a zero deadline never expires. A 32-byte
// encoding reverts at session enable (reproduced on a mainnet fork, RHI-5798).
const decodeInit = (hex: `0x${string}`) =>
  decodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], hex)

describe('encodeOneTimeUseIdInitData', () => {
  test('is exactly 64 bytes: id then deadline', () => {
    const initData = encodeOneTimeUseIdInitData(42n, 1_900_000_000n)
    expect(size(initData)).toBe(64)
    expect(decodeInit(initData)).toEqual([42n, 1_900_000_000n])
  })
  test('defaults the deadline to zero (never expires)', () => {
    expect(decodeInit(encodeOneTimeUseIdInitData(42n))).toEqual([42n, 0n])
  })
  test('appends the raw 20-byte wrapped-native address when given', () => {
    const weth = '0x4200000000000000000000000000000000000006' as const
    const initData = encodeOneTimeUseIdInitData(42n, 0n, weth)
    expect(size(initData)).toBe(84)
    expect(decodeInit(slice(initData, 0, 64))).toEqual([42n, 0n])
    expect(slice(initData, 64)).toBe(weth)
  })
  test('rejects a zero id (policy treats 0 as "not configured")', () => {
    expect(() => encodeOneTimeUseIdInitData(0n)).toThrow()
  })
})

describe('oneTimeUseIdErc1271Policy', () => {
  test('produces a {policy, initData} entry pinning the id and deadline', () => {
    const entry = oneTimeUseIdErc1271Policy({
      policy: POLICY,
      id: 7n,
      deadline: 99n,
    })
    expect(entry.policy).toBe(POLICY)
    expect(decodeInit(entry.initData)).toEqual([7n, 99n])
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
