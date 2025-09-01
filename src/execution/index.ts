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
  SourceChainsNotAvailableForUserOpFlowError,
  UserOperationRequiredForSmartSessionsError,
} from './error'
import { enableSmartSession } from './smart-session'
import type { IntentData, TransactionResult } from './utils'
import {
  getOrchestratorByChain,
  getValidatorAccount,
  parseCalls,
  prepareTransactionAsIntent,
  signAuthorizationsInternal,
  signIntent,
  submitIntentInternal,
} from './utils'

const POLLING_INTERVAL = 500

async function sendTransaction(
  config: RhinestoneAccountConfig,
  transaction: Transaction,
) {
  const sourceChains =
    'chain' in transaction
      ? [transaction.chain]
      : transaction.sourceChains || []
  const targetChain =
    'chain' in transaction ? transaction.chain : transaction.targetChain
  return await sendTransactionInternal(
    config,
    sourceChains,
    targetChain,
    transaction.calls,
    transaction.gasLimit,
    transaction.tokenRequests,
    transaction.signers,
    transaction.sponsored,
  )
}

async function sendTransactionInternal(
  config: RhinestoneAccountConfig,
  sourceChains: Chain[],
  targetChain: Chain,
  callInputs: CallInput[],
  gasLimit: bigint | undefined,
  initialTokenRequests?: TokenRequest[],
  signers?: SignerSet,
  sponsored?: boolean,
  asUserOp?: boolean,
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

  const sendAsUserOp =
    asUserOp || signers?.type === 'guardians' || signers?.type === 'session'
  if (sendAsUserOp) {
    const withSession = signers?.type === 'session' ? signers.session : null
    if (withSession) {
      await enableSmartSession(targetChain, config, withSession)
    }
    // Smart sessions require a UserOp flow
    return await sendTransactionAsUserOp(
      config,
      targetChain,
      callInputs,
      signers,
    )
  } else {
    return await sendTransactionAsIntent(
      config,
      sourceChains,
      targetChain,
      callInputs,
      gasLimit,
      tokenRequests,
      accountAddress,
      signers,
      sponsored,
    )
  }
}

async function sendTransactionAsUserOp(
  config: RhinestoneAccountConfig,
  chain: Chain,
  callInputs: CallInput[],
  signers?: SignerSet,
) {
  // Make sure the account is deployed
  await deploy(config, chain)
  const withSession = signers?.type === 'session' ? signers.session : null
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, config.provider),
  })
  const validatorAccount = await getValidatorAccount(
    config,
    signers,
    publicClient,
    chain,
  )
  if (!validatorAccount) {
    throw new Error('No validator account found')
  }
  const bundlerClient = getBundlerClient(config, publicClient)
  if (withSession) {
    await enableSmartSession(chain, config, withSession)
  }
  const calls = parseCalls(callInputs, chain.id)
  const hash = await bundlerClient.sendUserOperation({
    account: validatorAccount,
    calls,
  })
  return {
    type: 'userop',
    hash,
    chain: chain.id,
  } as TransactionResult
}

async function sendTransactionAsIntent(
  config: RhinestoneAccountConfig,
  sourceChains: Chain[],
  targetChain: Chain,
  callInputs: CallInput[],
  gasLimit: bigint | undefined,
  tokenRequests: TokenRequest[],
  accountAddress: Address,
  signers?: SignerSet,
  sponsored?: boolean,
) {
  const { intentRoute } = await prepareTransactionAsIntent(
    config,
    sourceChains,
    targetChain,
    callInputs,
    gasLimit,
    tokenRequests,
    accountAddress,
    sponsored ?? false,
  )
  if (!intentRoute) {
    throw new OrderPathRequiredForIntentsError()
  }
  const signature = await signIntent(
    config,
    targetChain,
    intentRoute.intentOp,
    signers,
  )
  const authorizations = config.eoa
    ? await signAuthorizationsInternal(config, {
        type: 'intent',
        intentRoute,
      })
    : []
  return await submitIntentInternal(
    config,
    sourceChains,
    targetChain,
    intentRoute.intentOp,
    signature,
    authorizations,
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
          config.useDev,
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
      const targetChain = getChainById(result.chain)
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
  const orchestrator = getOrchestratorByChain(
    chain.id,
    config.rhinestoneApiKey,
    config.useDev,
  )
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
  const orchestrator = getOrchestratorByChain(
    chainId,
    config.rhinestoneApiKey,
    config.useDev,
  )
  return orchestrator.getPortfolio(address)
}

export {
  sendTransaction,
  sendTransactionInternal,
  waitForExecution,
  getMaxSpendableAmount,
  getPortfolio,
  // Errors
  isExecutionError,
  IntentFailedError,
  ExecutionError,
  SourceChainsNotAvailableForUserOpFlowError,
  UserOperationRequiredForSmartSessionsError,
  OrderPathRequiredForIntentsError,
  SessionChainRequiredError,
}
export type { IntentData, TransactionResult }
