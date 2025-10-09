import { type Address, type Chain, createPublicClient } from 'viem'
import { createTransport } from '../accounts/utils'
import type { AccountType, ProviderConfig } from '../types'
import { OWNABLE_VALIDATOR_ADDRESS } from './validators/core'

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
  account: Address,
  chain: Chain,
  provider?: ProviderConfig,
): Promise<{
  accounts: Address[]
  threshold: number
} | null> {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, provider),
  })
  const moduleAddress = OWNABLE_VALIDATOR_ADDRESS
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

export { getValidators, getOwners }
