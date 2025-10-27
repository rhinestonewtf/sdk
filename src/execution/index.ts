import { type Address, type Chain, createPublicClient, type Hex } from 'viem'
import type { UserOperationReceipt } from 'viem/_types/account-abstraction'
import { base, baseSepolia } from 'viem/chains'
import { deploy, getAddress } from '../accounts'
import { createTransport, getBundlerClient } from '../accounts/utils'
import type { IntentOpStatus } from '../orchestrator'
import {
  INTENT_STATUS_COMPLETED,
  INTENT_STATUS_FAILED,
  INTENT_STATUS_FILLED,
  INTENT_STATUS_PRECONFIRMED,
  isRateLimited,
  isRetryable,
} from '../orchestrator'
import { getChainById, resolveTokenAddress } from '../orchestrator/registry'
import type { Account, SettlementLayer } from '../orchestrator/types'
import type {
  CalldataInput,
  CallInput,
  RhinestoneAccountConfig,
  RhinestoneConfig,
  SignerSet,
  SourceAssetInput,
  TokenRequest,
  TokenSymbol,
  Transaction,
  UserOperationTransaction,
} from '../types'
import {
  ExecutionError,
  IntentFailedError,
  IntentStatusTimeoutError,
  isExecutionError,
  OrderPathRequiredForIntentsError,
  SessionChainRequiredError,
  SignerNotSupportedError,
} from './error'
import { enableSmartSession } from './smart-session'
import type { TransactionResult, UserOperationResult } from './utils'
import {
  getOrchestratorByChain,
  getTokenRequests,
  getValidatorAccount,
  parseCalls,
  prepareTransactionAsIntent,
  resolveCallInputs,
  signAuthorizationsInternal,
  signIntent,
  submitIntentInternal,
} from './utils'

const POLL_INITIAL_MS = 500
const POLL_SLOW_AFTER_MS = 5000
const POLL_SLOW_MS = 2000
const POLL_MAX_WAIT_MS = 180000
const POLL_ERROR_BACKOFF_MS = 1000
const POLL_ERROR_BACKOFF_MAX_MS = 10000

interface TransactionStatus {
  fill: {
    hash: Hex | undefined
    chainId: number
  }
  claims: {
    hash: Hex | undefined
    chainId: number
  }[]
}

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
  const {
    calls,
    gasLimit,
    tokenRequests,
    signers,
    sponsored,
    settlementLayers,
    sourceAssets,
    feeAsset,
    dryRun,
  } = transaction
  const isUserOpSigner =
    signers?.type === 'guardians' || signers?.type === 'session'
  if (isUserOpSigner) {
    throw new SignerNotSupportedError()
  }
  return await sendTransactionInternal(
    config,
    sourceChains,
    targetChain,
    calls,
    {
      gasLimit,
      initialTokenRequests: tokenRequests,
      signers,
      sponsored,
      settlementLayers,
      sourceAssets,
      feeAsset,
      dryRun,
    },
  )
}

async function sendUserOperation(
  config: RhinestoneAccountConfig,
  transaction: UserOperationTransaction,
) {
  const accountAddress = getAddress(config)
  const resolvedCalls = await resolveCallInputs(
    transaction.calls,
    config,
    transaction.chain,
    accountAddress,
  )
  const userOpSigner =
    transaction.signers?.type === 'session' ? transaction.signers.session : null
  if (userOpSigner) {
    await enableSmartSession(transaction.chain, config, userOpSigner)
  }
  // Smart sessions require a UserOp flow
  return await sendUserOperationInternal(
    config,
    transaction.chain,
    resolvedCalls,
    transaction.signers,
  )
}

