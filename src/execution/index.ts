import {
  type Address,
  type Chain,
  createPublicClient,
  type Hex,
  http,
  zeroAddress,
} from 'viem'
import {
  entryPoint07Address,
  getUserOperationHash,
} from 'viem/account-abstraction'
import { mainnet, sepolia } from 'viem/chains'

import {
  deploySource,
  deployTarget,
  getAddress,
  getSmartSessionSmartAccount,
  isDeployed,
  sign,
} from '../accounts'
import { getBundlerClient } from '../accounts/utils'
import type { BundleResult } from '../orchestrator'
import {
  BUNDLE_STATUS_COMPLETED,
  BUNDLE_STATUS_FAILED,
  BUNDLE_STATUS_FILLED,
  BUNDLE_STATUS_PRECONFIRMED,
} from '../orchestrator'
import {
  getChainById,
  getDefaultAccountAccessList,
} from '../orchestrator/registry'
import { BundleStatus } from '../orchestrator/types'
import type {
  Call,
  RhinestoneAccountConfig,
  Session,
  SignerSet,
  TokenRequest,
  Transaction,
} from '../types'

import type { BundleData, TransactionResult } from './utils'
import {
  getOrchestratorByChain,
  getUserOp,
  getUserOpOrderPath,
  prepareTransactionAsIntent,
  signUserOp,
  submitIntentInternal,
  submitUserOp,
} from './utils'
import {
  enableSmartSession,
  getSessionSignature,
  hashErc7739,
} from './smart-session'

const POLLING_INTERVAL = 500

async function sendTransaction(
  config: RhinestoneAccountConfig,
  transaction: Transaction,
) {
  if ('chain' in transaction) {
    // Same-chain transaction
    return await sendTransactionInternal(
      config,
      transaction.chain,
      transaction.chain,
      transaction.calls,
      transaction.gasLimit,
      transaction.tokenRequests,
      transaction.signers,
    )
  } else {
    // Cross-chain transaction
    return await sendTransactionInternal(
      config,
      transaction.sourceChain,
      transaction.targetChain,
      transaction.calls,
      transaction.gasLimit,
      transaction.tokenRequests,
      transaction.signers,
    )
  }
}

async function sendTransactionInternal(
  config: RhinestoneAccountConfig,
  sourceChain: Chain | undefined,
  targetChain: Chain,
  calls: Call[],
  gasLimit: bigint | undefined,
  initialTokenRequests: TokenRequest[],
  signers?: SignerSet,
) {
  if (sourceChain) {
    const isAccountDeployed = await isDeployed(sourceChain, config)
    if (!isAccountDeployed) {
      await deploySource(sourceChain, config)
    }
  }
  const accountAddress = getAddress(config)
  const withSession = signers?.type === 'session' ? signers.session : null

  // Across requires passing some value to repay the solvers
  const tokenRequests =
    initialTokenRequests.length === 0
      ? [
          {
            address: zeroAddress,
            amount: 1n,
          },
        ]
      : initialTokenRequests

  if (withSession) {
    if (!sourceChain) {
      throw new Error(
        `Specifying source chain is required when using smart sessions`,
      )
    }
    await enableSmartSession(sourceChain, config, withSession)
    // Smart sessions require a UserOp flow
    return await sendTransactionAsUserOp(
      config,
      sourceChain,
      targetChain,
      calls,
      gasLimit,
      tokenRequests,
      accountAddress,
      withSession,
    )
  } else {
    return await sendTransactionAsIntent(
      config,
      sourceChain,
      targetChain,
      calls,
      gasLimit,
      tokenRequests,
      accountAddress,
    )
  }
}

