import {
  type Address,
  type Chain,
  createPublicClient,
  type Hex,
  keccak256,
} from 'viem'
import { createTransport } from '../accounts/utils'
import type { IntentOp } from '../orchestrator/types'
import type { RhinestoneConfig } from '../types'
import type {
  BatchPermit2Result,
  MultiChainPermit2Config,
  MultiChainPermit2Result,
  TokenPermissions,
} from './types'

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

function toToken(id: bigint): Address {
  return `0x${(id & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}`
}

function getTypedData(intentOp: IntentOp) {
  const element = intentOp.elements[0]
  const tokens = element.idsAndAmounts.map(([id, amount]) => [
    BigInt(id),
    BigInt(amount),
  ])
  const tokenPermissions = tokens.reduce<TokenPermissions[]>(
    (permissions, [id, amountIn]) => {
      const token = toToken(BigInt(id))
      const amount = BigInt(amountIn)
      const permission: TokenPermissions = { token, amount }
      permissions.push(permission)
      return permissions
    },
    [],
  )
  const spender = element.arbiter
  const mandate = element.mandate
  const typedData = {
    domain: {
      name: 'Permit2',
      chainId: Number(intentOp.elements[0].chainId),
      verifyingContract: PERMIT2_ADDRESS,
    },
    types: {
      TokenPermissions: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      Token: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      Target: [
        { name: 'recipient', type: 'address' },
        { name: 'tokenOut', type: 'Token[]' },
        { name: 'targetChain', type: 'uint256' },
        { name: 'fillExpiry', type: 'uint256' },
      ],
      Op: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
      Mandate: [
        { name: 'target', type: 'Target' },
        { name: 'originOps', type: 'Op[]' },
        { name: 'destOps', type: 'Op[]' },
        { name: 'q', type: 'bytes32' },
      ],
      PermitBatchWitnessTransferFrom: [
        { name: 'permitted', type: 'TokenPermissions[]' },
        { name: 'spender', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'mandate', type: 'Mandate' },
      ],
    },
    primaryType: 'PermitBatchWitnessTransferFrom',
    message: {
      permitted: tokenPermissions,
      spender: spender,
      nonce: BigInt(intentOp.nonce),
      deadline: BigInt(intentOp.expires),
      mandate: {
        target: {
          recipient: mandate.recipient,
          tokenOut: mandate.tokenOut.map((token) => ({
            token: toToken(BigInt(token[0])),
            amount: BigInt(token[1]),
          })),
          targetChain: BigInt(mandate.destinationChainId),
          fillExpiry: BigInt(mandate.fillDeadline),
        },
        originOps: mandate.preClaimOps.map((op) => ({
          to: op.to,
          value: BigInt(op.value),
          data: op.data,
        })),
        destOps: mandate.destinationOps.map((op) => ({
          to: op.to,
          value: BigInt(op.value),
          data: op.data,
        })),
        q: keccak256(mandate.qualifier.encodedVal),
      },
    },
  } as const

  return typedData
}

async function checkERC20AllowanceDirect(
  owner: Address,
  spender: Address,
  tokenAddress: Address,
  publicClient: any,
): Promise<bigint> {
  try {
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
      args: [owner, spender],
    })

    return BigInt(allowance.toString())
  } catch (error) {
    console.error('Error checking ERC20 allowance:', error)
    throw new Error('Failed to check ERC20 allowance')
  }
}

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

    // Get the account owner from the config
    const owner = config.eoa?.address
    if (!owner) {
      throw new Error('No EOA address found in account config')
    }

    return await checkERC20AllowanceDirect(
      owner,
      PERMIT2_ADDRESS,
      tokenAddress,
      publicClient,
    )
  } catch (error) {
    console.error('Error checking ERC20 allowance:', error)
    throw new Error('Failed to check ERC20 allowance')
  }
}

/**
 * Get the Permit2 contract address
 * @returns The Permit2 contract address
 */
function getPermit2Address(): Address {
  return PERMIT2_ADDRESS as Address
}