async function sendTransactionInternal(
  config: RhinestoneConfig,
  sourceChains: Chain[],
  targetChain: Chain,
  callInputs: CallInput[],
  options: {
    gasLimit?: bigint
    initialTokenRequests?: TokenRequest[]
    recipient?: Account
    signers?: SignerSet
    sponsored?: boolean
    settlementLayers?: SettlementLayer[]
    sourceAssets?: SourceAssetInput
    lockFunds?: boolean
    feeAsset?: Address | TokenSymbol
    dryRun?: boolean
  },
) {
  const accountAddress = getAddress(config)
  const resolvedCalls = await resolveCallInputs(
    callInputs,
    config,
    targetChain,
    accountAddress,
  )
  const tokenRequests = getTokenRequests(
    sourceChains,
    targetChain,
    options.initialTokenRequests,
    options.settlementLayers,
  )

  const sendAsUserOp =
    options.signers?.type === 'guardians' || options.signers?.type === 'session'
  if (sendAsUserOp) {
    throw new SignerNotSupportedError()
  } else {
    return await sendTransactionAsIntent(
      config,
      sourceChains,
      targetChain,
      resolvedCalls,
      options.gasLimit,
      tokenRequests,
      options.recipient,
      accountAddress,
      options.dryRun,
      options.signers,
      options.sponsored,
      options.settlementLayers,
      options.sourceAssets,
      options.feeAsset,
      options.lockFunds,
    )
  }
}

async function sendUserOperationInternal(
  config: RhinestoneConfig,
  chain: Chain,
  callInputs: CalldataInput[],
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
  } as UserOperationResult
}

async function sendTransactionAsIntent(
  config: RhinestoneAccountConfig,
  sourceChains: Chain[],
  targetChain: Chain,
  callInputs: CalldataInput[],
  gasLimit: bigint | undefined,
  tokenRequests: TokenRequest[],
  recipient: Account | undefined,
  accountAddress: Address,
  dryRun: boolean = false,
  signers?: SignerSet,
  sponsored?: boolean,
  settlementLayers?: SettlementLayer[],
  sourceAssets?: SourceAssetInput,
  feeAsset?: Address | TokenSymbol,
  lockFunds?: boolean,
) {
  const intentRoute = await prepareTransactionAsIntent(
    config,
    sourceChains,
    targetChain,
    callInputs,
    gasLimit,
    tokenRequests,
    recipient,
    accountAddress,
    sponsored ?? false,
    undefined,
    settlementLayers,
    sourceAssets,
    feeAsset,
    lockFunds,
  )
  if (!intentRoute) {
    throw new OrderPathRequiredForIntentsError()
  }
  const { originSignatures, destinationSignature } = await signIntent(
    config,
    targetChain,
    intentRoute.intentOp,
    signers,
  )
  const authorizations = config.eoa
    ? await signAuthorizationsInternal(config, intentRoute)
    : []
  return await submitIntentInternal(
    config,
    sourceChains,
    targetChain,
    intentRoute.intentOp,
    originSignatures,
    destinationSignature,
    authorizations,
    dryRun,
  )
}

