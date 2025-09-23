import {
  type Account,
  type Address,
  type Chain,
  createPublicClient,
} from 'viem'
import { getModuleInstallationCalls } from '../accounts'
import { createTransport } from '../accounts/json-rpc'
import { resolveCallInputs } from '../execution/utils'
import {
  getSocialRecoveryValidator,
  OWNABLE_VALIDATOR_ADDRESS,
  WEBAUTHN_VALIDATOR_ADDRESS,
} from '../modules/validators/core'
import type {
  CalldataInput,
  CallInput,
  LazyCallInput,
  OwnableValidatorConfig,
  RhinestoneConfig,
  WebauthnValidatorConfig,
} from '../types'
import { addOwner, changeThreshold, removeOwner } from './ecdsa'
import {
  addOwner as addPasskeyOwner,
  changeThreshold as changePasskeyThreshold,
  removeOwner as removePasskeyOwner,
} from './passkeys'

/**
 * Set up social recovery
 * @param guardians Guardians to use for recovery
 * @param threshold Threshold for the guardians
 * @returns Calls to set up social recovery
 */
function enable(guardians: Account[], threshold = 1): LazyCallInput {
  const module = getSocialRecoveryValidator(guardians, threshold)
  return {
    async resolve({ config }) {
      return getModuleInstallationCalls(config, module)
    },
  }
}

/**
 * Recover an account's ownership (ECDSA)
 * @param address Account address
 * @param newOwners New owners
 * @param chain Chain to recover ownership on
 * @param provider Provider to use for the recovery
 * @returns Calls to recover ownership
 */
async function recoverEcdsaOwnership(
  address: Address,
  newOwners: OwnableValidatorConfig,
  chain: Chain,
  config: RhinestoneConfig,
): Promise<CalldataInput[]> {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, config.provider),
  })

  // Read the existing config
  const results = await publicClient.multicall({
    contracts: [
      {
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
      },
      {
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
      },
    ],
  })
  const existingOwnersResult = results[0]
  const existingThresholdResult = results[1]
  if (existingOwnersResult.error || existingThresholdResult.error) {
    throw new Error('Failed to read existing owners or threshold')
  }
  const existingOwners = existingOwnersResult.result
  const existingThreshold = existingThresholdResult.result

  const normalizedExistingOwners = existingOwners.map(
    (owner) => owner.toLowerCase() as Address,
  )

  const callInputs: CallInput[] = []

  // Convert new owners config to addresses and threshold
  const newOwnerAddresses = newOwners.accounts
    .map((account) => account.address.toLowerCase() as Address)
    .sort()
  const newThreshold = newOwners.threshold ?? 1

  // Check if threshold needs to be updated
  if (Number(existingThreshold) !== newThreshold) {
    callInputs.push(changeThreshold(newThreshold))
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
    callInputs.push(addOwner(owner))
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
    callInputs.push(removeOwner(prevOwner, ownerToRemove))
    currentOwners = currentOwners.filter((owner) => owner !== ownerToRemove)
  }

  const calls = await resolveCallInputs(callInputs, config, chain, address)
  return calls
}

/**
 * Recover an account's ownership (Passkey)
 * @param address Account address
 * @param oldCredentials Old credentials to be replaced (with pubKeyX, pubKeyY)
 * @param newOwners New passkey owners
 * @param chain Chain to recover ownership on
 * @param provider Provider to use for the recovery
 * @returns Calls to recover ownership
 */
async function recoverPasskeyOwnership(
  address: Address,
  oldCredentials: { pubKeyX: bigint; pubKeyY: bigint }[],
  newOwners: WebauthnValidatorConfig,
  chain: Chain,
  config: RhinestoneConfig,
): Promise<CalldataInput[]> {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, config.provider),
  })

  const existingThreshold = await publicClient.readContract({
    address: WEBAUTHN_VALIDATOR_ADDRESS,
    abi: [
      {
        inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
        name: 'threshold',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    functionName: 'threshold',
    args: [address],
  })

  const callInputs: CallInput[] = []

  // Convert new owners config to credentials and threshold
  const newCredentials = newOwners.accounts.map((account) => {
    const publicKey = account.publicKey
    // Parse the public key hex string to extract x and y coordinates
    const publicKeyBytes = publicKey.startsWith('0x')
      ? publicKey.slice(2)
      : publicKey

    // The public key is 64 bytes: 32 bytes for x, 32 bytes for y
    const x = BigInt(`0x${publicKeyBytes.slice(0, 64)}`)
    const y = BigInt(`0x${publicKeyBytes.slice(64, 128)}`)

    return {
      pubKeyX: x,
      pubKeyY: y,
      requireUV: false, // Default to false for now
    }
  })
  const newThreshold = newOwners.threshold ?? 1

  // Check if threshold needs to be updated
  if (Number(existingThreshold) !== newThreshold) {
    callInputs.push(changePasskeyThreshold(newThreshold))
  }

  // Compare existing and new credentials to determine what to add/remove
  const existingCredentialKeys = oldCredentials.map(
    (cred) => `${cred.pubKeyX.toString()}-${cred.pubKeyY.toString()}`,
  )
  const newCredentialKeys = newCredentials.map(
    (cred) => `${cred.pubKeyX.toString()}-${cred.pubKeyY.toString()}`,
  )

  // Find credentials to add (new ones not in existing)
  const credentialsToAdd = newCredentials.filter(
    (cred) =>
      !existingCredentialKeys.includes(
        `${cred.pubKeyX.toString()}-${cred.pubKeyY.toString()}`,
      ),
  )

  // Find credentials to remove (existing ones not in new)
  const credentialsToRemove = oldCredentials.filter(
    (cred) =>
      !newCredentialKeys.includes(
        `${cred.pubKeyX.toString()}-${cred.pubKeyY.toString()}`,
      ),
  )

  // Remove old credentials first (important for security in recovery scenarios)
  for (const credential of credentialsToRemove) {
    callInputs.push(removePasskeyOwner(credential.pubKeyX, credential.pubKeyY))
  }

  // Then add new credentials
  for (const credential of credentialsToAdd) {
    callInputs.push(
      addPasskeyOwner(
        credential.pubKeyX,
        credential.pubKeyY,
        credential.requireUV,
      ),
    )
  }

  const calls = await resolveCallInputs(callInputs, config, chain, address)
  return calls
}

export { enable, recoverEcdsaOwnership, recoverPasskeyOwnership }