/**
 * Signs permit2 calls across multiple chains using batch approach.
 * Collects all signatures first, then returns them all at once.
 *
 * This approach is efficient for backend signers but may be memory-intensive
 * for frontend applications with many chains.
 *
 * @param configs - Array of permit2 signing configurations for different chains
 * @returns Promise<BatchPermit2Result> - All signatures collected
 */
async function signPermit2Batch(
  configs: MultiChainPermit2Config[],
): Promise<BatchPermit2Result> {
  const results: MultiChainPermit2Result[] = []
  let successfulSignatures = 0
  let failedSignatures = 0

  // Process all signing operations in parallel
  const signingPromises = configs.map(async (config) => {
    try {
      // Get typed data for this chain
      const typedData = getTypedData(config.intentOp)

      // Sign with EOA account
      if (!config.eoaAccount.signTypedData) {
        throw new Error('EOA account does not support typed data signing')
      }

      const signature = await config.eoaAccount.signTypedData(typedData)

      const result: MultiChainPermit2Result = {
        chainId: config.chain.id,
        signature,
        success: true,
      }

      successfulSignatures++
      return result
    } catch (error) {
      const result: MultiChainPermit2Result = {
        chainId: config.chain.id,
        signature: '0x' as Hex,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }

      failedSignatures++
      return result
    }
  })

  // Wait for all signing operations to complete
  const signingResults = await Promise.allSettled(signingPromises)

  // Process results
  for (const result of signingResults) {
    if (result.status === 'fulfilled') {
      results.push(result.value)
    } else {
      // This shouldn't happen since we catch errors in the promise
      failedSignatures++
      results.push({
        chainId: 0,
        signature: '0x' as Hex,
        success: false,
        error: result.reason,
      })
    }
  }

  return {
    results,
    totalChains: configs.length,
    successfulSignatures,
    failedSignatures,
    allSuccessful: failedSignatures === 0,
  }
}

/**
 * Signs permit2 calls across multiple chains sequentially.
 * Signs one by one, useful for frontend applications to avoid memory issues.
 *
 * This approach is more memory-efficient for frontend applications but slower
 * due to sequential processing.
 *
 * @param configs - Array of permit2 signing configurations for different chains
 * @param onProgress - Optional callback for progress updates
 * @returns Promise<BatchPermit2Result> - All signatures collected
 */
async function signPermit2Sequential(
  configs: MultiChainPermit2Config[],
  onProgress?: (
    completed: number,
    total: number,
    current: MultiChainPermit2Result,
  ) => void,
): Promise<BatchPermit2Result> {
  const results: MultiChainPermit2Result[] = []
  let successfulSignatures = 0
  let failedSignatures = 0

  // Process signing operations sequentially
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i]

    try {
      // Get typed data for this chain
      const typedData = getTypedData(config.intentOp)

      // Sign with EOA account
      if (!config.eoaAccount.signTypedData) {
        throw new Error('EOA account does not support typed data signing')
      }

      const signature = await config.eoaAccount.signTypedData(typedData)

      const result: MultiChainPermit2Result = {
        chainId: config.chain.id,
        signature,
        success: true,
      }

      results.push(result)
      successfulSignatures++

      // Call progress callback if provided
      onProgress?.(i + 1, configs.length, result)
    } catch (error) {
      const result: MultiChainPermit2Result = {
        chainId: config.chain.id,
        signature: '0x' as Hex,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }

      results.push(result)
      failedSignatures++

      // Call progress callback if provided
      onProgress?.(i + 1, configs.length, result)
    }
  }

  return {
    results,
    totalChains: configs.length,
    successfulSignatures,
    failedSignatures,
    allSuccessful: failedSignatures === 0,
  }
}

export {
  getTypedData,
  checkERC20Allowance,
  checkERC20AllowanceDirect,
  getPermit2Address,
  // Multi-chain permit2 signing methods
  signPermit2Batch,
  signPermit2Sequential,
  // Types
  type MultiChainPermit2Config,
  type MultiChainPermit2Result,
  type BatchPermit2Result,
}
