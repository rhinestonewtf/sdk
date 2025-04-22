import {
  Address,
  Chain,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodePacked,
  Hex,
  http,
  keccak256,
  pad,
  toHex,
} from 'viem'
import {
  entryPoint07Address,
  getUserOperationHash,
} from 'viem/account-abstraction'

import {
  type BundleResult,
  type MetaIntent,
  type SignedMultiChainCompact,
  BUNDLE_STATUS_PENDING,
  BUNDLE_STATUS_FAILED,
  getOrchestrator,
  getOrderBundleHash,
  BUNDLE_STATUS_PARTIALLY_COMPLETED,
  getEmptyUserOp,
} from '../orchestrator'
import {
  getAddress,
  isDeployed,
  deploySource,
  deployTarget,
  getBundleInitCode,
  sign,
  getSmartSessionSmartAccount,
  getDeployArgs,
} from '../accounts'
import { getOwnerValidator } from '../modules'
import {
  RhinestoneAccountConfig,
  Transaction,
  Call,
  TokenRequest,
  Session,
  SignerSet,
} from '../types'
import { getBundlerClient } from '../accounts/utils'
import { getSmartSessionValidator } from '../modules/validators'
import { getTokenBalanceSlot } from '../orchestrator'

import {
  enableSmartSession,
  getSessionSignature,
  hashErc7739,
} from './smart-session'

const POLLING_INTERVAL = 500

type TransactionResult =
  | {
      type: 'userop'
      hash: Hex
      sourceChain: Chain
      targetChain: Chain
    }
  | {
      type: 'bundle'
      id: bigint
      sourceChain: Chain
      targetChain: Chain
    }

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
      transaction.tokenRequests,
      transaction.signers,
    )
  }
}

