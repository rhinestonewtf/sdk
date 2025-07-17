import { type Address, type Chain, createPublicClient, zeroAddress } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

import { deploy, getAddress } from '../accounts'
import { createTransport, getBundlerClient } from '../accounts/utils'
import type { IntentOpStatus } from '../orchestrator'
import {
  INTENT_STATUS_COMPLETED,
  INTENT_STATUS_FAILED,
  INTENT_STATUS_FILLED,
  INTENT_STATUS_PRECONFIRMED,
} from '../orchestrator'
import { getChainById } from '../orchestrator/registry'
import type {
  CallInput,
  RhinestoneAccountConfig,
  SignerSet,
  TokenRequest,
  Transaction,
} from '../types'
import {
  ExecutionError,
  IntentFailedError,
  isExecutionError,
  OrderPathRequiredForIntentsError,
  SessionChainRequiredError,
  SourceChainRequiredForSmartSessionsError,
  SourceTargetChainMismatchError,
  UserOperationRequiredForSmartSessionsError,
} from './error'
import { enableSmartSession } from './smart-session'
import type { IntentData, TransactionResult } from './utils'
import {
  getOrchestratorByChain,
  getValidatorAccount,
  parseCalls,
  prepareTransactionAsIntent,
  signIntent,
  submitIntentInternal,
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
  callInputs: CallInput[],
  gasLimit: bigint | undefined,
  initialTokenRequests?: TokenRequest[],
  signers?: SignerSet,
) {
  const accountAddress = getAddress(config)

  // Across requires passing some value to repay the solvers
  const tokenRequests =
    !initialTokenRequests || initialTokenRequests.length === 0
      ? [
          {
            address: zeroAddress,
            amount: 1n,
          },
        ]
      : initialTokenRequests

  const asUserOp = signers?.type === 'guardians' || signers?.type === 'session'
  if (asUserOp) {
    if (!sourceChain) {
      throw new SourceChainRequiredForSmartSessionsError()
    }
    const withSession = signers?.type === 'session' ? signers.session : null
    if (withSession) {
      await enableSmartSession(sourceChain, config, withSession)
    }
    // Smart sessions require a UserOp flow
    return await sendTransactionAsUserOp(
      config,
      sourceChain,
      targetChain,
      callInputs,
      signers,
    )
  } else {
    return await sendTransactionAsIntent(
      config,
      sourceChain,
      targetChain,
      callInputs,
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
  callInputs: CallInput[],
  signers: SignerSet,
) {
  // Make sure the account is deployed
  await deploy(config, sourceChain)
  const withSession = signers?.type === 'session' ? signers.session : null
  const publicClient = createPublicClient({
    chain: sourceChain,
    transport: createTransport(sourceChain, config.provider),
  })
  const validatorAccount = await getValidatorAccount(
    config,
    signers,
    publicClient,
    sourceChain,
  )
  if (!validatorAccount) {
    throw new Error('No validator account found')
  }
  const bundlerClient = getBundlerClient(config, publicClient)
  if (withSession) {
    await enableSmartSession(targetChain, config, withSession)
  }
  const calls = parseCalls(callInputs, targetChain.id)
  const hash = await bundlerClient.sendUserOperation({
    account: validatorAccount,
    calls,
  })
  return {
    type: 'userop',
    hash,
    sourceChain: sourceChain.id,
    targetChain: targetChain.id,
  } as TransactionResult
}

async function sendTransactionAsIntent(
  config: RhinestoneAccountConfig,
  sourceChain: Chain | undefined,
  targetChain: Chain,
  callInputs: CallInput[],
  gasLimit: bigint | undefined,
  tokenRequests: TokenRequest[],
  accountAddress: Address,
  signers?: SignerSet,
) {
  const { intentRoute, hash: intentHash } = await prepareTransactionAsIntent(
    config,
    sourceChain,
    targetChain,
    callInputs,
    gasLimit,
    tokenRequests,
    accountAddress,
  )
  if (!intentRoute) {
    throw new OrderPathRequiredForIntentsError()
  }
  const signature = await signIntent(
    config,
    sourceChain,
    targetChain,
    intentHash,
    signers,
  )
  return await submitIntentInternal(
    config,
    sourceChain,
    targetChain,
    intentRoute.intentOp,
    signature,
  )
}

async function waitForExecution(
  config: RhinestoneAccountConfig,
  result: TransactionResult,
  acceptsPreconfirmations: boolean,
) {
  const validStatuses: Set<IntentOpStatus['status']> = new Set([
    INTENT_STATUS_FAILED,
    INTENT_STATUS_COMPLETED,
    INTENT_STATUS_FILLED,
  ])
  if (acceptsPreconfirmations) {
    validStatuses.add(INTENT_STATUS_PRECONFIRMED)
  }

  switch (result.type) {
    case 'intent': {
      let intentStatus: IntentOpStatus | null = null
      while (intentStatus === null || !validStatuses.has(intentStatus.status)) {
        const orchestrator = getOrchestratorByChain(
          result.targetChain,
          config.rhinestoneApiKey,
        )
        intentStatus = await orchestrator.getIntentOpStatus(result.id)
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL))
      }
      if (intentStatus.status === INTENT_STATUS_FAILED) {
        throw new IntentFailedError()
      }
      return intentStatus
    }
    case 'userop': {
      const targetChain = getChainById(result.targetChain)
      if (!targetChain) {
        throw new Error(`Unsupported chain ID: ${result.targetChain}`)
      }
      const publicClient = createPublicClient({
        chain: targetChain,
        transport: createTransport(targetChain, config.provider),
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
  return orchestrator.getPortfolio(address)
}

export {
  sendTransaction,
  waitForExecution,
  getMaxSpendableAmount,
  getPortfolio,
  // Errors
  isExecutionError,
  IntentFailedError,
  ExecutionError,
  SourceChainRequiredForSmartSessionsError,
  SourceTargetChainMismatchError,
  UserOperationRequiredForSmartSessionsError,
  OrderPathRequiredForIntentsError,
  SessionChainRequiredError,
}
export type { IntentData, TransactionResult }
