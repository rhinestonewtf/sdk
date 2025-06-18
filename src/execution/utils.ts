import {
  Address,
  Chain,
  createPublicClient,
  encodeAbiParameters,
  Hex,
  http,
  keccak256,
  pad,
  toHex,
  zeroAddress,
} from 'viem'
import {
  entryPoint07Address,
  getUserOperationHash,
  UserOperation,
} from 'viem/account-abstraction'
import {
  deployTarget,
  getAddress,
  getBundleInitCode,
  getPackedSignature,
  getSmartSessionSmartAccount,
} from '../accounts'
import { getBundlerClient } from '../accounts/utils'
import {
  getOwnerValidator,
  getSmartSessionValidator,
} from '../modules/validators'
import {
  getEmptyUserOp,
  getOrchestrator,
  getOrderBundleHash,
} from '../orchestrator'
import {
  DEV_ORCHESTRATOR_URL,
  PROD_ORCHESTRATOR_URL,
} from '../orchestrator/consts'
import {
  getDefaultAccountAccessList,
  getTokenRootBalanceSlot,
  isTestnet,
} from '../orchestrator/registry'
import {
  MetaIntent,
  OrderPath,
  SignedMultiChainCompact,
  SupportedChain,
} from '../orchestrator/types'
import {
  Call,
  OwnerSet,
  RhinestoneAccountConfig,
  Session,
  TokenRequest,
  Transaction,
} from '../types'

import { getSessionSignature, hashErc7739 } from './smart-session'

type TransactionResult =
  | {
      type: 'userop'
      hash: Hex
      sourceChain: number
      targetChain: number
    }
  | {
      type: 'bundle'
      id: bigint
      sourceChain?: number
      targetChain: number
    }

interface BundleData {
  hash: Hex
  orderPath: OrderPath
  userOp?: UserOperation
}

interface PreparedTransactionData {
  bundleData: BundleData
  transaction: Transaction
}

interface SignedTransactionData extends PreparedTransactionData {
  signature: Hex
}

async function prepareTransaction(
  config: RhinestoneAccountConfig,
  transaction: Transaction,
): Promise<PreparedTransactionData> {
  const { sourceChain, targetChain, tokenRequests, withSession } =
    getTransactionParams(transaction)
  const accountAddress = getAddress(config)

  let bundleData: BundleData

  if (withSession) {
    if (!sourceChain) {
      throw new Error(
        `Specifying source chain is required when using smart sessions`,
      )
    }
    // Smart sessions require a UserOp flow
    bundleData = await prepareTransactionAsUserOp(
      config,
      sourceChain,
      targetChain,
      transaction.calls,
      transaction.gasLimit,
      tokenRequests,
      accountAddress,
      withSession,
    )
  } else {
    bundleData = await prepareTransactionAsIntent(
      config,
      sourceChain,
      targetChain,
      transaction.calls,
      transaction.gasLimit,
      tokenRequests,
      accountAddress,
    )
  }

  return {
    bundleData,
    transaction,
  }
}

async function signTransaction(
  config: RhinestoneAccountConfig,
  preparedTransaction: PreparedTransactionData,
): Promise<SignedTransactionData> {
  const { sourceChain, targetChain, withSession } = getTransactionParams(
    preparedTransaction.transaction,
  )
  const bundleData = preparedTransaction.bundleData
  const accountAddress = getAddress(config)

  let signature: Hex

  if (withSession) {
    if (!sourceChain) {
      throw new Error(
        `Specifying source chain is required when using smart sessions`,
      )
    }
    const userOp = bundleData.userOp
    if (!userOp) {
      throw new Error(`User operation is required when using smart sessions`)
    }
    // Smart sessions require a UserOp flow
    signature = await signUserOp(
      config,
      sourceChain,
      targetChain,
      accountAddress,
      withSession,
      userOp,
      bundleData.orderPath,
    )
  } else {
    const withSigners = preparedTransaction.transaction.signers?.type !== 'session'
      ? preparedTransaction.transaction.signers
      : undefined
    signature = await signIntent(
      config,
      sourceChain,
      targetChain,
      bundleData.hash,
      withSigners
    )
  }

  return {
    bundleData,
    transaction: preparedTransaction.transaction,
    signature,
  }
}

async function submitTransaction(
  config: RhinestoneAccountConfig,
  signedTransaction: SignedTransactionData,
): Promise<TransactionResult> {
  const { bundleData, transaction, signature } = signedTransaction
  const { sourceChain, targetChain, withSession } =
    getTransactionParams(transaction)

  if (withSession) {
    if (!sourceChain) {
      throw new Error(
        `Specifying source chain is required when using smart sessions`,
      )
    }
    const userOp = bundleData.userOp
    if (!userOp) {
      throw new Error(`User operation is required when using smart sessions`)
    }
    // Smart sessions require a UserOp flow
    return await submitUserOp(
      config,
      sourceChain,
      targetChain,
      userOp,
      bundleData.orderPath,
      signature,
    )
  } else {
    return await submitIntent(
      config,
      sourceChain,
      targetChain,
      bundleData.orderPath,
      signature,
    )
  }
}

