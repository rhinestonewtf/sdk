import {
  Account,
  Address,
  Chain,
  createPublicClient,
  encodeFunctionData,
  http,
} from 'viem'
import { getAddress, getModuleInstallationCalls } from '../accounts'
import { getSocialRecoveryValidator } from '../modules/validators/core'
import {
  Call,
  OwnableValidatorConfig,
  OwnerSet,
  RhinestoneAccountConfig,
} from '../types'

const OWNABLE_VALIDATOR_ADDRESS: Address =
  '0x2483DA3A338895199E5e538530213157e931Bf06'

const OWNABLE_VALIDATOR_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'getOwners',
    outputs: [
      { internalType: 'address[]', name: 'ownersArray', type: 'address[]' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'threshold',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '_threshold', type: 'uint256' }],
    name: 'setThreshold',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
    name: 'addOwner',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
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
] as const

// TODO convert to a lazyly executed function and remove the need for the config
function setUpRecovery({
  config,
  accounts,
  threshold = 1,
}: {
  config: RhinestoneAccountConfig
  accounts: Account[]
  threshold?: number
}) {
  const module = getSocialRecoveryValidator(accounts, threshold)
  const calls = getModuleInstallationCalls(config, module)
  return calls
}

async function recover(
  config: RhinestoneAccountConfig,
  newOwners: OwnerSet,
  chain: Chain,
): Promise<Call[]> {
  const address = getAddress(config)
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
      abi: OWNABLE_VALIDATOR_ABI,
      functionName: 'addOwner',
      args: [owner],
    }),
  }
}

function removeOwner(prevOwner: Address, ownerToRemove: Address): Call {
  return {
    to: OWNABLE_VALIDATOR_ADDRESS,
    data: encodeFunctionData({
      abi: OWNABLE_VALIDATOR_ABI,
      functionName: 'removeOwner',
      args: [prevOwner, ownerToRemove],
    }),
  }
}

function setThreshold(newThreshold: bigint): Call {
  return {
    to: OWNABLE_VALIDATOR_ADDRESS,
    data: encodeFunctionData({
      abi: OWNABLE_VALIDATOR_ABI,
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
  // Create a public client to read the existing config
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })

  // Read the existing owners and threshold from the ownable validator
  const [existingOwners, existingThreshold] = await Promise.all([
    publicClient.readContract({
      address: OWNABLE_VALIDATOR_ADDRESS,
      abi: OWNABLE_VALIDATOR_ABI,
      functionName: 'getOwners',
      args: [address],
    }) as Promise<Address[]>,
    publicClient.readContract({
      address: OWNABLE_VALIDATOR_ADDRESS,
      abi: OWNABLE_VALIDATOR_ABI,
      functionName: 'threshold',
      args: [address],
    }) as Promise<bigint>,
  ])

  const calls: Call[] = []

  // Convert new owners config to addresses and threshold
  const newOwnerAddresses = newOwners.accounts
    .map((account) => account.address.toLowerCase() as Address)
    .sort()
  const newThreshold = BigInt(newOwners.threshold ?? 1)

  // Normalize existing owners to lowercase for comparison
  const normalizedExistingOwners = existingOwners.map(
    (owner) => owner.toLowerCase() as Address,
  )

  // Check if threshold needs to be updated
  if (existingThreshold !== newThreshold) {
    calls.push(setThreshold(newThreshold))
  }

  // Find owners to add (present in new but not in existing)
  const ownersToAdd = newOwnerAddresses.filter(
    (owner) => !normalizedExistingOwners.includes(owner),
  )

  // Find owners to remove (present in existing but not in new)
  const ownersToRemove = normalizedExistingOwners.filter(
    (owner) => !newOwnerAddresses.includes(owner),
  )

  // Start with current owners and simulate the state after additions
  // New owners are added to the START of the linked list
  let currentOwners = [...normalizedExistingOwners]

  // Add new owners (they get added to the start of the list)
  for (const owner of ownersToAdd) {
    calls.push(addOwner(owner))

    // Update our simulation: new owner goes to the start
    currentOwners.unshift(owner)
  }

  // Remove owners that are no longer needed
  // Use the updated list that includes the additions
  for (const ownerToRemove of ownersToRemove) {
    // Find the previous owner in the current list
    const ownerIndex = currentOwners.indexOf(ownerToRemove)

    let prevOwner: Address

    if (ownerIndex === 0) {
      // If it's the first owner, use the sentinel address
      prevOwner = '0x0000000000000000000000000000000000000001'
    } else {
      // Use the previous owner in the current list
      prevOwner = currentOwners[ownerIndex - 1]
    }

    calls.push(removeOwner(prevOwner, ownerToRemove))

    // Update the current owners list by removing the owner we just removed
    currentOwners = currentOwners.filter((owner) => owner !== ownerToRemove)
  }

  return calls
}

export { addOwner, removeOwner, setThreshold, recover, setUpRecovery }
