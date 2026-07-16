import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  type Hex,
  toBytes,
  toHex,
} from 'viem'
import type { AccountCallEncodingInput } from './types'

function executionMode(mode: AccountCallEncodingInput['mode']): Hex {
  return encodePacked(
    ['bytes1', 'bytes1', 'bytes4', 'bytes4', 'bytes22'],
    [
      toHex(toBytes(mode === 'batch' ? '0x01' : '0x00', { size: 1 })),
      '0x00',
      '0x00000000',
      '0x00000000',
      `0x${'00'.repeat(22)}`,
    ],
  )
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

export function encodeErc7579Calls(input: AccountCallEncodingInput): Hex {
  if (input.calls.length === 0) throw new Error('No calls to encode')
  if (input.calls.length > 1 && input.mode !== 'batch') {
    throw new Error('Single execution mode cannot encode multiple calls')
  }
  const calldata =
    input.mode === 'batch'
      ? encodeAbiParameters(
          [
            {
              name: 'executionBatch',
              type: 'tuple[]',
              components: [
                { name: 'target', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'callData', type: 'bytes' },
              ],
            },
          ],
          [
            input.calls.map((call) => ({
              target: call.target,
              value: call.value,
              callData: call.data,
            })),
          ],
        )
      : concatHex([
          input.calls[0].target,
          toHex(input.calls[0].value, { size: 32 }),
          input.calls[0].data,
        ])
  return encodeFunctionData({
    abi: executeAbi,
    functionName: 'execute',
    args: [executionMode(input.mode), calldata],
  })
}
