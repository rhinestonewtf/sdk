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
  getGuardianSmartAccount,
  getPackedSignature,
  getSmartSessionSmartAccount,
} from '../accounts'
import { getBundlerClient } from '../accounts/utils'
import {
  getOwnerValidator,
  getSmartSessionValidator,
} from '../modules/validators'
import { getSocialRecoveryValidator } from '../modules/validators/core'
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
  OwnableValidatorConfig,
  RhinestoneAccountConfig,
  SignerSet,
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
  const { sourceChain, targetChain, tokenRequests, signers } =
    getTransactionParams(transaction)
  const accountAddress = getAddress(config)

  let bundleData: BundleData

  if (signers) {
    if (!sourceChain) {
      throw new Error(
        `Specifying source chain is required when using smart sessions or guardians`,
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
      signers,
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
  const { sourceChain, targetChain, signers } = getTransactionParams(
    preparedTransaction.transaction,
  )
  const withSession = signers?.type === 'session' ? signers.session : null
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
      signers,
      userOp,
      bundleData.orderPath,
    )
  } else {
    signature = await signIntent(
      config,
      sourceChain,
      targetChain,
      bundleData.hash,
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
  const { sourceChain, targetChain, signers } =
    getTransactionParams(transaction)
  const withSession = signers?.type === 'session' ? signers.session : null

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
  const signers = transaction.signers

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
    signers,
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
  signers: SignerSet | undefined,
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
    signers,
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
) {
  const validatorModule = getOwnerValidator(config)
  const signature = await getPackedSignature(
    config,
    config.owners,
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
  signers: SignerSet | undefined,
  userOp: UserOperation,
  orderPath: OrderPath,
) {
  const validator = getValidator(config, signers)
  if (!validator) {
    throw new Error('Validator not available')
  }

  const targetPublicClient = createPublicClient({
    chain: targetChain,
    transport: http(),
  })
  const targetAccount = await getValidatorAccount(
    config,
    signers,
    targetPublicClient,
    targetChain,
  )
  if (!targetAccount) {
    throw new Error('No account found')
  }

  userOp.signature = await targetAccount.signUserOperation(userOp)
  const userOpHash = getUserOperationHash({
    userOperation: userOp,
    chainId: targetChain.id,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: '0.7',
  })
  orderPath[0].orderBundle.segments[0].witness.userOpHash = userOpHash
  const { hash, appDomainSeparator, contentsType, structHash } =
    await hashErc7739(sourceChain, orderPath, accountAddress)

  const owners = getOwners(signers)
  if (!owners) {
    throw new Error('No owners found')
  }
  const signature = await getPackedSignature(
    config,
    owners,
    targetChain,
    {
      address: validator.address,
      isRoot: false,
    },
    hash,
    (signature) => {
      const sessionData = signers?.type === 'session' ? signers.session : null
      return sessionData
        ? getSessionSignature(
            signature,
            appDomainSeparator,
            structHash,
            contentsType,
            sessionData,
          )
        : signature
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
  signers: SignerSet | undefined,
  orderPath: OrderPath,
  calls: Call[],
  tokenRequests: TokenRequest[],
  accountAddress: Address,
) {
  const targetPublicClient = createPublicClient({
    chain: targetChain,
    transport: http(),
  })
  const targetAccount = await getValidatorAccount(
    config,
    signers,
    targetPublicClient,
    targetChain,
  )
  if (!targetAccount) {
    throw new Error('No account found')
  }
  const targetBundlerClient = getBundlerClient(config, targetPublicClient)

  return await targetBundlerClient.prepareUserOperation({
    account: targetAccount,
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

async function getValidatorAccount(
  config: RhinestoneAccountConfig,
  signers: SignerSet | undefined,
  publicClient: any,
  chain: Chain,
) {
  if (!signers) {
    return undefined
  }

  const withSession = signers.type === 'session' ? signers.session : null
  const withGuardians = signers.type === 'guardians' ? signers : null

  return withSession
    ? await getSmartSessionSmartAccount(
        config,
        publicClient,
        chain,
        withSession,
      )
    : withGuardians
      ? await getGuardianSmartAccount(config, publicClient, chain, {
          type: 'ecdsa',
          accounts: withGuardians.guardians,
        })
      : null
}

function getValidator(
  config: RhinestoneAccountConfig,
  signers: SignerSet | undefined,
) {
  if (!signers) {
    return undefined
  }

  const withSession = signers.type === 'session' ? signers.session : null
  const withGuardians = signers.type === 'guardians' ? signers : null

  return withSession
    ? getSmartSessionValidator(config)
    : withGuardians
      ? getSocialRecoveryValidator(withGuardians.guardians)
      : undefined
}

function getOwners(
  signers: SignerSet | undefined,
): OwnableValidatorConfig | undefined {
  if (!signers) {
    return undefined
  }

  const withSession = signers.type === 'session' ? signers.session : null
  const withGuardians = signers.type === 'guardians' ? signers : null

  return withSession
    ? withSession.owners.type === 'ecdsa'
      ? withSession.owners
      : undefined
    : withGuardians
      ? ({
          type: 'ecdsa',
          accounts: withGuardians.guardians,
        } as OwnableValidatorConfig)
      : undefined
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
  getValidatorAccount,
}
export type {
  BundleData,
  TransactionResult,
  PreparedTransactionData,
  SignedTransactionData,
}
