import { type Address, type Chain, createPublicClient } from 'viem'
import { createTransport } from '../accounts/utils'
import type { RhinestoneConfig } from '../types'

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

async function checkERC20Allowance(
  tokenAddress: Address,
  chain: Chain,
  config: RhinestoneConfig,
): Promise<bigint> {
  try {
    const publicClient = createPublicClient({
      chain,
      transport: createTransport(chain, config.provider),
    })

    const owner = config.eoa?.address
    if (!owner) {
      throw new Error('No EOA address found in account config')
    }

    const allowance = await publicClient.readContract({
      address: tokenAddress,
      abi: [
        {
          name: 'allowance',
          type: 'function',
          stateMutability: 'view',
          inputs: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
          ],
          outputs: [{ name: '', type: 'uint256' }],
        },
      ],
      functionName: 'allowance',
      args: [owner, PERMIT2_ADDRESS],
    })

    return BigInt(allowance.toString())
  } catch (error) {
    console.error('Error checking ERC20 allowance:', error)
    throw new Error('Failed to check ERC20 allowance')
  }
}

export { checkERC20Allowance }
