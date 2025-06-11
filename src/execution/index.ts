import {
  type Address,
  type Chain,
  concat,
  createPublicClient,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  http,
  keccak256,
  pad,
  size,
  slice,
  toHex,
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
  getBundleInitCode,
  getSmartSessionSmartAccount,
  isDeployed,
  sign,
} from '../accounts'
import { getBundlerClient } from '../accounts/utils'
import { getOwnerValidator } from '../modules'
import { getSmartSessionValidator } from '../modules/validators'
import type {
  BundleResult,
  MetaIntent,
  SignedMultiChainCompact,
} from '../orchestrator'
import {
  BUNDLE_STATUS_COMPLETED,
  BUNDLE_STATUS_FAILED,
  BUNDLE_STATUS_FILLED,
  BUNDLE_STATUS_PRECONFIRMED,
  getEmptyUserOp,
  getOrchestrator,
  getOrderBundleHash,
  getTokenRootBalanceSlot,
} from '../orchestrator'
import {
  DEV_ORCHESTRATOR_URL,
  PROD_ORCHESTRATOR_URL,
} from '../orchestrator/consts'
import {
  getChainById,
  getDefaultAccountAccessList,
  isTestnet,
} from '../orchestrator/registry'
import { BundleStatus, SupportedChain } from '../orchestrator/types'
import type {
  Call,
  RhinestoneAccountConfig,
  Session,
  SignerSet,
  TokenRequest,
  Transaction,
} from '../types'
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
      sourceChain: number
      targetChain: number
    }
  | {
      type: 'bundle'
      id: bigint
      sourceChain?: number
      targetChain: number
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
      sourceChain: sourceChain.id,
      targetChain: targetChain.id,
    } as TransactionResult
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
  // Deploy the account on the target chain
  await deployTarget(targetChain, config, true)
  await enableSmartSession(targetChain, config, withSession)

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

async function sendTransactionAsIntent(
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

  console.dir(orderPath, { depth: null })

  const orderBundleHash = getOrderBundleHash(orderPath[0].orderBundle)
  // const bundleSignature = await sign(
  //   config.owners,
  //   sourceChain || targetChain,
  //   orderBundleHash,
  // )

  const domainSeparatorTypehash =
    '0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218'
  const sourceDomainSeparator = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [domainSeparatorTypehash, BigInt(sourceChain?.id || 0), accountAddress],
    ),
  )
  const targetDomainSeparator = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [domainSeparatorTypehash, BigInt(targetChain.id), accountAddress],
    ),
  )
  // console.log(
  //   'domainHash',
  //   keccak256(
  //     encodeAbiParameters(
  //       [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
  //       [
  //         domainSeparatorTypehash,
  //         BigInt(10),
  //         '0xcBB4aC0F0457761779E8C040023e45C468A70896',
  //       ],
  //     ),
  //   ),
  // )
  const safeMsgTypeHash =
    '0x60b3cbf8b4a223d68d641b3b6ddf9a298e7f33710cf3d3a9d1146b5a6150fbca'
  const sourceMessageData = encodePacked(
    ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
    [
      '0x19',
      '0x01',
      sourceDomainSeparator,
      keccak256(
        encodeAbiParameters(
          [{ type: 'bytes32' }, { type: 'bytes32' }],
          [safeMsgTypeHash, keccak256(orderBundleHash)],
        ),
      ),
    ],
  )
  const targetMessageData = encodePacked(
    ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
    [
      '0x19',
      '0x01',
      targetDomainSeparator,
      keccak256(
        encodeAbiParameters(
          [{ type: 'bytes32' }, { type: 'bytes32' }],
          [safeMsgTypeHash, keccak256(orderBundleHash)],
        ),
      ),
    ],
  )
  const sourceMessageHash = keccak256(sourceMessageData)
  const targetMessageHash = keccak256(targetMessageData)
  const sourceBundleSignature = await sign(
    config.owners,
    // sourceChain || targetChain,
    sourceChain || targetChain,
    sourceMessageHash,
  )
  const targetBundleSignature = await sign(
    config.owners,
    // sourceChain || targetChain,
    targetChain,
    targetMessageHash,
  )
  const safeSourceSignature = toSafeSignature(sourceBundleSignature)
  const safeTargetSignature = toSafeSignature(targetBundleSignature)

  // const validatorModule = getOwnerValidator(config)
  // const packedSig = encodePacked(
  //   ['address', 'bytes'],
  //   [validatorModule.address, bundleSignature],
  // )
  const sourcePackedSig = encodePacked(
    ['address', 'bytes'],
    [zeroAddress, safeSourceSignature],
  )
  const targetPackedSig = encodePacked(
    ['address', 'bytes'],
    [zeroAddress, safeTargetSignature],
  )
  console.log('sig', {
    orderBundleHash,
    sourceMessageData,
    sourceMessageHash,
    sourceBundleSignature,
    safeSourceSignature,
    targetMessageData,
    targetMessageHash,
    targetBundleSignature,
    safeTargetSignature,
  })

  const signedOrderBundle: SignedMultiChainCompact = {
    ...orderPath[0].orderBundle,
    originSignatures: Array(orderPath[0].orderBundle.segments.length).fill(
      sourcePackedSig,
    ),
    targetSignature: targetPackedSig,
  }

  await deployTarget(targetChain, config, false)
  const initCode = getBundleInitCode(config)
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

function toSafeSignature(concatenatedSignature: Hex) {
  const signatureCount = size(concatenatedSignature) / 65
  const signatures = Array.from({ length: signatureCount }, () => '0x' as Hex)
  for (let i = 0; i < signatureCount; i++) {
    const originalSignature = slice(concatenatedSignature, i * 65, (i + 1) * 65)
    const r = slice(originalSignature, 0, 32)
    const s = slice(originalSignature, 32, 64)
    const originalV = slice(originalSignature, 64, 65)
    const v =
      originalV === '0x1c' ? '0x20' : originalV === '0x1b' ? '0x1f' : originalV
    const signature = concat([r, s, v])
    signatures[i] = signature
  }
  signatures.sort()
  return concat(signatures)
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

function getOrchestratorByChain(chainId: number, apiKey: string) {
  const orchestratorUrl = isTestnet(chainId)
    ? DEV_ORCHESTRATOR_URL
    : PROD_ORCHESTRATOR_URL
  return getOrchestrator(apiKey, orchestratorUrl)
}

export {
  sendTransaction,
  waitForExecution,
  getMaxSpendableAmount,
  getPortfolio,
}
export type { TransactionResult }
