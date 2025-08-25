import {
  type Address,
  type Chain,
  createPublicClient,
  encodeFunctionData,
  encodePacked,
  type Hex,
  padHex,
  toHex,
} from 'viem'

import type { RhinestoneAccount } from '..'
import {
  getModuleInstallationCalls,
  getModuleUninstallationCalls,
} from '../accounts'
import { createTransport } from '../accounts/utils'
import {
  getMultiFactorValidator,
  getOwnableValidator,
  getSocialRecoveryValidator,
  getValidator,
  getWebAuthnValidator,
  MULTI_FACTOR_VALIDATOR_ADDRESS,
  OWNABLE_V0_VALIDATOR_ADDRESS,
  OWNABLE_VALIDATOR_ADDRESS,
  WEBAUTHN_VALIDATOR_ADDRESS,
  type WebauthnCredential,
} from '../modules/validators/core'
import type {
  Call,
  OwnableValidatorConfig,
  OwnerSet,
  ProviderConfig,
  Recovery,
  WebauthnValidatorConfig,
} from '../types'

import { encodeSmartSessionSignature } from './smart-session'

/**
 * Set up social recovery
 * @param rhinestoneAccount Account to set up social recovery on
 * @param guardians Guardians to use for recovery
 * @param threshold Threshold for the guardians
 * @returns Calls to set up social recovery
 */
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

/**
 * Recover an account's ownership
 * @param address Account address
 * @param newOwners New owners
 * @param chain Chain to recover ownership on
 * @param provider Provider to use for the recovery
 * @returns Calls to recover ownership
 * @deprecated Use `recoverEcdsaOwnership` or `recoverPasskeyOwnership` instead
 */
async function recover(
  address: Address,
  newOwners: OwnerSet,
  chain: Chain,
  provider?: ProviderConfig,
): Promise<Call[]> {
  switch (newOwners.type) {
    case 'ecdsa': {
      return recoverEcdsaOwnership(address, newOwners, chain, provider)
    }
    case 'ecdsa-v0': {
      return recoverEcdsaOwnership(
        address,
        newOwners,
        chain,
        provider,
        OWNABLE_V0_VALIDATOR_ADDRESS,
      )
    }
    case 'passkey': {
      throw new Error('Passkey ownership recovery is not yet supported')
    }
    case 'multi-factor': {
      throw new Error('Multi-factor ownership recovery is not yet supported')
    }
  }
}

/**
 * Enable ECDSA authentication
 * @param rhinestoneAccount Account to enable ECDSA authentication on
 * @param owners Owners to use for authentication
 * @param threshold Threshold for the owners
 * @returns Calls to enable ECDSA authentication
 */
