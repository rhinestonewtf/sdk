import type { Address, PublicClient } from 'viem'
import {
  getAddOwnableValidatorOwnerAction,
  getRemoveOwnableValidatorOwnerAction,
  getSetOwnableValidatorThresholdAction,
  getOwnableValidatorOwners,
} from '@rhinestone/module-sdk' // TODO: You might want to implement this locally

import type { RhinestoneAccountConfig, Transaction } from '../../types.js'
// Define ChainId type locally to avoid import issues
type ChainId = number
import { getAddress as getAddressInternal } from '../../accounts/index.js'
import { sendTransaction as sendTransactionInternal } from '../../execution/index.js'

/**
 * Get current owners of the account's ownable validator
 * @param config Rhinestone account config
 * @param chainId The chain ID to operate on
 * @param publicClient Optional public client for the specified chain
 * @returns Array of owner addresses
 */
export async function getOwners(
  config: RhinestoneAccountConfig,
  chainId: ChainId,
  publicClient: PublicClient
): Promise<Address[]> {
  const address = await getAddressInternal(config) as Address

  try {
    // Use Rhinestone SDK function
    const owners = await getOwnableValidatorOwners({
      publicClient,
      account: { type: "safe", address, deployedOnChains: [chainId] },
    })
    console.log("owners", owners)
    return owners
  } catch (error) {
    console.error("Error getting owners:", error)
    // Return the current owners from config as fallback
    if (config.owners.type === "ecdsa") {
      return config.owners.accounts.map(account => account.address)
    }
    return []
  }
}

/**
 * Add a new owner to the account's ownable validator
 * @param config Rhinestone account config
 * @param newOwner Address of the new owner to add
 * @param chainId The chain ID to operate on
 * @param publicClient Optional public client for the specified chain
 * @returns Transaction result object
 */
export async function addOwner(
  config: RhinestoneAccountConfig,
  newOwner: Address,
  chainId: ChainId,
  publicClient?: PublicClient
) {
  const address = await getAddressInternal(config) as Address

  // Use Rhinestone SDK function to get the action
  const action = await getAddOwnableValidatorOwnerAction({
    publicClient,
    account: { type: config.account?.type || "safe", address, deployedOnChains: [chainId] },
    owner: newOwner,
  })

  const transaction: Transaction = {
    chain: publicClient.chain,
    calls: [
      {
        to: action.target,
        data: action.callData,
        value: action.value as bigint,
      },
    ],
    tokenRequests: [],
  }

  return sendTransactionInternal(config, transaction)
}

/**
 * Remove an owner from the account's ownable validator
 * @param config Rhinestone account config
 * @param ownerToRemove Address of the owner to remove
 * @param chainId The chain ID to operate on
 * @param publicClient Optional public client for the specified chain
 * @returns Transaction result object
 */
export async function removeOwner(
  config: RhinestoneAccountConfig,
  ownerToRemove: Address,
  chainId: ChainId,
  publicClient?: PublicClient
) {
  const address = await getAddressInternal(config) as Address


  // Use Rhinestone SDK function to get the action
  const action = await getRemoveOwnableValidatorOwnerAction({
    publicClient,
    account: { type: "safe", address, deployedOnChains: [chainId] },
    owner: ownerToRemove,
  })

  const transaction: Transaction = {
    chain: publicClient.chain,
    calls: [
      {
        to: action.target,
        data: action.callData,
        value: action.value as bigint,
      },
    ],
    tokenRequests: [],
  }

  return sendTransactionInternal(config, transaction)
}

/**
 * Set the threshold for the account's ownable validator
 * @param config Rhinestone account config
 * @param threshold New threshold value
 * @param chainId The chain ID to operate on
 * @param publicClient Optional public client for the specified chain
 * @returns Transaction result object
 */
export async function setThreshold(
  config: RhinestoneAccountConfig,
  threshold: number,
  chainId: ChainId,
  publicClient?: PublicClient
) {
  const accountAddress = await getAddressInternal(config)


  // Use Rhinestone SDK function to get the action
  const action = await getSetOwnableValidatorThresholdAction({
    threshold,
  })

  const transaction: Transaction = {
    chain: publicClient.chain,
    calls: [
      {
        to: action.target,
        data: action.callData,
        value: action.value as bigint,
      },
    ],
    tokenRequests: [],
  }

  return sendTransactionInternal(config, transaction)
}