function getTransactionParams(transaction: Transaction) {
  const sourceChain =
    'chain' in transaction ? transaction.chain : transaction.sourceChain
  const targetChain =
    'chain' in transaction ? transaction.chain : transaction.targetChain
  const initialTokenRequests = transaction.tokenRequests
  const withSession =
    transaction.signers?.type === 'session' ? transaction.signers.session : null

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

  return {
    sourceChain,
    targetChain,
    tokenRequests,
    withSession,
  }
}

async function prepareTransactionAsUserOp(
  config: RhinestoneAccountConfig,
  sourceChain: Chain,
  targetChain: Chain,
  calls: Call[],
  gasLimit: bigint | undefined,
  tokenRequests: TokenRequest[],
  accountAddress: Address,
  withSession: Session,
) {
  if (sourceChain.id === targetChain.id) {
    throw new Error(
      'Source and target chains cannot be the same when using user operations',
    )
  }

  const orderPath = await getUserOpOrderPath(
    sourceChain,
    targetChain,
    tokenRequests,
    accountAddress,
    gasLimit,
    config.rhinestoneApiKey,
  )
  const userOp = await getUserOp(
    config,
    targetChain,
    withSession,
    orderPath,
    calls,
    tokenRequests,
    accountAddress,
  )

  const hash = getUserOperationHash({
    userOperation: userOp,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: '0.7',
    chainId: targetChain.id,
  })

  return {
    orderPath,
    userOp,
    hash,
  } as BundleData
}

async function prepareTransactionAsIntent(
  config: RhinestoneAccountConfig,
  sourceChain: Chain | undefined,
  targetChain: Chain,
  calls: Call[],
  gasLimit: bigint | undefined,
  tokenRequests: TokenRequest[],
  accountAddress: Address,
) {
  const accountAccessList = sourceChain
    ? {
        chainIds: [sourceChain.id as SupportedChain],
      }
    : getDefaultAccountAccessList()

  const metaIntent: MetaIntent = {
    targetChainId: targetChain.id,
    tokenTransfers: tokenRequests.map((tokenRequest) => ({
      tokenAddress: tokenRequest.address,
      amount: tokenRequest.amount,
    })),
    targetAccount: accountAddress,
    targetExecutions: calls.map((call) => ({
      value: call.value ?? 0n,
      to: call.to,
      data: call.data ?? '0x',
    })),
    targetGasUnits: gasLimit,
    accountAccessList,
  }

  const orchestrator = getOrchestratorByChain(
    targetChain.id,
    config.rhinestoneApiKey,
  )
  const orderPath = await orchestrator.getOrderPath(metaIntent, accountAddress)
  orderPath[0].orderBundle.segments[0].witness.execs = [
    ...orderPath[0].injectedExecutions,
    ...metaIntent.targetExecutions,
  ]

  const orderBundleHash = getOrderBundleHash(orderPath[0].orderBundle)

  return {
    orderPath,
    hash: orderBundleHash,
  } as BundleData
}

async function signIntent(
  config: RhinestoneAccountConfig,
  sourceChain: Chain | undefined,
  targetChain: Chain,
  bundleHash: Hex,
  signers?: OwnerSet | undefined,
) {
  const validatorModule = getOwnerValidator(config)
  const signature = await getPackedSignature(
    config,
    signers || config.owners,
    sourceChain || targetChain,
    {
      address: validatorModule.address,
      isRoot: true,
    },
    bundleHash,
  )
  return signature
}

async function signUserOp(
  config: RhinestoneAccountConfig,
  sourceChain: Chain,
  targetChain: Chain,
  accountAddress: Address,
  withSession: Session,
  userOp: UserOperation,
  orderPath: OrderPath,
) {
  const smartSessionValidator = getSmartSessionValidator(config)
  if (!smartSessionValidator) {
    throw new Error('Smart session validator not available')
  }

  const targetPublicClient = createPublicClient({
    chain: targetChain,
    transport: http(),
  })
  const targetSessionAccount = await getSmartSessionSmartAccount(
    config,
    targetPublicClient,
    targetChain,
    withSession,
  )

  userOp.signature = await targetSessionAccount.signUserOperation(userOp)
  const userOpHash = getUserOperationHash({
    userOperation: userOp,
    chainId: targetChain.id,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: '0.7',
  })
  orderPath[0].orderBundle.segments[0].witness.userOpHash = userOpHash
  const { hash, appDomainSeparator, contentsType, structHash } =
    await hashErc7739(sourceChain, orderPath, accountAddress)

  const signature = await getPackedSignature(
    config,
    withSession.owners,
    targetChain,
    {
      address: smartSessionValidator.address,
      isRoot: false,
    },
    hash,
    (signature) => {
      return getSessionSignature(
        signature,
        appDomainSeparator,
        structHash,
        contentsType,
        withSession,
      )
    },
  )

  return signature
}

