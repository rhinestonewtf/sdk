import {
  type Address,
  type Chain,
  createPublicClient,
  http,
  zeroAddress,
} from 'viem'
import { mainnet, sepolia } from 'viem/chains'

import {
  deploySource,
  deployTarget,
  getAddress,
  getSmartSessionSmartAccount,
  isDeployed,
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
  OwnerSet,
  RhinestoneAccountConfig,
  Session,
  SignerSet,
  TokenRequest,
  Transaction,
} from '../types'
import { enableSmartSession } from './smart-session'
import type { BundleData, TransactionResult } from './utils'
import {
  getOrchestratorByChain,
  getUserOp,
  getUserOpOrderPath,
  prepareTransactionAsIntent,
  signIntent,
  signUserOp,
  submitIntentInternal,
  submitUserOp,
} from './utils'

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
  // if source chain is provided, check if account is deployed on that chain.
  // if source chain is not provided, it's a same chain transaction -> check if account is deployed on target chain (sourceChain === targetChain)
  const fromChain = sourceChain ?? targetChain
  if (fromChain) {
    const isAccountDeployed = await isDeployed(fromChain, config)
    if (!isAccountDeployed) {
      await deploySource(sourceChain, config)
    }
  }
  const accountAddress = getAddress(config)

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

  if (signers?.type === 'session') {
    if (!sourceChain) {
      throw new Error(
        `Specifying source chain is required when using smart sessions`,
      )
    }
    await enableSmartSession(sourceChain, config, signers.session)
    // Smart sessions require a UserOp flow
    return await sendTransactionAsUserOp(
      config,
      sourceChain,
      targetChain,
      calls,
      gasLimit,
      tokenRequests,
      accountAddress,
      signers.session,
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
      signers,
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
  const signature = await signUserOp(
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
    signature,
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
  signers?: OwnerSet,
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
  const signature = await signIntent(
    config,
    sourceChain,
    targetChain,
    orderBundleHash,
    signers
  )
  return await submitIntentInternal(
    config,
    sourceChain,
    targetChain,
    orderPath,
    signature,
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
