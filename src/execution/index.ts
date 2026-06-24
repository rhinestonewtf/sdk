import { type Address, type Chain, createPublicClient, type Hex } from 'viem'
import type { UserOperationReceipt } from 'viem/account-abstraction'
import { deploy, getAddress } from '../accounts'
import { createTransport, getBundlerClient } from '../accounts/utils'
import { type AuthProvider, createAuthProvider } from '../auth/provider'
import {
  getOrchestrator,
  INTENT_STATUS_COMPLETED,
  INTENT_STATUS_FAILED,
  type IntentOpStatus,
  isConnectionError,
  isRateLimited,
  isRetryable,
  type SplitIntentsInput,
} from '../orchestrator'
import type { NonEvmAddress } from '../orchestrator/destinations'
import {
  getChainById,
  getSupportedChainIds,
  isTestnet,
} from '../orchestrator/registry'
import type { SettlementLayerFilter } from '../orchestrator/types'
import type {
  CalldataInput,
  CallInput,
  NonEvmTokenRequest,
  RhinestoneAccountConfig,
  RhinestoneConfig,
  SignerSet,
  SourceAssetInput,
  SourceCallInput,
  Sponsorship,
  TokenRequest,
  TokenSymbol,
  UserOperationTransaction,
} from '../types'
import {
  ExecutionError,
  IntentFailedError,
  InvalidSourceCallsError,
  isExecutionError,
  OrderPathRequiredForIntentsError,
  QuoteNotInPreparedTransactionError,
  SessionChainRequiredError,
} from './error'
import type { TransactionResult, UserOperationResult } from './utils'
import {
  getTargetExecutionSignature,
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
const POLL_SLOW_AFTER_MS = 15000
const POLL_SLOW_MS = 2000
const POLL_ERROR_BACKOFF_MS = 1000
const POLL_ERROR_BACKOFF_MAX_MS = 10000

interface TransactionStatus {
  /** OpenTelemetry trace ID for correlating the status response. */
  traceId: IntentOpStatus['traceId']
  /** High-level intent status. */
  status: IntentOpStatus['status']
  /** The account address that owns this intent. */
  accountAddress: Address
  /** Per-chain operation status. One entry per chain. */
  operations: IntentOpStatus['operations']
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
  return await sendUserOperationInternal(
    config,
    transaction.chain,
    resolvedCalls,
    transaction.signers,
  )
}

async function sendTransactionInternal(
  config: RhinestoneConfig,
  sourceChains: Chain[] | undefined,
  targetChain: Chain,
  options: {
    callInputs?: CallInput[]
    sourceCalls?: Record<number, SourceCallInput[]>
    gasLimit?: bigint
    initialTokenRequests?: TokenRequest[]
    recipient?: RhinestoneAccountConfig | Address
    signers?: SignerSet
    sponsored?: Sponsorship
    eip7702InitSignature?: Hex
    settlementLayers?: SettlementLayerFilter
    sourceAssets?: SourceAssetInput
    feeAsset?: Address | TokenSymbol
  },
) {
  const accountAddress = getAddress(config)
  const resolvedCalls = await resolveCallInputs(
    options.callInputs,
    config,
    targetChain,
    accountAddress,
  )
  const tokenRequests = getTokenRequests(
    targetChain,
    options.initialTokenRequests,
  )

  return await sendTransactionAsIntent(
    config,
    sourceChains,
    targetChain,
    resolvedCalls,
    options.gasLimit,
    tokenRequests,
    options.recipient,
    options.signers,
    options.sponsored,
    options.eip7702InitSignature,
    options.settlementLayers,
    options.sourceAssets,
    options.feeAsset,
    options.sourceCalls,
  )
}

async function sendUserOperationInternal(
  config: RhinestoneConfig,
  chain: Chain,
  callInputs: CalldataInput[],
  signers?: SignerSet,
) {
  // Make sure the account is deployed
  await deploy(config, chain)
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
  sourceChains: Chain[] | undefined,
  targetChain: Chain,
  callInputs: CalldataInput[],
  gasLimit: bigint | undefined,
  tokenRequests: (TokenRequest | NonEvmTokenRequest)[],
  recipient: RhinestoneAccountConfig | Address | NonEvmAddress | undefined,
  signers?: SignerSet,
  sponsored?: Sponsorship,
  eip7702InitSignature?: Hex,
  settlementLayers?: SettlementLayerFilter,
  sourceAssets?: SourceAssetInput,
  feeAsset?: Address | TokenSymbol,
  sourceCalls?: Record<number, SourceCallInput[]>,
) {
  const prepared = await prepareTransactionAsIntent(
    config,
    sourceChains,
    targetChain,
    callInputs,
    gasLimit,
    tokenRequests,
    recipient,
    sponsored ?? false,
    eip7702InitSignature,
    settlementLayers,
    sourceAssets,
    feeAsset,
    undefined,
    undefined,
    signers,
    sourceCalls,
  )
  if (!prepared) {
    throw new OrderPathRequiredForIntentsError()
  }
  const { quotes, intentInput } = prepared
  const quote = quotes.best
  const { originSignatures, destinationSignature } = await signIntent(
    config,
    quote.signData,
    targetChain,
    signers,
  )
  const targetExecutionSignature = await getTargetExecutionSignature(
    config,
    quote.signData,
    targetChain,
    signers,
  )
  const authorizations = config.eoa
    ? await signAuthorizationsInternal(config, {
        sourceChains,
        targetChain,
        eip7702InitSignature,
      })
    : []
  return await submitIntentInternal(
    config,
    sourceChains,
    targetChain,
    quote,
    originSignatures,
    destinationSignature,
    targetExecutionSignature,
    authorizations,
    false,
    intentInput,
  )
}

async function waitForExecution(
  config: RhinestoneConfig,
  result: TransactionResult | UserOperationResult,
): Promise<TransactionStatus | UserOperationReceipt> {
  /** Terminal states: stop polling once the intent is COMPLETED or FAILED. */
  const terminalStatuses: Set<IntentOpStatus['status']> = new Set([
    INTENT_STATUS_FAILED,
    INTENT_STATUS_COMPLETED,
  ])

  switch (result.type) {
    case 'intent': {
      let intentStatus: IntentOpStatus | null = null
      const startTs = Date.now()
      let nextDelayMs = POLL_INITIAL_MS
      let errorBackoffMs = POLL_ERROR_BACKOFF_MS
      while (
        intentStatus === null ||
        !terminalStatuses.has(intentStatus.status)
      ) {
        const orchestrator = getOrchestrator(
          config._authProvider ?? createAuthProvider(config),
          config.endpointUrl,
          config.headers,
        )
        try {
          intentStatus = await orchestrator.getIntent(result.id)
          // reset error backoff on success
          errorBackoffMs = POLL_ERROR_BACKOFF_MS
          const elapsed = Date.now() - startTs
          nextDelayMs =
            elapsed >= POLL_SLOW_AFTER_MS ? POLL_SLOW_MS : POLL_INITIAL_MS
          await new Promise((resolve) => setTimeout(resolve, nextDelayMs))
        } catch (err) {
          if (isRateLimited(err)) {
            const retryAfter = err.retryAfter
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
          // Transport errors (socket closed, connection reset) bubble up
          // untyped from fetch; retry them like server-side 5xx since the
          // intent-status read is idempotent.
          if (isRetryable(err) || isConnectionError(err)) {
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
        throw new IntentFailedError({
          context: {
            intentId: result.id,
            operations: intentStatus.operations,
          },
        })
      }
      return {
        traceId: intentStatus.traceId,
        status: intentStatus.status,
        accountAddress: intentStatus.accountAddress,
        operations: intentStatus.operations,
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

async function getPortfolio(config: RhinestoneConfig, onTestnets: boolean) {
  const address = getAddress(config)
  const orchestrator = getOrchestrator(
    config._authProvider ?? createAuthProvider(config),
    config.endpointUrl,
    config.headers,
  )
  const supportedChainIds = getSupportedChainIds()
  const filteredChainIds = supportedChainIds.filter((id) => {
    try {
      return isTestnet(id) === onTestnets
    } catch {
      return false
    }
  })
  return orchestrator.getPortfolio(address, { chainIds: filteredChainIds })
}

async function getIntentStatus(
  authProvider: AuthProvider,
  endpointUrl: string | undefined,
  intentId: string,
  headers?: Record<string, string>,
): Promise<TransactionStatus> {
  const orchestrator = getOrchestrator(authProvider, endpointUrl, headers)
  const internalStatus = await orchestrator.getIntent(intentId)
  return {
    traceId: internalStatus.traceId,
    status: internalStatus.status,
    accountAddress: internalStatus.accountAddress,
    operations: internalStatus.operations,
  }
}

async function splitIntents(
  authProvider: AuthProvider,
  endpointUrl: string | undefined,
  input: SplitIntentsInput,
  headers?: Record<string, string>,
) {
  const orchestrator = getOrchestrator(authProvider, endpointUrl, headers)
  return orchestrator.getSplit(input)
}

export {
  sendTransactionInternal,
  sendUserOperation,
  sendUserOperationInternal,
  waitForExecution,
  getPortfolio,
  getIntentStatus,
  splitIntents,
  // Errors
  isExecutionError,
  ExecutionError,
  IntentFailedError,
  InvalidSourceCallsError,
  OrderPathRequiredForIntentsError,
  QuoteNotInPreparedTransactionError,
  SessionChainRequiredError,
}
export type { TransactionStatus, TransactionResult, UserOperationResult }