async function sendTransactionInternal(
  config: RhinestoneAccountConfig,
  sourceChain: Chain,
  targetChain: Chain,
  calls: Call[],
  tokenRequests: TokenRequest[],
  signers?: SignerSet,
) {
  const isAccountDeployed = await isDeployed(sourceChain, config)
  if (!isAccountDeployed) {
    await deploySource(sourceChain, config)
  }
  const withSession = signers?.type === 'session' ? signers.session : null
  if (withSession) {
    await enableSmartSession(sourceChain, config, withSession)
  }

  const accountAddress = await getAddress(config)
  if (withSession) {
    // Smart sessions require a UserOp flow
    return await sendTransactionAsUserOp(
      config,
      sourceChain,
      targetChain,
      calls,
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
    await enableSmartSession(targetChain, config, withSession)
    const hash = await bundlerClient.sendUserOperation({
      account: sessionAccount,
      calls,
    })
    return {
      type: 'userop',
      hash,
      sourceChain,
      targetChain,
    } as TransactionResult
  }

  const metaIntent: MetaIntent = {
    targetChainId: targetChain.id,
    tokenTransfers: tokenRequests.map((tokenRequest) => ({
      tokenAddress: tokenRequest.address,
      amount: tokenRequest.amount,
    })),
    targetAccount: accountAddress,
    userOp: getEmptyUserOp(),
  }

  const orchestrator = getOrchestrator(config.rhinestoneApiKey)
  const orderPath = await orchestrator.getOrderPath(metaIntent, accountAddress)
  // Deploy the account on the target chain
  const { factory, factoryData } = await getDeployArgs(config)
  const deployerAccount = config.deployerAccount
  const targetWalletClient = createWalletClient({
    chain: targetChain,
    transport: http(),
  })
  const targetDeployTx = await targetWalletClient.sendTransaction({
    account: deployerAccount,
    to: factory,
    data: factoryData,
  })
  await targetPublicClient.waitForTransactionReceipt({
    hash: targetDeployTx,
  })
  await enableSmartSession(targetChain, config, withSession)

  const userOp = await targetBundlerClient.prepareUserOperation({
    account: targetSessionAccount,
    calls: [...orderPath[0].injectedExecutions, ...calls],
    stateOverride: [
      ...tokenRequests.map((request) => {
        const rootBalanceSlot = getTokenBalanceSlot(
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
  userOp.signature = await targetSessionAccount.signUserOperation(userOp)
  const userOpHash = getUserOperationHash({
    userOperation: userOp,
    chainId: targetChain.id,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: '0.7',
  })
  orderPath[0].orderBundle.segments[0].witness.userOpHash = userOpHash

  const {
    hash,
    appDomainSeparator,
    contentsType,
    structHash,
    orderBundleHash,
  } = await hashErc7739(sourceChain, orderPath, accountAddress)
  const signature = await sign(withSession.owners, targetChain, hash)
  const sessionSignature = getSessionSignature(
    signature,
    appDomainSeparator,
    structHash,
    contentsType,
    withSession,
  )

  const smartSessionValidator = getSmartSessionValidator(config)
  if (!smartSessionValidator) {
    throw new Error('Smart session validator not available')
  }
  const packedSig = encodePacked(
    ['address', 'bytes'],
    [smartSessionValidator.address, sessionSignature],
  )
  // TODO remove
  const isValidSig = await publicClient.verifyMessage({
    address: accountAddress,
    message: orderBundleHash,
    signature: packedSig,
  })
  if (!isValidSig) {
    throw new Error('Invalid signature')
  }
  const signedOrderBundle: SignedMultiChainCompact = {
    ...orderPath[0].orderBundle,
    originSignatures: Array(orderPath[0].orderBundle.segments.length).fill(
      packedSig,
    ),
    targetSignature: packedSig,
  }

  await deployTarget(targetChain, config)
  const bundleResults = await orchestrator.postSignedOrderBundle([
    {
      signedOrderBundle,
      userOp,
    },
  ])

  return {
    type: 'bundle',
    id: bundleResults[0].bundleId,
    sourceChain,
    targetChain,
  } as TransactionResult
}

async function sendTransactionAsIntent(
  config: RhinestoneAccountConfig,
  sourceChain: Chain,
  targetChain: Chain,
  calls: Call[],
  tokenRequests: TokenRequest[],
  accountAddress: Address,
) {
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
  }

  const orchestrator = getOrchestrator(config.rhinestoneApiKey)
  const orderPath = await orchestrator.getOrderPath(metaIntent, accountAddress)
  orderPath[0].orderBundle.segments[0].witness.execs = [
    ...orderPath[0].injectedExecutions,
    ...metaIntent.targetExecutions,
  ]

  const orderBundleHash = getOrderBundleHash(orderPath[0].orderBundle)
  const bundleSignature = await sign(
    config.owners,
    sourceChain,
    orderBundleHash,
  )
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

  await deployTarget(targetChain, config)
  const initCode = await getBundleInitCode(config)
  const bundleResults = await orchestrator.postSignedOrderBundle([
    {
      signedOrderBundle,
      initCode,
    },
  ])

  return {
    type: 'bundle',
    id: bundleResults[0].bundleId,
    sourceChain,
    targetChain,
  } as TransactionResult
}

async function waitForExecution(
  config: RhinestoneAccountConfig,
  result: TransactionResult,
) {
  switch (result.type) {
    case 'bundle': {
      let bundleResult: BundleResult | null = null
      while (
        bundleResult === null ||
        bundleResult.status === BUNDLE_STATUS_PENDING ||
        bundleResult.status === BUNDLE_STATUS_PARTIALLY_COMPLETED
      ) {
        const orchestrator = getOrchestrator(config.rhinestoneApiKey)
        bundleResult = await orchestrator.getBundleStatus(result.id)
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL))
      }
      if (bundleResult.status === BUNDLE_STATUS_FAILED) {
        throw new Error('Bundle failed')
      }
      return bundleResult
    }
    case 'userop': {
      const publicClient = createPublicClient({
        chain: result.sourceChain,
        transport: http(),
      })
      // It's a UserOp hash
      const bundlerClient = getBundlerClient(config, publicClient)
      const receipt = await bundlerClient.waitForUserOperationReceipt({
        hash: result.hash,
      })
      return receipt
    }
  }
}

export { sendTransaction, waitForExecution }
export type { TransactionResult }
