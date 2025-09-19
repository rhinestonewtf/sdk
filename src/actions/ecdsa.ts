import { type Address, encodeFunctionData } from 'viem'
import {
  getModuleInstallationCalls,
  getModuleUninstallationCalls,
} from '../accounts'
import {
  getOwnableValidator,
  OWNABLE_VALIDATOR_ADDRESS,
} from '../modules/validators/core'
import type { CalldataInput, LazyCallInput } from '../types'

/**
 * Enable ECDSA authentication
 * @param owners Owners to use for authentication
 * @param threshold Threshold for the owners
 * @returns Calls to enable ECDSA authentication
 */
function enable({
  owners,
  threshold = 1,
}: {
  owners: Address[]
  threshold?: number
}): LazyCallInput {
  const module = getOwnableValidator(threshold, owners)
  return {
    async resolve({ config }) {
      return getModuleInstallationCalls(config, module)
    },
  }
}

/**
 * Disable ECDSA authentication
 * @returns Calls to disable ECDSA authentication
 */
function disable(): LazyCallInput {
  const module = getOwnableValidator(1, [])
  return {
    async resolve({ config }) {
      return getModuleUninstallationCalls(config, module)
    },
  }
}

/**
 * Add an ECDSA owner
 * @param owner Owner address
 * @returns Call to add the owner
 */
function addOwner(owner: Address): CalldataInput {
  return {
    to: OWNABLE_VALIDATOR_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          inputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
          name: 'addOwner',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ],
      functionName: 'addOwner',
      args: [owner],
    }),
  }
}

/**
 * Remove an ECDSA owner
 * @param prevOwner Previous owner address
 * @param ownerToRemove Owner to remove
 * @returns Call to remove the owner
 */
function removeOwner(
  prevOwner: Address,
  ownerToRemove: Address,
): CalldataInput {
  return {
    to: OWNABLE_VALIDATOR_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          inputs: [
            { internalType: 'address', name: 'prevOwner', type: 'address' },
            { internalType: 'address', name: 'owner', type: 'address' },
          ],
          name: 'removeOwner',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ],
      functionName: 'removeOwner',
      args: [prevOwner, ownerToRemove],
    }),
  }
}

/**
 * Change an account's signer threshold (ECDSA)
 * @param newThreshold New threshold
 * @returns Call to change the threshold
 */
function changeThreshold(newThreshold: number): CalldataInput {
  return {
    to: OWNABLE_VALIDATOR_ADDRESS,
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

export { addOwner, removeOwner, changeThreshold, disable, enable }
