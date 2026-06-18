import { type Address, type Chain, createPublicClient } from 'viem'
import { createTransport } from '../accounts/utils'
import type { AccountType, ProviderConfig } from '../types'
import { ENS_HCA_MODULE, OWNABLE_VALIDATOR_ADDRESS } from './validators/core'

async function getValidators(
  accountType: AccountType,
  account: Address,
  chain: Chain,
  provider?: ProviderConfig,
): Promise<Address[]> {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, provider),
  })
  switch (accountType) {
    case 'safe':
    case 'startale':
    case 'nexus':
    case 'hca':
    case 'passport': {
      const validators = await publicClient.readContract({
        abi: [
          {
            name: 'getValidatorsPaginated',
            type: 'function',
            inputs: [
              {
                name: 'cursor',
                type: 'address',
              },
              {
                name: 'pageSize',
                type: 'uint256',
              },
            ],
            outputs: [
              {
                name: 'array',
                type: 'address[]',
              },
              {
                name: 'next',
                type: 'address',
              },
            ],
          },
        ],
        functionName: 'getValidatorsPaginated',
        address: account,
        args: ['0x0000000000000000000000000000000000000001', 100n],
      })
      return (validators as [Address[], Address])[0]
    }
    case 'eoa': {
      return []
    }
    case 'kernel': {
      throw new Error('Kernel not supported')
    }
  }
}

async function getOwners(
  accountType: AccountType,
  account: Address,
  chain: Chain,
  provider?: ProviderConfig,
  hcaFactory?: Address,
): Promise<{
  accounts: Address[]
  threshold: number
} | null> {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, provider),
  })
  // HCA accounts hold owner state under the HCA module (the factory's init-data
  // parser), which is OwnableValidator-based, so the getOwners/threshold reads
  // are identical. A custom factory defines its own module, so resolve it from
  // the factory; otherwise fall back to the canonical module.
  let moduleAddress: Address = OWNABLE_VALIDATOR_ADDRESS
  if (accountType === 'hca') {
    moduleAddress = hcaFactory
      ? await publicClient.readContract({
          abi: [
            {
              name: 'initDataParser',
              type: 'function',
              stateMutability: 'view',
              inputs: [],
              outputs: [{ name: '', type: 'address' }],
            },
          ],
          functionName: 'initDataParser',
          address: hcaFactory,
        })
      : ENS_HCA_MODULE
  }
  const [ownerResult, thresholdResult] = await publicClient.multicall({
    contracts: [
      {
        abi: [
          {
            name: 'getOwners',
            type: 'function',
            inputs: [
              {
                name: 'account',
                type: 'address',
              },
            ],
            outputs: [
              {
                name: '',
                type: 'address[]',
              },
            ],
          },
        ],
        functionName: 'getOwners',
        address: moduleAddress,
        args: [account],
      },
      {
        abi: [
          {
            name: 'threshold',
            type: 'function',
            inputs: [
              {
                name: 'module',
                type: 'address',
              },
            ],
            outputs: [
              {
                name: '',
                type: 'uint256',
              },
            ],
          },
        ],
        functionName: 'threshold',
        address: moduleAddress,
        args: [account],
      },
    ],
  })
  if (ownerResult.error) {
    return null
  }
  if (thresholdResult.error) {
    return null
  }
  return {
    accounts: ownerResult.result as Address[],
    threshold: thresholdResult.result as number,
  }
}

async function getExecutors(
  accountType: AccountType,
  account: Address,
  chain: Chain,
  provider?: ProviderConfig,
): Promise<Address[]> {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, provider),
  })
  switch (accountType) {
    case 'safe':
    case 'startale':
    case 'nexus':
    case 'hca':
    case 'passport': {
      const executors = await publicClient.readContract({
        abi: [
          {
            name: 'getExecutorsPaginated',
            type: 'function',
            inputs: [
              {
                name: 'cursor',
                type: 'address',
              },
              {
                name: 'size',
                type: 'uint256',
              },
            ],
            outputs: [
              {
                name: 'array',
                type: 'address[]',
              },
              {
                name: 'next',
                type: 'address',
              },
            ],
          },
        ],
        functionName: 'getExecutorsPaginated',
        address: account,
        args: ['0x0000000000000000000000000000000000000001', 100n],
      })
      return (executors as [Address[], Address])[0]
    }
    case 'eoa': {
      return []
    }
    case 'kernel': {
      throw new Error('Kernel not supported')
    }
  }
}

async function isValidatorInitialized(
  account: Address,
  chain: Chain,
  validatorAddress: Address,
  provider?: ProviderConfig,
): Promise<boolean> {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, provider),
  })
  // `isInitialized` is a plain storage read on the validator singleton and
  // returns `false` for an uninitialized (or undeployed) account without
  // reverting. We deliberately let real read failures (provider/ABI errors)
  // propagate rather than coercing them to `false`, which could otherwise
  // produce an `onInstall` call for an already-initialized account.
  return publicClient.readContract({
    abi: [
      {
        name: 'isInitialized',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'smartAccount', type: 'address' }],
        outputs: [{ name: '', type: 'bool' }],
      },
    ],
    functionName: 'isInitialized',
    address: validatorAddress,
    args: [account],
  })
}

export { getValidators, getExecutors, getOwners, isValidatorInitialized }
