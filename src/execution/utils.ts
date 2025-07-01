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
  zeroHash,
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
import {
  getOwnableValidator,
  getSocialRecoveryValidator,
  getWebAuthnValidator,
} from '../modules/validators/core'
import {
  getEmptyUserOp,
  getOrchestrator,
  getOrderBundleHash,
} from '../orchestrator'
import {
  DEV_ORCHESTRATOR_URL,
  PROD_ORCHESTRATOR_URL,
} from '../orchestrator/consts'
import { getTokenRootBalanceSlot, isTestnet } from '../orchestrator/registry'
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
  SignerSet,
  TokenRequest,
  Transaction,
} from '../types'
import { getSessionSignature, hashErc7739 } from './smart-session'
import {
  SourceChainRequiredForSmartSessionsError,
  UserOperationRequiredForSmartSessionsError,
  OrderPathRequiredForIntentsError,
} from './error'

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
  orderPath?: OrderPath
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

  const asUserOp = signers?.type === 'guardians' || signers?.type === 'session'
  if (asUserOp) {
    if (!sourceChain) {
      throw new SourceChainRequiredForSmartSessionsError()
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
      throw new SourceChainRequiredForSmartSessionsError()
    }
    const userOp = bundleData.userOp
    if (!userOp) {
      throw new UserOperationRequiredForSmartSessionsError()
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
      throw new SourceChainRequiredForSmartSessionsError()
    }
    const userOp = bundleData.userOp
    if (!userOp) {
      throw new UserOperationRequiredForSmartSessionsError()
    }
    // Smart sessions require a UserOp flow
    return await submitUserOp(
      config,
      sourceChain,
      targetChain,
      userOp,
      signature,
      bundleData.orderPath,
    )
  } else {
    const orderPath = bundleData.orderPath
    if (!orderPath) {
      throw new OrderPathRequiredForIntentsError()
    }
    return await submitIntent(
      config,
      sourceChain,
      targetChain,
      orderPath,
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
    const chain = sourceChain
    const publicClient = createPublicClient({
      chain,
      transport: http(),
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
    const userOp = await bundlerClient.prepareUserOperation({
      account: validatorAccount,
      calls,
    })
    return {
      userOp,
      hash: getUserOperationHash({
        userOperation: userOp,
        chainId: chain.id,
        entryPointAddress: entryPoint07Address,
        entryPointVersion: '0.7',
      }),
    } as BundleData
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
    : undefined

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
  signers?: SignerSet,
) {
  const validator = getValidator(config, signers)
  if (!validator) {
    throw new Error('Validator not available')
  }
  const ownerValidator = getOwnerValidator(config)
  const isRoot = validator.address === ownerValidator.address

  const owners = getOwners(config, signers)
  if (!owners) {
    throw new Error('No owners found')
  }
  const signature = await getPackedSignature(
    config,
    owners,
    sourceChain || targetChain,
    {
      address: validator.address,
      isRoot,
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
  orderPath?: OrderPath,
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
  if (!orderPath) {
    return userOp.signature
  }
  const userOpHash = getUserOperationHash({
    userOperation: userOp,
    chainId: targetChain.id,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: '0.7',
  })
  orderPath[0].orderBundle.segments[0].witness.userOpHash = userOpHash
  const { hash, appDomainSeparator, contentsType, structHash } =
    await hashErc7739(sourceChain, orderPath, accountAddress)

  const owners = getOwners(config, signers)
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
  signature: Hex,
  orderPath?: OrderPath,
) {
  if (!orderPath) {
    const publicClient = createPublicClient({
      chain: sourceChain,
      transport: http(),
    })
    const bundlerClient = getBundlerClient(config, publicClient)
    const hash = await bundlerClient.request({
      method: 'eth_sendUserOperation',
      params: [
        {
          sender: userOp.sender,
          nonce: toHex(userOp.nonce),
          factory: userOp.factory,
          factoryData: userOp.factoryData,
          callData: userOp.callData,
          callGasLimit: toHex(userOp.callGasLimit),
          verificationGasLimit: toHex(userOp.verificationGasLimit),
          preVerificationGas: toHex(userOp.preVerificationGas),
          maxPriorityFeePerGas: toHex(userOp.maxPriorityFeePerGas),
          maxFeePerGas: toHex(userOp.maxFeePerGas),
          paymaster: userOp.paymaster,
          paymasterVerificationGasLimit: userOp.paymasterVerificationGasLimit
            ? toHex(userOp.paymasterVerificationGasLimit)
            : undefined,
          paymasterPostOpGasLimit: userOp.paymasterPostOpGasLimit
            ? toHex(userOp.paymasterPostOpGasLimit)
            : undefined,
          paymasterData: userOp.paymasterData,
          signature,
        },
        entryPoint07Address,
      ],
    })
    return {
      type: 'userop',
      hash,
      sourceChain: sourceChain.id,
      targetChain: targetChain.id,
    } as TransactionResult
  }
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
    : undefined

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
          : zeroHash
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

  const withSession = signers.type === 'session' ? signers : null
  const withGuardians = signers.type === 'guardians' ? signers : null

  return withSession
    ? await getSmartSessionSmartAccount(
        config,
        publicClient,
        chain,
        withSession.session,
        withSession.enableData || null,
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
    return getOwnerValidator(config)
  }

  // Owners
  const withOwner = signers.type === 'owner' ? signers : null
  if (withOwner) {
    // ECDSA
    if (withOwner.kind === 'ecdsa') {
      return getOwnableValidator({
        threshold: 1,
        owners: withOwner.accounts.map((account) => account.address),
      })
    }
    // Passkeys (WebAuthn)
    if (withOwner.kind === 'passkey') {
      const passkeyAccount = withOwner.account
      return getWebAuthnValidator({
        pubKey: passkeyAccount.publicKey,
        authenticatorId: passkeyAccount.id,
      })
    }
  }

  // Smart sessions
  const withSession = signers.type === 'session' ? signers.session : null
  if (withSession) {
    return getSmartSessionValidator(config)
  }

  // Guardians (social recovery)
  const withGuardians = signers.type === 'guardians' ? signers : null
  if (withGuardians) {
    return getSocialRecoveryValidator(withGuardians.guardians)
  }
  // Fallback
  return undefined
}

function getOwners(
  config: RhinestoneAccountConfig,
  signers: SignerSet | undefined,
): OwnerSet | undefined {
  if (!signers) {
    return config.owners
  }

  // Owners
  const withOwner = signers.type === 'owner' ? signers : null
  if (withOwner) {
    // ECDSA
    if (withOwner.kind === 'ecdsa') {
      return {
        type: 'ecdsa',
        accounts: withOwner.accounts,
      }
    }
    // Passkeys (WebAuthn)
    if (withOwner.kind === 'passkey') {
      return {
        type: 'passkey',
        account: withOwner.account,
      }
    }
  }

  // Smart sessions
  const withSession = signers.type === 'session' ? signers.session : null
  if (withSession) {
    return withSession.owners
  }

  // Guardians (social recovery)
  const withGuardians = signers.type === 'guardians' ? signers : null
  if (withGuardians) {
    return {
      type: 'ecdsa',
      accounts: withGuardians.guardians,
    }
  }

  return undefined
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
