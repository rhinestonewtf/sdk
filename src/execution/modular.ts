import {
  Address,
  Chain,
  createPublicClient,
  encodeAbiParameters,
  encodePacked,
  Hex,
  http,
  keccak256,
  pad,
  toHex,
  zeroAddress,
} from 'viem'
import {
  Call,
  RhinestoneAccountConfig,
  Session,
  TokenRequest,
  Transaction,
} from '../types'
import {
  getAddress,
  getBundleInitCode,
  getSmartSessionSmartAccount,
  sign,
} from '../accounts'
import {
  MetaIntent,
  OrderPath,
  SignedMultiChainCompact,
  SupportedChain,
} from '../orchestrator/types'
import {
  getDefaultAccountAccessList,
  getTokenRootBalanceSlot,
  isTestnet,
} from '../orchestrator/registry'
import {
  getEmptyUserOp,
  getOrchestrator,
  getOrderBundleHash,
} from '../orchestrator'
import {
  DEV_ORCHESTRATOR_URL,
  PROD_ORCHESTRATOR_URL,
} from '../orchestrator/consts'
import { getSessionSignature, hashErc7739 } from './smart-session'
import {
  entryPoint07Address,
  getUserOperationHash,
  UserOperation,
} from 'viem/account-abstraction'
import { getBundlerClient } from '../accounts/utils'
import {
  getOwnerValidator,
  getSmartSessionValidator,
} from '../modules/validators'
import type { TransactionResult } from '.'

interface BundleData {
  hash: Hex
  orderPath: OrderPath
  userOp?: UserOperation
}

async function prepareTransaction(
  config: RhinestoneAccountConfig,
  transaction: Transaction,
) {
  const sourceChain =
    'chain' in transaction ? transaction.chain : transaction.sourceChain
  const targetChain =
    'chain' in transaction ? transaction.chain : transaction.targetChain
  const initialTokenRequests = transaction.tokenRequests
  const withSession =
    transaction.signers?.type === 'session' ? transaction.signers.session : null
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

  if (withSession) {
    if (!sourceChain) {
      throw new Error(
        `Specifying source chain is required when using smart sessions`,
      )
    }
    // Smart sessions require a UserOp flow
    return await prepareTransactionAsUserOp(
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
    return await prepareTransactionAsIntent(
      config,
      sourceChain,
      targetChain,
      transaction.calls,
      transaction.gasLimit,
      tokenRequests,
      accountAddress,
    )
  }
}

async function signTransaction(
  config: RhinestoneAccountConfig,
  transaction: Transaction,
  bundleData: BundleData,
) {
  const sourceChain =
    'chain' in transaction ? transaction.chain : transaction.sourceChain
  const targetChain =
    'chain' in transaction ? transaction.chain : transaction.targetChain
  const withSession =
    transaction.signers?.type === 'session' ? transaction.signers.session : null
  const accountAddress = getAddress(config)

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
    return await signUserOp(
      config,
      sourceChain,
      targetChain,
      accountAddress,
      withSession,
      userOp,
      bundleData.orderPath,
    )
  } else {
    return await signIntent(config, sourceChain, targetChain, bundleData.hash)
  }
}

async function submitTransaction(
  config: RhinestoneAccountConfig,
  transaction: Transaction,
  bundleData: BundleData,
  signature: Hex,
) {
  const sourceChain =
    'chain' in transaction ? transaction.chain : transaction.sourceChain
  const targetChain =
    'chain' in transaction ? transaction.chain : transaction.targetChain
  const withSession =
    transaction.signers?.type === 'session' ? transaction.signers.session : null
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

  if (sourceChain.id === targetChain.id) {
    throw new Error(
      'Source and target chains cannot be the same when using user operations',
    )
  }

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

  const orchestrator = getOrchestratorByChain(
    targetChain.id,
    config.rhinestoneApiKey,
  )
  const orderPath = await orchestrator.getOrderPath(metaIntent, accountAddress)

  const userOp = await targetBundlerClient.prepareUserOperation({
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
  const signature = await sign(
    config.owners,
    sourceChain || targetChain,
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
  const signature = await sign(withSession.owners, targetChain, hash)
  const sessionSignature = getSessionSignature(
    signature,
    appDomainSeparator,
    structHash,
    contentsType,
    withSession,
  )

  return sessionSignature
}

async function submitUserOp(
  config: RhinestoneAccountConfig,
  sourceChain: Chain,
  targetChain: Chain,
  userOp: UserOperation,
  orderPath: OrderPath,
  sessionSignature: Hex,
) {
  const smartSessionValidator = getSmartSessionValidator(config)
  if (!smartSessionValidator) {
    throw new Error('Smart session validator not available')
  }
  const packedSig = encodePacked(
    ['address', 'bytes'],
    [smartSessionValidator.address, sessionSignature],
  )
  const signedOrderBundle: SignedMultiChainCompact = {
    ...orderPath[0].orderBundle,
    originSignatures: Array(orderPath[0].orderBundle.segments.length).fill(
      packedSig,
    ),
    targetSignature: packedSig,
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
  bundleSignature: Hex,
) {
  const validatorModule = getOwnerValidator(config)
  const packedSig = encodePacked(
    ['address', 'bytes'],
    [validatorModule.address, bundleSignature],
  )
  const signedOrderBundle: SignedMultiChainCompact = {
    ...orderPath[0].orderBundle,
    originSignatures: Array(orderPath[0].orderBundle.segments.length).fill(
      packedSig,
    ),
    targetSignature: packedSig,
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

function getOrchestratorByChain(chainId: number, apiKey: string) {
  const orchestratorUrl = isTestnet(chainId)
    ? DEV_ORCHESTRATOR_URL
    : PROD_ORCHESTRATOR_URL
  return getOrchestrator(apiKey, orchestratorUrl)
}

export { prepareTransaction, signTransaction, submitTransaction }
export type { BundleData }
