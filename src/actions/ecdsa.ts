import { type Address, encodeFunctionData } from 'viem'
import type { RhinestoneAccount } from '..'
import {
  getModuleInstallationCalls,
  getModuleUninstallationCalls,
} from '../accounts'
import {
  getOwnableValidator,
  OWNABLE_VALIDATOR_ADDRESS,
} from '../modules/validators/core'
import type { Call } from '../types'

/**
 * Enable ECDSA authentication
 * @param rhinestoneAccount Account to enable ECDSA authentication on
 * @param owners Owners to use for authentication
 * @param threshold Threshold for the owners
 * @returns Calls to enable ECDSA authentication
 */
function enable({
  rhinestoneAccount,
  owners,
  threshold = 1,
}: {
  rhinestoneAccount: RhinestoneAccount
  owners: Address[]
  threshold?: number
}) {
  const module = getOwnableValidator(threshold, owners)
  const calls = getModuleInstallationCalls(rhinestoneAccount.config, module)
  return calls
}

/**
 * Disable ECDSA authentication
 * @param rhinestoneAccount Account to disable ECDSA authentication on
 * @returns Calls to disable ECDSA authentication
 */
function disable({
  rhinestoneAccount,
}: {
  rhinestoneAccount: RhinestoneAccount
}) {
  const module = getOwnableValidator(1, [])
  const calls = getModuleUninstallationCalls(rhinestoneAccount.config, module)
  return calls
}

/**
 * Add an ECDSA owner
 * @param owner Owner address
 * @returns Call to add the owner
 */
function addOwner(owner: Address): Call {
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
function removeOwner(prevOwner: Address, ownerToRemove: Address): Call {
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
function changeThreshold(newThreshold: number): Call {
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
