import { Address, Chain, createPublicClient, getAddress, http } from 'viem'
import { AccountType } from '../types'
import { getAttesters } from '.'
import { RHINESTONE_MODULE_REGISTRY_ADDRESS } from './omni-account'
import { OWNABLE_VALIDATOR_ADDRESS } from './validators/core'

async function getValidators(
  accountType: AccountType,
  account: Address,
  chain: Chain,
): Promise<Address[]> {
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })
  switch (accountType) {
    case 'safe':
    case 'nexus': {
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
    case 'kernel': {
      throw new Error('Kernel not supported')
    }
  }
}

async function getOwners(
  account: Address,
  chain: Chain,
): Promise<{
  accounts: Address[]
  threshold: number
} | null> {
  const publicClient = createPublicClient({
    chain,
    transport: http(),
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

async function areAttestersTrusted(
  account: Address,
  chain: Chain,
): Promise<boolean> {
  const { list: requiredAttesters } = getAttesters()
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })
  const trustedAttesters = await publicClient.readContract({
    abi: [
      {
        type: 'function',
        name: 'findTrustedAttesters',
        inputs: [
          {
            type: 'address',
            name: 'smartAccount',
          },
        ],
        outputs: [
          {
            type: 'address[]',
          },
        ],
      },
    ],
    functionName: 'findTrustedAttesters',
    address: RHINESTONE_MODULE_REGISTRY_ADDRESS,
    args: [account],
  })
  return requiredAttesters.every((attester) =>
    (trustedAttesters as Address[]).includes(getAddress(attester)),
  )
}

export { getValidators, getOwners, areAttestersTrusted }