async function sendTransactionAsUserOp(
  config: RhinestoneAccountConfig,
  sourceChain: Chain,
  targetChain: Chain,
  calls: Call[],
  gasLimit: bigint | undefined,
  tokenRequests: TokenRequest[],
  accountAddress: Address,
  withSession: Session,
) {
  const publicClient = createPublicClient({
    chain: sourceChain,
    transport: http(),
  })
  const sessionAccount = await getSmartSessionSmartAccount(
    config,
    publicClient,
    sourceChain,
    withSession,
  )
  const bundlerClient = getBundlerClient(config, publicClient)

  if (sourceChain.id === targetChain.id) {
    await enableSmartSession(targetChain, config, withSession)
    const hash = await bundlerClient.sendUserOperation({
      account: sessionAccount,
      calls,
    })
    return {
      type: 'userop',
      hash,
      sourceChain: sourceChain.id,
      targetChain: targetChain.id,
    } as TransactionResult
  }
  const orderPath = await getUserOpOrderPath(
    sourceChain,
    targetChain,
    tokenRequests,
    accountAddress,
    gasLimit,
    config.rhinestoneApiKey,
  )
  // Deploy the account on the target chain
  await deployTarget(targetChain, config, true)
  await enableSmartSession(targetChain, config, withSession)

  const userOp = await getUserOp(
    config,
    targetChain,
    withSession,
    orderPath,
    calls,
    tokenRequests,
    accountAddress,
  )
  const sessionSignature = await signUserOp(
    config,
    sourceChain,
    targetChain,
    accountAddress,
    withSession,
    userOp,
    orderPath,
  )
  return await submitUserOp(
    config,
    sourceChain,
    targetChain,
    userOp,
    orderPath,
    sessionSignature,
  )
}

async function sendTransactionAsIntent(
  config: RhinestoneAccountConfig,
  sourceChain: Chain | undefined,
  targetChain: Chain,
  calls: Call[],
  gasLimit: bigint | undefined,
  tokenRequests: TokenRequest[],
  accountAddress: Address,
) {
  const { orderPath, hash: orderBundleHash } = await prepareTransactionAsIntent(
    config,
    sourceChain,
    targetChain,
    calls,
    gasLimit,
    tokenRequests,
    accountAddress,
  )
  const bundleSignature = await sign(
    config.owners,
    sourceChain || targetChain,
    orderBundleHash,
  )
  return await submitIntentInternal(
    config,
    sourceChain,
    targetChain,
    orderPath,
    bundleSignature,
    true,
  )
}

async function waitForExecution(
  config: RhinestoneAccountConfig,
  result: TransactionResult,
  acceptsPreconfirmations: boolean,
) {
  const validStatuses: Set<BundleStatus> = new Set([
    BUNDLE_STATUS_FAILED,
    BUNDLE_STATUS_COMPLETED,
    BUNDLE_STATUS_FILLED,
  ])
  if (acceptsPreconfirmations) {
    validStatuses.add(BUNDLE_STATUS_PRECONFIRMED)
  }

  switch (result.type) {
    case 'bundle': {
      let bundleResult: BundleResult | null = null
      while (bundleResult === null || !validStatuses.has(bundleResult.status)) {
        const orchestrator = getOrchestratorByChain(
          result.targetChain,
          config.rhinestoneApiKey,
        )
        bundleResult = await orchestrator.getBundleStatus(result.id)
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL))
      }
      if (bundleResult.status === BUNDLE_STATUS_FAILED) {
        throw new Error('Bundle failed')
      }
      return bundleResult
    }
    case 'userop': {
      const targetChain = getChainById(result.targetChain)
      const publicClient = createPublicClient({
        chain: targetChain,
        transport: http(),
      })
      const bundlerClient = getBundlerClient(config, publicClient)
      const receipt = await bundlerClient.waitForUserOperationReceipt({
        hash: result.hash,
      })
      return receipt
    }
  }
}

async function getMaxSpendableAmount(
  config: RhinestoneAccountConfig,
  chain: Chain,
  tokenAddress: Address,
  gasUnits: bigint,
): Promise<bigint> {
  const address = getAddress(config)
  const orchestrator = getOrchestratorByChain(chain.id, config.rhinestoneApiKey)
  return orchestrator.getMaxTokenAmount(
    address,
    chain.id,
    tokenAddress,
    gasUnits,
  )
}

async function getPortfolio(
  config: RhinestoneAccountConfig,
  onTestnets: boolean,
) {
  const address = getAddress(config)
  const chainId = onTestnets ? sepolia.id : mainnet.id
  const orchestrator = getOrchestratorByChain(chainId, config.rhinestoneApiKey)
  return orchestrator.getPortfolio(address, getDefaultAccountAccessList())
}

export {
  sendTransaction,
  waitForExecution,
  getMaxSpendableAmount,
  getPortfolio,
}
export type { BundleData, TransactionResult }