async function waitForExecution(
  config: RhinestoneConfig,
  result: TransactionResult | UserOperationResult,
  acceptsPreconfirmations: boolean,
): Promise<TransactionStatus | UserOperationReceipt> {
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
      const startTs = Date.now()
      let nextDelayMs = POLL_INITIAL_MS
      let errorBackoffMs = POLL_ERROR_BACKOFF_MS
      while (intentStatus === null || !validStatuses.has(intentStatus.status)) {
        const now = Date.now()
        if (now - startTs >= POLL_MAX_WAIT_MS) {
          throw new IntentStatusTimeoutError({
            context: { waitedMs: now - startTs },
          })
        }
        const orchestrator = getOrchestratorByChain(
          result.targetChain,
          config.apiKey,
          config.endpointUrl,
        )
        try {
          intentStatus = await orchestrator.getIntentOpStatus(result.id)
          // reset error backoff on success
          errorBackoffMs = POLL_ERROR_BACKOFF_MS
          const elapsed = Date.now() - startTs
          nextDelayMs =
            elapsed >= POLL_SLOW_AFTER_MS ? POLL_SLOW_MS : POLL_INITIAL_MS
          await new Promise((resolve) => setTimeout(resolve, nextDelayMs))
        } catch (err) {
          if (isRateLimited(err)) {
            const retryAfter = (err as any)?.context?.retryAfter as
              | string
              | undefined
            let retryMs = nextDelayMs
            if (retryAfter) {
              const parsed = Number(retryAfter)
              if (!Number.isNaN(parsed)) {
                retryMs = Math.max(parsed * 1000, nextDelayMs)
              } else {
                const asDate = Date.parse(retryAfter)
                if (!Number.isNaN(asDate)) {
                  retryMs = Math.max(asDate - Date.now(), nextDelayMs)
                }
              }
            } else {
              retryMs = Math.max(POLL_SLOW_MS, nextDelayMs)
            }
            await new Promise((resolve) => setTimeout(resolve, retryMs))
            continue
          }
          if (isRetryable(err)) {
            const backoff = Math.min(errorBackoffMs, POLL_ERROR_BACKOFF_MAX_MS)
            errorBackoffMs = Math.min(
              errorBackoffMs * 2,
              POLL_ERROR_BACKOFF_MAX_MS,
            )
            await new Promise((resolve) => setTimeout(resolve, backoff))
            continue
          }
          throw err
        }
      }
      if (intentStatus.status === INTENT_STATUS_FAILED) {
        throw new IntentFailedError()
      }
      return {
        fill: {
          hash: intentStatus.fillTransactionHash,
          chainId: result.targetChain,
        },
        claims: intentStatus.claims.map((claim) => ({
          hash: claim.claimTransactionHash,
          chainId: claim.chainId,
        })),
      }
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
  config: RhinestoneConfig,
  chain: Chain,
  token: Address | TokenSymbol,
  gasUnits: bigint,
  sponsored: boolean = false,
): Promise<bigint> {
  const address = getAddress(config)
  const orchestrator = getOrchestratorByChain(
    chain.id,
    config.apiKey,
    config.endpointUrl,
  )
  const tokenAddress = resolveTokenAddress(token, chain.id)
  return orchestrator.getMaxTokenAmount(
    address,
    chain.id,
    tokenAddress,
    gasUnits,
    sponsored,
  )
}

async function getPortfolio(config: RhinestoneConfig, onTestnets: boolean) {
  const address = getAddress(config)
  const chainId = onTestnets ? baseSepolia.id : base.id
  const orchestrator = getOrchestratorByChain(
    chainId,
    config.apiKey,
    config.endpointUrl,
  )
  return orchestrator.getPortfolio(address)
}

async function getIntentStatus(
  apiKey: string | undefined,
  endpointUrl: string | undefined,
  intentId: bigint,
): Promise<
  TransactionStatus & {
    status: IntentOpStatus['status']
  }
> {
  const environment = BigInt(intentId.toString().slice(0, 1))
  const chainId = environment === 4n ? base.id : baseSepolia.id
  const orchestrator = getOrchestratorByChain(chainId, apiKey, endpointUrl)
  const internalStatus = await orchestrator.getIntentOpStatus(intentId)
  return {
    status: internalStatus.status,
    fill: {
      hash: internalStatus.fillTransactionHash,
      chainId: chainId,
    },
    claims: internalStatus.claims.map((claim) => ({
      hash: claim.claimTransactionHash,
      chainId: claim.chainId,
    })),
  }
}

export {
  sendTransaction,
  sendTransactionInternal,
  sendUserOperation,
  sendUserOperationInternal,
  waitForExecution,
  getMaxSpendableAmount,
  getPortfolio,
  getIntentStatus,
  // Errors
  isExecutionError,
  ExecutionError,
  IntentFailedError,
  IntentStatusTimeoutError,
  OrderPathRequiredForIntentsError,
  SessionChainRequiredError,
  SignerNotSupportedError,
}
export type { TransactionStatus, TransactionResult, UserOperationResult }
