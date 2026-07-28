import { type Address, encodeFunctionData } from 'viem'
import type { CalldataInput } from '../config/account'

export function addWebauthnCredential(
  validator: Address,
  pubKeyX: bigint,
  pubKeyY: bigint,
  requireUserVerification: boolean,
): CalldataInput {
  return {
    to: validator,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          inputs: [
            { name: 'pubKeyX', type: 'uint256' },
            { name: 'pubKeyY', type: 'uint256' },
            { name: 'requireUserVerification', type: 'bool' },
          ],
          name: 'addCredential',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ],
      functionName: 'addCredential',
      args: [pubKeyX, pubKeyY, requireUserVerification],
    }),
  }
}

export function removeWebauthnCredential(
  validator: Address,
  pubKeyX: bigint,
  pubKeyY: bigint,
): CalldataInput {
  return {
    to: validator,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          inputs: [
            { name: 'pubKeyX', type: 'uint256' },
            { name: 'pubKeyY', type: 'uint256' },
          ],
          name: 'removeCredential',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ],
      functionName: 'removeCredential',
      args: [pubKeyX, pubKeyY],
    }),
  }
}

export function changeWebauthnThreshold(
  validator: Address,
  newThreshold: number,
): CalldataInput {
  return {
    to: validator,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          inputs: [
            { internalType: 'uint256', name: '_threshold', type: 'uint256' },
          ],
          name: 'setThreshold',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ],
      functionName: 'setThreshold',
      args: [BigInt(newThreshold)],
    }),
  }
}