async function submitUserOp(
  config: RhinestoneAccountConfig,
  sourceChain: Chain,
  targetChain: Chain,
  userOp: UserOperation,
  orderPath: OrderPath,
  signature: Hex,
) {
  const signedOrderBundle: SignedMultiChainCompact = {
    ...orderPath[0].orderBundle,
    originSignatures: Array(orderPath[0].orderBundle.segments.length).fill(
      signature,
    ),
    targetSignature: signature,
  }
  const orchestrator = getOrchestratorByChain(
    targetChain.id,
    config.rhinestoneApiKey,
  )
  const bundleResults = await orchestrator.postSignedOrderBundle([
    {
      signedOrderBundle,
      userOp,
    },
  ])
  return {
    type: 'bundle',
    id: bundleResults[0].bundleId,
    sourceChain: sourceChain.id,
    targetChain: targetChain.id,
  } as TransactionResult
}

async function submitIntent(
  config: RhinestoneAccountConfig,
  sourceChain: Chain | undefined,
  targetChain: Chain,
  orderPath: OrderPath,
  signature: Hex,
) {
  return submitIntentInternal(
    config,
    sourceChain,
    targetChain,
    orderPath,
    signature,
    false,
  )
}

function getOrchestratorByChain(chainId: number, apiKey: string) {
  const orchestratorUrl = isTestnet(chainId)
    ? DEV_ORCHESTRATOR_URL
    : PROD_ORCHESTRATOR_URL
  return getOrchestrator(apiKey, orchestratorUrl)
}

async function getUserOpOrderPath(
  sourceChain: Chain,
  targetChain: Chain,
  tokenRequests: TokenRequest[],
  accountAddress: Address,
  gasLimit: bigint | undefined,
  rhinestoneApiKey: string,
) {
  const accountAccessList = sourceChain
    ? {
        chainIds: [sourceChain.id as SupportedChain],
      }
    : getDefaultAccountAccessList()

  const metaIntent: MetaIntent = {
    targetChainId: targetChain.id,
    tokenTransfers: tokenRequests.map((tokenRequest) => ({
      tokenAddress: tokenRequest.address,
      amount: tokenRequest.amount,
    })),
    targetAccount: accountAddress,
    targetGasUnits: gasLimit,
    userOp: getEmptyUserOp(),
    accountAccessList,
  }

  const orchestrator = getOrchestratorByChain(targetChain.id, rhinestoneApiKey)
  const orderPath = await orchestrator.getOrderPath(metaIntent, accountAddress)
  return orderPath
}

async function getUserOp(
  config: RhinestoneAccountConfig,
  targetChain: Chain,
  withSession: Session,
  orderPath: OrderPath,
  calls: Call[],
  tokenRequests: TokenRequest[],
  accountAddress: Address,
) {
  const targetPublicClient = createPublicClient({
    chain: targetChain,
    transport: http(),
  })
  const targetSessionAccount = await getSmartSessionSmartAccount(
    config,
    targetPublicClient,
    targetChain,
    withSession,
  )
  const targetBundlerClient = getBundlerClient(config, targetPublicClient)

  return await targetBundlerClient.prepareUserOperation({
    account: targetSessionAccount,
    calls: [...orderPath[0].injectedExecutions, ...calls],
    stateOverride: [
      ...tokenRequests.map((request) => {
        const rootBalanceSlot = getTokenRootBalanceSlot(
          targetChain,
          request.address,
        )
        const balanceSlot = rootBalanceSlot
          ? keccak256(
              encodeAbiParameters(
                [{ type: 'address' }, { type: 'uint256' }],
                [accountAddress, rootBalanceSlot],
              ),
            )
          : '0x'
        return {
          address: request.address,
          stateDiff: [
            {
              slot: balanceSlot,
              value: pad(toHex(request.amount)),
            },
          ],
        }
      }),
    ],
  })
}

async function submitIntentInternal(
  config: RhinestoneAccountConfig,
  sourceChain: Chain | undefined,
  targetChain: Chain,
  orderPath: OrderPath,
  signature: Hex,
  deploy: boolean,
) {
  const signedOrderBundle: SignedMultiChainCompact = {
    ...orderPath[0].orderBundle,
    originSignatures: Array(orderPath[0].orderBundle.segments.length).fill(
      signature,
    ),
    targetSignature: signature,
  }
  if (deploy) {
    await deployTarget(targetChain, config, false)
  }
  const initCode = getBundleInitCode(config)
  const orchestrator = getOrchestratorByChain(
    targetChain.id,
    config.rhinestoneApiKey,
  )
  const bundleResults = await orchestrator.postSignedOrderBundle([
    {
      signedOrderBundle,
      initCode,
    },
  ])
  return {
    type: 'bundle',
    id: bundleResults[0].bundleId,
    sourceChain: sourceChain?.id,
    targetChain: targetChain.id,
  } as TransactionResult
}

export {
  prepareTransaction,
  signTransaction,
  submitTransaction,
  getOrchestratorByChain,
  getUserOpOrderPath,
  getUserOp,
  signIntent,
  signUserOp,
  submitUserOp,
  prepareTransactionAsIntent,
  submitIntentInternal,
}
export type {
  BundleData,
  TransactionResult,
  PreparedTransactionData,
  SignedTransactionData,
}
