import { decodeFunctionData } from 'viem'
import { describe, expect, test } from 'vitest'
import { encodeErc7579Calls } from './erc7579-calls'

const chain = { kind: 'evm', id: 1, caip2: 'eip155:1' } as const
const first = {
  target: '0x0000000000000000000000000000000000000001' as const,
  value: 2n,
  data: '0x1234' as const,
}
const second = {
  target: '0x0000000000000000000000000000000000000002' as const,
  value: 0n,
  data: '0x' as const,
}
const executeAbi = [
  {
    type: 'function',
    name: 'execute',
    inputs: [
      { name: 'execMode', type: 'bytes32' },
      { name: 'executionCalldata', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const

describe('ERC-7579 call encoding', () => {
  test('encodes single and batch modes with stable mode bytes', () => {
    const single = decodeFunctionData({
      abi: executeAbi,
      data: encodeErc7579Calls({ chain, calls: [first], mode: 'single' }),
    })
    const batch = decodeFunctionData({
      abi: executeAbi,
      data: encodeErc7579Calls({
        chain,
        calls: [first, second],
        mode: 'batch',
      }),
    })
    expect(single.args[0].slice(0, 4)).toBe('0x00')
    expect(single.args[1]).toBe(
      `${first.target}${first.value.toString(16).padStart(64, '0')}${first.data.slice(2)}`,
    )
    expect(batch.args[0].slice(0, 4)).toBe('0x01')
  })

  test('rejects empty and multi-call single mode inputs', () => {
    expect(() =>
      encodeErc7579Calls({ chain, calls: [], mode: 'single' }),
    ).toThrow('No calls to encode')
    expect(() =>
      encodeErc7579Calls({ chain, calls: [first, second], mode: 'single' }),
    ).toThrow('Single execution mode cannot encode multiple calls')
  })
})
