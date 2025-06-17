import { Address, encodeFunctionData, PublicClient } from 'viem'

import { RhinestoneAccountConfig } from '../types'
import { getSetup } from '.'
import { RHINESTONE_MODULE_REGISTRY_ADDRESS } from './omni-account'

function getTrustAttesterCall(config: RhinestoneAccountConfig) {
  const moduleSetup = getSetup(config)
  return {
    to: RHINESTONE_MODULE_REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: [
        {
          name: 'trustAttesters',
          type: 'function',
          inputs: [
            {
              name: 'threshold',
              type: 'uint8',
            },
            {
              name: 'attesters',
              type: 'address[]',
            },
          ],
          outputs: [],
        },
      ],
      functionName: 'trustAttesters',
      args: [moduleSetup.threshold, moduleSetup.attesters],
    }),
  }
}

async function getTrustedAttesters(
  client: PublicClient,
  account: Address,
): Promise<readonly Address[]> {
  return await client.readContract({
    address: RHINESTONE_MODULE_REGISTRY_ADDRESS,
    abi: [
      {
        type: 'function',
        stateMutability: 'view',
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
            name: 'attesters',
          },
        ],
      },
    ],
    functionName: 'findTrustedAttesters',
    args: [account],
  })
}

export { getTrustAttesterCall, getTrustedAttesters }