function enableEcdsa({
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
 * Enable passkeys authentication
 * @param rhinestoneAccount Account to enable passkeys authentication on
 * @param pubKey Public key for the passkey
 * @param authenticatorId Authenticator ID for the passkey
 * @returns Calls to enable passkeys authentication
 */
function enablePasskeys({
  rhinestoneAccount,
  pubKey,
  authenticatorId,
}: {
  rhinestoneAccount: RhinestoneAccount
} & WebauthnCredential) {
  const module = getWebAuthnValidator(1, [{ pubKey, authenticatorId }])
  const calls = getModuleInstallationCalls(rhinestoneAccount.config, module)
  return calls
}

/**
 * Disable ECDSA authentication
 * @param rhinestoneAccount Account to disable ECDSA authentication on
 * @returns Calls to disable ECDSA authentication
 */
function disableEcdsa({
  rhinestoneAccount,
}: {
  rhinestoneAccount: RhinestoneAccount
}) {
  const module = getOwnableValidator(1, [])
  const calls = getModuleUninstallationCalls(rhinestoneAccount.config, module)
  return calls
}

/**
 * Disable passkeys (WebAuthn) authentication
 * @param rhinestoneAccount Account to disable passkeys authentication on
 * @returns Calls to disable passkeys authentication
 */
function disablePasskeys({
  rhinestoneAccount,
}: {
  rhinestoneAccount: RhinestoneAccount
}) {
  const module = getWebAuthnValidator(1, [
    {
      // Mocked values
      pubKey:
        '0x580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d3737637d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d1',
      authenticatorId: '0x',
    },
  ])
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

/**
 * Add a passkey owner
 * @param pubKeyX Public key X
 * @param pubKeyY Public key Y
 * @param requireUserVerification Whether to require user verification
 * @returns Call to add the passkey owner
 */
function addPasskeyOwner(
  pubKeyX: bigint,
  pubKeyY: bigint,
  requireUserVerification: boolean,
): Call {
  return {
    to: WEBAUTHN_VALIDATOR_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          inputs: [
            { name: 'pubKeyX', type: 'uint256' },
            { name: 'pubKeyY', type: 'uint256' },
            {
              name: 'requireUserVerification',
              type: 'bool',
            },
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

/**
 * Remove a passkey owner
 * @param pubKeyX Public key X
 * @param pubKeyY Public key Y
 * @returns Call to remove the passkey owner
 */
function removePasskeyOwner(pubKeyX: bigint, pubKeyY: bigint): Call {
  return {
    to: WEBAUTHN_VALIDATOR_ADDRESS,
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

/**
 * Change an account's signer threshold (passkey)
 * @param newThreshold New threshold
 * @returns Call to change the threshold
 */
function changePasskeyThreshold(newThreshold: number): Call {
  return {
    to: WEBAUTHN_VALIDATOR_ADDRESS,
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
  provider?: ProviderConfig,
  validatorAddress?: Address,
): Promise<Call[]> {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, provider),
  })

  // Read the existing config
  const results = await publicClient.multicall({
    contracts: [
      {
        address: validatorAddress ?? OWNABLE_VALIDATOR_ADDRESS,
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
        address: validatorAddress ?? OWNABLE_VALIDATOR_ADDRESS,
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

  const calls: Call[] = []

  // Convert new owners config to addresses and threshold
  const newOwnerAddresses = newOwners.accounts
    .map((account) => account.address.toLowerCase() as Address)
    .sort()
  const newThreshold = newOwners.threshold ?? 1

  // Check if threshold needs to be updated
  if (Number(existingThreshold) !== newThreshold) {
    calls.push(changeThreshold(newThreshold))
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
  provider?: ProviderConfig,
): Promise<Call[]> {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, provider),
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

  const calls: Call[] = []

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
    calls.push(changePasskeyThreshold(newThreshold))
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
    calls.push(removePasskeyOwner(credential.pubKeyX, credential.pubKeyY))
  }

  // Then add new credentials
  for (const credential of credentialsToAdd) {
    calls.push(
      addPasskeyOwner(
        credential.pubKeyX,
        credential.pubKeyY,
        credential.requireUV,
      ),
    )
  }

  return calls
}

/**
 * Enable multi-factor authentication
 * @param rhinestoneAccount Account to enable multi-factor authentication on
 * @param validators List of validators to use
 * @param threshold Threshold for the validators
 * @returns Calls to enable multi-factor authentication
 */
function enableMultiFactor({
  rhinestoneAccount,
  validators,
  threshold = 1,
}: {
  rhinestoneAccount: RhinestoneAccount
  validators: (OwnableValidatorConfig | WebauthnValidatorConfig | null)[]
  threshold?: number
}) {
  const module = getMultiFactorValidator(threshold, validators)
  const calls = getModuleInstallationCalls(rhinestoneAccount.config, module)
  return calls
}

/**
 * Disable multi-factor authentication
 * @param rhinestoneAccount Account to disable multi-factor authentication on
 * @returns Calls to disable multi-factor authentication
 */
function disableMultiFactor({
  rhinestoneAccount,
}: {
  rhinestoneAccount: RhinestoneAccount
}) {
  const module = getMultiFactorValidator(1, [])
  const calls = getModuleUninstallationCalls(rhinestoneAccount.config, module)
  return calls
}

/**
 * Change the multi-factor threshold
 * @param newThreshold New threshold
 * @returns Call to change the threshold
 */
function changeMultiFactorThreshold(newThreshold: number): Call {
  return {
    to: MULTI_FACTOR_VALIDATOR_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          inputs: [{ internalType: 'uint8', name: 'threshold', type: 'uint8' }],
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

/**
 * Set a sub-validator (multi-factor)
 * @param id Validator ID
 * @param validator Validator module
 * @returns Call to set the sub-validator
 */
function setSubValidator(
  id: Hex | number,
  validator: OwnableValidatorConfig | WebauthnValidatorConfig,
): Call {
  const validatorId = padHex(toHex(id), { size: 12 })
  const validatorModule = getValidator(validator)
  return {
    to: MULTI_FACTOR_VALIDATOR_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'setValidator',
          inputs: [
            {
              type: 'address',
              name: 'validatorAddress',
            },
            {
              type: 'bytes12',
              name: 'validatorId',
            },
            {
              type: 'bytes',
              name: 'newValidatorData',
            },
          ],
        },
      ],
      functionName: 'setValidator',
      args: [validatorModule.address, validatorId, validatorModule.initData],
    }),
  }
}

/**
 * Remove a sub-validator (multi-factor)
 * @param id Validator ID
 * @param validator Validator module
 * @returns Call to remove the sub-validator
 */
function removeSubValidator(
  id: Hex | number,
  validator: OwnableValidatorConfig | WebauthnValidatorConfig,
): Call {
  const validatorId = padHex(toHex(id), { size: 12 })
  const validatorModule = getValidator(validator)
  return {
    to: MULTI_FACTOR_VALIDATOR_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'removeValidator',
          inputs: [
            {
              type: 'address',
              name: 'validatorAddress',
            },
            {
              type: 'bytes12',
              name: 'validatorId',
            },
          ],
        },
      ],
      functionName: 'removeValidator',
      args: [validatorModule.address, validatorId],
    }),
  }
}

const EMISSARY_SMART_SESSION = '0x03'

function encodeSmartSessionEmissaryData(
  permissionId: Hex,
  sessionValidatorSignature: Hex,
  policyData: Hex = '0x',
): Hex {
  const sigLen = BigInt((sessionValidatorSignature.length - 2) / 2)
  const offsetToPolicy = 64n + sigLen
  return encodePacked(
    ['bytes1', 'bytes32', 'uint256', 'bytes', 'bytes'],
    [EMISSARY_SMART_SESSION, permissionId, offsetToPolicy, sessionValidatorSignature, policyData],
  )
}

export {
  enableEcdsa,
  enablePasskeys,
  disableEcdsa,
  disablePasskeys,
  addOwner,
  removeOwner,
  changeThreshold,
  addPasskeyOwner,
  removePasskeyOwner,
  changePasskeyThreshold,
  recover,
  recoverEcdsaOwnership,
  recoverPasskeyOwnership,
  setUpRecovery,
  encodeSmartSessionSignature,
  enableMultiFactor,
  disableMultiFactor,
  changeMultiFactorThreshold,
  setSubValidator,
  removeSubValidator,
  encodeSmartSessionEmissaryData,
}
