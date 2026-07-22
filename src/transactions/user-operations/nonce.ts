import { type Address, concat, toHex, zeroAddress } from 'viem'
import { entryPoint07Address } from 'viem/account-abstraction'
import type { AccountKind } from '../../accounts/types'
import type { EvmChainReference } from '../../chains/types'
import type { RpcReadPort } from '../../clients/rpc/port'

const getNonceAbi = [
  {
    type: 'function',
    name: 'getNonce',
    stateMutability: 'view',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ name: 'nonce', type: 'uint256' }],
  },
] as const

export function getUserOperationNonceKey(input: {
  readonly accountKind: AccountKind
  readonly validator: Address
  readonly defaultValidator?: Address
  readonly lane?: bigint
  readonly requested?: bigint
}): bigint {
  if (input.requested !== undefined) return input.requested
  switch (input.accountKind) {
    case 'safe':
      return BigInt(concat([input.validator, '0x00000000']))
    case 'kernel':
      return BigInt(concat(['0x0000', input.validator, '0x0000']))
    case 'nexus':
    case 'startale':
    case 'hca': {
      const validator =
        input.defaultValidator?.toLowerCase() === input.validator.toLowerCase()
          ? zeroAddress
          : input.validator
      const lane = (input.lane ?? 0n) % 16_777_215n
      return BigInt(concat([toHex(lane, { size: 3 }), '0x00', validator]))
    }
    case 'eoa':
      throw new Error('EOA accounts do not support UserOperations')
  }
}

export async function readUserOperationNonce(input: {
  readonly rpc: RpcReadPort
  readonly chain: EvmChainReference
  readonly sender: Address
  readonly key: bigint
}): Promise<bigint> {
  return input.rpc.readContract(
    { chain: input.chain },
    {
      address: entryPoint07Address,
      abi: getNonceAbi,
      functionName: 'getNonce',
      args: [input.sender, input.key],
    },
  )
}
