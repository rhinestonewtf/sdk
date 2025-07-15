import {
  type Address,
  type Chain,
  createPublicClient,
  encodeFunctionData,
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
  OWNABLE_VALIDATOR_ADDRESS,
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

import { trustAttester } from './registry'
import { encodeSmartSessionSignature } from './smart-session'

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
  provider?: ProviderConfig,
): Promise<Call[]> {
  switch (newOwners.type) {
    case 'ecdsa': {
      return recoverEcdsaOwnership(address, newOwners, chain, provider)
    }
    case 'passkey': {
      throw new Error('Passkey ownership recovery is not yet supported')
    }
    case 'multi-factor': {
      throw new Error('Multi-factor ownership recovery is not yet supported')
    }
  }
}

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

function enablePasskeys({
  rhinestoneAccount,
  pubKey,
  authenticatorId,
}: {
  rhinestoneAccount: RhinestoneAccount
} & WebauthnCredential) {
  const module = getWebAuthnValidator({ pubKey, authenticatorId })
  const calls = getModuleInstallationCalls(rhinestoneAccount.config, module)
  return calls
}

function disableEcdsa({
  rhinestoneAccount,
}: {
  rhinestoneAccount: RhinestoneAccount
}) {
  const module = getOwnableValidator(1, [])
  const calls = getModuleUninstallationCalls(rhinestoneAccount.config, module)
  return calls
}

function disablePasskeys({
  rhinestoneAccount,
}: {
  rhinestoneAccount: RhinestoneAccount
}) {
  const module = getWebAuthnValidator({
    // Mocked values
    pubKey:
      '0x580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d3737637d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d1',
    authenticatorId: '0x',
  })
  const calls = getModuleUninstallationCalls(rhinestoneAccount.config, module)
  return calls
}

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

async function recoverEcdsaOwnership(
  address: Address,
  newOwners: OwnableValidatorConfig,
  chain: Chain,
  provider?: ProviderConfig,
): Promise<Call[]> {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, provider),
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

function disableMultiFactor({
  rhinestoneAccount,
}: {
  rhinestoneAccount: RhinestoneAccount
}) {
  const module = getMultiFactorValidator(1, [])
  const calls = getModuleUninstallationCalls(rhinestoneAccount.config, module)
  return calls
}

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

export {
  enableEcdsa,
  enablePasskeys,
  disableEcdsa,
  disablePasskeys,
  addOwner,
  removeOwner,
  changeThreshold,
  recover,
  setUpRecovery,
  encodeSmartSessionSignature,
  trustAttester,
  enableMultiFactor,
  disableMultiFactor,
  changeMultiFactorThreshold,
  setSubValidator,
  removeSubValidator,
}
