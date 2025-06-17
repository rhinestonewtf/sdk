import {
  Address,
  Chain,
  createPublicClient,
  encodeFunctionData,
  http,
} from 'viem'
import { RhinestoneAccount } from '..'
import { getModuleInstallationCalls } from '../accounts'
import {
  getSocialRecoveryValidator,
  OWNABLE_VALIDATOR_ADDRESS,
} from '../modules/validators/core'
import { Call, OwnableValidatorConfig, OwnerSet, Recovery } from '../types'

function setUpRecovery({
  rhinestoneAccount,
  guardians,
  threshold = 1,
}: {
  rhinestoneAccount: RhinestoneAccount
} & Recovery) {
  const module = getSocialRecoveryValidator(guardians, threshold)
  const calls = getModuleInstallationCalls(rhinestoneAccount.config, module)
  return calls
}

async function recover(
  address: Address,
  newOwners: OwnerSet,
  chain: Chain,
): Promise<Call[]> {
  switch (newOwners.type) {
    case 'ecdsa': {
      return recoverEcdsaOwnership(address, newOwners, chain)
    }
    case 'passkey': {
      throw new Error('Passkey ownership recovery is not yet supported')
    }
  }
}

function addOwner(owner: Address): Call {
  return {
    to: OWNABLE_VALIDATOR_ADDRESS,
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

function removeOwner(prevOwner: Address, ownerToRemove: Address): Call {
  return {
    to: OWNABLE_VALIDATOR_ADDRESS,
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

function setThreshold(newThreshold: bigint): Call {
  return {
    to: OWNABLE_VALIDATOR_ADDRESS,
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
      args: [newThreshold],
    }),
  }
}

async function recoverEcdsaOwnership(
  address: Address,
  newOwners: OwnableValidatorConfig,
  chain: Chain,
): Promise<Call[]> {
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })

  // Read the existing config
  const [existingOwners, existingThreshold] = await Promise.all([
    publicClient.readContract({
      address: OWNABLE_VALIDATOR_ADDRESS,
      abi: [
        {
          inputs: [
            { internalType: 'address', name: 'account', type: 'address' },
          ],
          name: 'getOwners',
          outputs: [
            {
              internalType: 'address[]',
              name: 'ownersArray',
              type: 'address[]',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
      ],
      functionName: 'getOwners',
      args: [address],
    }) as Promise<Address[]>,
    publicClient.readContract({
      address: OWNABLE_VALIDATOR_ADDRESS,
      abi: [
        {
          inputs: [
            { internalType: 'address', name: 'account', type: 'address' },
          ],
          name: 'threshold',
          outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
          stateMutability: 'view',
          type: 'function',
        },
      ],
      functionName: 'threshold',
      args: [address],
    }) as Promise<bigint>,
  ])
  const normalizedExistingOwners = existingOwners.map(
    (owner) => owner.toLowerCase() as Address,
  )

  const calls: Call[] = []

  // Convert new owners config to addresses and threshold
  const newOwnerAddresses = newOwners.accounts
    .map((account) => account.address.toLowerCase() as Address)
    .sort()
  const newThreshold = BigInt(newOwners.threshold ?? 1)

  // Check if threshold needs to be updated
  if (existingThreshold !== newThreshold) {
    calls.push(setThreshold(newThreshold))
  }

  const ownersToAdd = newOwnerAddresses.filter(
    (owner) => !normalizedExistingOwners.includes(owner),
  )
  const ownersToRemove = normalizedExistingOwners.filter(
    (owner) => !newOwnerAddresses.includes(owner),
  )

  // Maintain the list as making changes to keep track of the previous owner for removals
  // Note: new owners are added to the START of the linked list
  let currentOwners = [...normalizedExistingOwners]
  for (const owner of ownersToAdd) {
    calls.push(addOwner(owner))
    currentOwners.unshift(owner)
  }

  for (const ownerToRemove of ownersToRemove) {
    const ownerIndex = currentOwners.indexOf(ownerToRemove)
    let prevOwner: Address
    if (ownerIndex === 0) {
      // If it's the first owner, use the sentinel address
      prevOwner = '0x0000000000000000000000000000000000000001'
    } else {
      prevOwner = currentOwners[ownerIndex - 1]
    }
    calls.push(removeOwner(prevOwner, ownerToRemove))
    currentOwners = currentOwners.filter((owner) => owner !== ownerToRemove)
  }

  return calls
}

export { addOwner, removeOwner, setThreshold, recover, setUpRecovery }
