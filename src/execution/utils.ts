import {
  type Address,
  type Chain,
  concat,
  createPublicClient,
  createWalletClient,
  type HashTypedDataParameters,
  type Hex,
  hashMessage,
  hashTypedData,
  type PublicClient,
  publicActions,
  type SignableMessage,
  type SignedAuthorization,
  type SignedAuthorizationList,
  type TypedData,
  toHex,
  zeroAddress,
} from 'viem'
import {
  entryPoint07Address,
  getUserOperationHash,
  type UserOperation,
} from 'viem/account-abstraction'
import {
  getAddress,
  getEip7702InitCall,
  getGuardianSmartAccount,
  getInitCode,
  getPackedSignature,
  signEip7702InitData,
  getSmartAccount,
  getSmartSessionSmartAccount,
  getTypedDataPackedSignature,
  isDeployed,
  toErc6492Signature,
} from '../accounts'
import { createTransport, getBundlerClient } from '../accounts/utils'
import type { Module } from '../modules/common'
import {
  getOwnerValidator,
  getSmartSessionValidator,
} from '../modules/validators'
import {
  getMultiFactorValidator,
  getOwnableValidator,
  getSocialRecoveryValidator,
  getWebAuthnValidator,
  supportsEip712,
} from '../modules/validators/core'
import {
  getOrchestrator,
  type IntentInput,
  type IntentOp,
  type IntentRoute,
  type SignedIntentOp,
  type SupportedChain,
} from '../orchestrator'
import {
  PROD_ORCHESTRATOR_URL,
  STAGING_ORCHESTRATOR_URL,
} from '../orchestrator/consts'
import {
  getChainById,
  isTestnet,
  resolveTokenAddress,
} from '../orchestrator/registry'
import type { SettlementLayer } from '../orchestrator/types'
import type {
  Call,
  CallInput,
  RhinestoneAccountConfig,
  SignerSet,
  TokenRequest,
  Transaction,
} from '../types'
import { getCompactTypedData, getCompactDigest } from './compact'
import {
  OrderPathRequiredForIntentsError,
  SimulationNotSupportedForUserOpFlowError,
  SourceChainsNotAvailableForUserOpFlowError,
  UserOperationRequiredForSmartSessionsError,
} from './error'
import { getTypedData as getPermit2TypedData } from './permit2'

type TransactionResult =
  | {
      type: 'userop'
      hash: Hex
      chain: number
    }
  | {
      type: 'intent'
      id: bigint
      sourceChains?: number[]
      targetChain: number
    }

interface IntentData {
  type: 'intent'
  intentRoute: IntentRoute
}

interface UserOpData {
  type: 'userop'
  hash: Hex
  userOp: UserOperation
}

interface PreparedTransactionData {
  data: IntentData | UserOpData
  transaction: Transaction
}

interface SignedTransactionData extends PreparedTransactionData {
  signature: Hex
}

async function prepareTransaction(
  config: RhinestoneAccountConfig,
  transaction: Transaction,
): Promise<PreparedTransactionData> {
  const {
    sourceChains,
    targetChain,
    tokenRequests,
    signers,
    sponsored,
    eip7702InitSignature,
    settlementLayers,
  } = getTransactionParams(transaction)
  const accountAddress = getAddress(config)

  let data: IntentData | UserOpData

  const asUserOp = signers?.type === 'guardians' || signers?.type === 'session'
  if (asUserOp) {
    if (sourceChains && sourceChains.length > 0) {
      throw new SourceChainsNotAvailableForUserOpFlowError()
    }
    // Smart sessions require a UserOp flow
    data = await prepareTransactionAsUserOp(
      config,
      targetChain,
      transaction.calls,
      signers,
      transaction.gasLimit,
    )
  } else {
    data = await prepareTransactionAsIntent(
      config,
      sourceChains,
      targetChain,
      transaction.calls,
      transaction.gasLimit,
      tokenRequests,
      accountAddress,
      sponsored ?? false,
      eip7702InitSignature,
      settlementLayers,
    )
  }

  return {
    data,
    transaction,
  }
}

async function signTransaction(
  config: RhinestoneAccountConfig,
  preparedTransaction: PreparedTransactionData,
): Promise<SignedTransactionData> {
  const { targetChain, signers } = getTransactionParams(
    preparedTransaction.transaction,
  )
  const data = preparedTransaction.data
  const asUserOp = data.type === 'userop'

  let signature: Hex
  if (asUserOp) {
    const chain = targetChain
    const userOp = data.userOp
    if (!userOp) {
      throw new UserOperationRequiredForSmartSessionsError()
    }
    // Smart sessions require a UserOp flow
    signature = await signUserOp(config, chain, signers, userOp)
  } else {
    signature = await signIntent(
      config,
      targetChain,
      data.intentRoute.intentOp,
      signers,
    )
  }

  return {
    data,
    transaction: preparedTransaction.transaction,
    signature,
  }
}

async function signAuthorizations(
  config: RhinestoneAccountConfig,
  preparedTransaction: PreparedTransactionData,
) {
  return await signAuthorizationsInternal(config, preparedTransaction.data)
}

async function signMessage(
  config: RhinestoneAccountConfig,
  message: SignableMessage,
  chain: Chain,
  signers: SignerSet | undefined,
) {
  const validator = getValidator(config, signers)
  if (!validator) {
    throw new Error('Validator not available')
  }
  const ownerValidator = getOwnerValidator(config)
  const isRoot = validator.address === ownerValidator.address

  const hash = hashMessage(message)
  const signature = await getPackedSignature(
    config,
    signers,
    chain,
    {
      address: validator.address,
      isRoot,
    },
    hash,
  )
  return await toErc6492Signature(config, signature, chain)
}

async function signTypedData<
  typedData extends TypedData | Record<string, unknown> = TypedData,
  primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
>(
  config: RhinestoneAccountConfig,
  parameters: HashTypedDataParameters<typedData, primaryType>,
  chain: Chain,
  signers: SignerSet | undefined,
) {
  const validator = getValidator(config, signers)
  if (!validator) {
    throw new Error('Validator not available')
  }
  const ownerValidator = getOwnerValidator(config)
  const isRoot = validator.address === ownerValidator.address

  const signature = await getTypedDataPackedSignature(
    config,
    signers,
    chain,
    {
      address: validator.address,
      isRoot,
    },
    parameters,
  )
  return await toErc6492Signature(config, signature, chain)
}

async function signAuthorizationsInternal(
  config: RhinestoneAccountConfig,
  data: IntentData | UserOpData,
) {
  if (config.eoa) {
    return []
  }

  const accountAddress = getAddress(config)
  const requiredDelegations =
    data.type === 'intent'
      ? data.intentRoute.intentOp.signedMetadata.account.requiredDelegations ||
        {}
      : {}
  const authorizations: SignedAuthorization[] = []
  for (const chainId in requiredDelegations) {
    const delegation = requiredDelegations[chainId]
    const chain = getChainById(Number(chainId))

    let eoaAccount: any = config.eoa
    if (!eoaAccount) {
      // get EOA account from owners
      if (config.owners.type === 'ecdsa') {
        eoaAccount = config.owners.accounts[0]
      } else if (config.owners.type === 'multi-factor') {
        // for multi-factor, get the first ECDSA account
        const ecdsaValidator = config.owners.validators.find(v => v.type === 'ecdsa')
        if (ecdsaValidator) {
          eoaAccount = ecdsaValidator.accounts[0]
        }
      }
    }
    if (!eoaAccount) {
      throw new Error('No EOA account available for signing authorizations')
    }

    const walletClient = createWalletClient({
      chain,
      account: eoaAccount,
      transport: createTransport(chain, config.provider),
    }).extend(publicActions)
    const code = await walletClient.getCode({
      address: accountAddress,
    })
    const isDelegated =
      code === concat(['0xef0100', delegation.contract.toLowerCase() as Hex])
    if (isDelegated) {
      continue
    }
    const authorization = await walletClient.signAuthorization({
      contractAddress: delegation.contract,
      chainId: Number(chainId),
      account: accountAddress,
    })
    authorizations.push(authorization)
  }
  return authorizations
}

async function submitTransaction(
  config: RhinestoneAccountConfig,
  signedTransaction: SignedTransactionData,
  authorizations: SignedAuthorizationList,
): Promise<TransactionResult> {
  const { data, transaction, signature } = signedTransaction
  const { sourceChains, targetChain } = getTransactionParams(transaction)

  const asUserOp = data.type === 'userop'

  if (asUserOp) {
    const chain = targetChain
    const userOp = data.userOp
    if (!userOp) {
      throw new UserOperationRequiredForSmartSessionsError()
    }
    // Smart sessions require a UserOp flow
    return await submitUserOp(config, chain, userOp, signature)
  } else {
    const intentOp = data.intentRoute.intentOp
    if (!intentOp) {
      throw new OrderPathRequiredForIntentsError()
    }
    return await submitIntent(
      config,
      sourceChains,
      targetChain,
      intentOp,
      signature,
      authorizations,
    )
  }
}

async function simulateTransaction(
  config: RhinestoneAccountConfig,
  signedTransaction: SignedTransactionData,
  authorizations: SignedAuthorizationList,
) {
  const { data, transaction, signature } = signedTransaction
  const { sourceChains, targetChain } = getTransactionParams(transaction)

  const asUserOp = data.type === 'userop'

  if (asUserOp) {
    throw new SimulationNotSupportedForUserOpFlowError()
  } else {
    const intentOp = data.intentRoute.intentOp
    if (!intentOp) {
      throw new OrderPathRequiredForIntentsError()
    }
    return await simulateIntent(
      config,
      sourceChains,
      targetChain,
      intentOp,
      signature,
      authorizations,
    )
  }
}

function getTransactionParams(transaction: Transaction) {
  const sourceChains =
    'chain' in transaction ? [transaction.chain] : transaction.sourceChains
  const targetChain =
    'chain' in transaction ? transaction.chain : transaction.targetChain
  const initialTokenRequests = transaction.tokenRequests
  const signers = transaction.signers
  const eip7702InitSignature = transaction.eip7702InitSignature
  const sponsored = transaction.sponsored
  const gasLimit = transaction.gasLimit
  const settlementLayers = transaction.settlementLayers

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

  return {
    sourceChains,
    targetChain,
    tokenRequests,
    signers,
    sponsored,
    eip7702InitSignature,
    gasLimit,
    settlementLayers,
  }
}

async function prepareTransactionAsUserOp(
  config: RhinestoneAccountConfig,
  chain: Chain,
  callInputs: CallInput[],
  signers: SignerSet | undefined,
  gasLimit: bigint | undefined,
) {
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
  const userOp = await bundlerClient.prepareUserOperation({
    account: validatorAccount,
    calls,
    callGasLimit: gasLimit,
  })
  return {
    type: 'userop',
    userOp,
    hash: getUserOperationHash({
      userOperation: userOp,
      chainId: chain.id,
      entryPointAddress: entryPoint07Address,
      entryPointVersion: '0.7',
    }),
  } as UserOpData
}

async function prepareTransactionAsIntent(
  config: RhinestoneAccountConfig,
  sourceChains: Chain[] | undefined,
  targetChain: Chain,
  callInputs: CallInput[],
  gasLimit: bigint | undefined,
  tokenRequests: TokenRequest[],
  accountAddress: Address,
  isSponsored: boolean,
  eip7702InitSignature?: Hex,
  settlementLayers?: SettlementLayer[],
) {
  const calls = parseCalls(callInputs, targetChain.id)
  const accountAccessList =
    sourceChains && sourceChains.length > 0
      ? {
          chainIds: sourceChains.map((chain) => chain.id as SupportedChain),
          exclude: {
            chainIds: [],
          },
        }
      : undefined

  const { setupOps, delegations = {} } = await getSetupOperationsAndDelegations(
    config,
    targetChain,
    accountAddress,
    eip7702InitSignature,
  )

  const metaIntent: IntentInput = {
    destinationChainId: targetChain.id,
    tokenTransfers: tokenRequests.map((tokenRequest) => ({
      tokenAddress: resolveTokenAddress(tokenRequest.address, targetChain.id),
      amount: tokenRequest.amount,
    })),
    account: {
      address: accountAddress,
      accountType: config.eoa ? 'EOA' : 'ERC7579',
      setupOps,
      delegations,
    },
    destinationExecutions: calls,
    destinationGasUnits: gasLimit,
    accountAccessList,
    options: {
      topupCompact: false,
      sponsorSettings: {
        gasSponsored: isSponsored,
        bridgeFeesSponsored: isSponsored,
        swapFeesSponsored: isSponsored,
      },
      settlementLayers,
    },
  }

  const orchestrator = getOrchestratorByChain(
    targetChain.id,
    config.rhinestoneApiKey,
    config.orchestratorUrl,
  )
  const sigType = config.eoa ? 'eoa' : 'smart-account'
  const intentRoute = await orchestrator.getIntentRoute(metaIntent, sigType)

  return {
    type: 'intent',
    intentRoute,
  } as IntentData
}

async function signIntent(
  config: RhinestoneAccountConfig,
  targetChain: Chain,
  intentOp: IntentOp,
  signers?: SignerSet,
) {
  if (config.eoa) {
    return await getEOASignature(config, intentOp, targetChain)
  }

  const validator = getValidator(config, signers)
  if (!validator) {
    throw new Error('Validator not available')
  }
  const ownerValidator = getOwnerValidator(config)
  const isRoot = validator.address === ownerValidator.address
  const signature = await getIntentSignature(
    config,
    intentOp,
    signers,
    targetChain,
    validator,
    isRoot,
  )
  return signature
}

async function getIntentSignature(
  config: RhinestoneAccountConfig,
  intentOp: IntentOp,
  signers: SignerSet | undefined,
  targetChain: Chain,
  validator: Module,
  isRoot: boolean,
) {
  const withJitFlow = intentOp.elements.some(
    (element) => element.mandate.qualifier.settlementContext?.usingJIT,
  )

  if (withJitFlow) {
    return await getPermit2Signature(
      config,
      intentOp,
      signers,
      targetChain,
      validator,
      isRoot,
    )
  }
  return await getCompactSignature(
    config,
    intentOp,
    signers,
    targetChain,
    validator,
    isRoot,
  )
}

async function getEOASignature(
  config: RhinestoneAccountConfig,
  intentOp: IntentOp,
  targetChain: Chain,
) {
  if (!config.eoa) {
    throw new Error('EOA account is required for EOA signature')
  }

  // eoa permit2: use jit flow with compact digest
  const digest = getCompactDigest(intentOp, {
    usingJIT: true,
    using7579: false,
  })

  const signature = await (config.eoa as any).sign({ hash: digest })
  return signature
}

async function getPermit2Signature(
  config: RhinestoneAccountConfig,
  intentOp: IntentOp,
  signers: SignerSet | undefined,
  targetChain: Chain,
  validator: Module,
  isRoot: boolean,
) {
  const typedData = getPermit2TypedData(intentOp)
  return await signIntentTypedData(
    config,
    signers,
    targetChain,
    validator,
    isRoot,
    typedData,
  )
}

async function getCompactSignature(
  config: RhinestoneAccountConfig,
  intentOp: IntentOp,
  signers: SignerSet | undefined,
  targetChain: Chain,
  validator: Module,
  isRoot: boolean,
) {
  const typedData = getCompactTypedData(intentOp)
  return await signIntentTypedData(
    config,
    signers,
    targetChain,
    validator,
    isRoot,
    typedData,
  )
}

async function signIntentTypedData<
  typedData extends TypedData | Record<string, unknown> = TypedData,
  primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
>(
  config: RhinestoneAccountConfig,
  signers: SignerSet | undefined,
  targetChain: Chain,
  validator: Module,
  isRoot: boolean,
  parameters: HashTypedDataParameters<typedData, primaryType>,
) {
  if (supportsEip712(validator)) {
    return await getTypedDataPackedSignature(
      config,
      signers,
      targetChain,
      {
        address: validator.address,
        isRoot,
      },
      parameters,
    )
  }
  const hash = hashTypedData(parameters)
  return await getPackedSignature(
    config,
    signers,
    targetChain,
    {
      address: validator.address,
      isRoot,
    },
    hash,
  )
}

async function signUserOp(
  config: RhinestoneAccountConfig,
  chain: Chain,
  signers: SignerSet | undefined,
  userOp: UserOperation,
) {
  const validator = getValidator(config, signers)
  if (!validator) {
    throw new Error('Validator not available')
  }

  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, config.provider),
  })
  const account = await getValidatorAccount(
    config,
    signers,
    publicClient,
    chain,
  )
  if (!account) {
    throw new Error('No account found')
  }

  return await account.signUserOperation(userOp)
}

async function submitUserOp(
  config: RhinestoneAccountConfig,
  chain: Chain,
  userOp: UserOperation,
  signature: Hex,
) {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, config.provider),
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
    chain: chain.id,
  } as TransactionResult
}

async function submitIntent(
  config: RhinestoneAccountConfig,
  sourceChains: Chain[] | undefined,
  targetChain: Chain,
  intentOp: IntentOp,
  signature: Hex,
  authorizations: SignedAuthorizationList,
) {
  return submitIntentInternal(
    config,
    sourceChains,
    targetChain,
    intentOp,
    signature,
    authorizations,
  )
}

function getOrchestratorByChain(
  chainId: number,
  apiKey: string | undefined,
  orchestratorUrl?: string,
) {
  if (orchestratorUrl) {
    return getOrchestrator(apiKey, orchestratorUrl)
  }

  const defaultOrchestratorUrl = isTestnet(chainId)
    ? STAGING_ORCHESTRATOR_URL
    : PROD_ORCHESTRATOR_URL
  return getOrchestrator(apiKey, defaultOrchestratorUrl)
}

async function simulateIntent(
  config: RhinestoneAccountConfig,
  sourceChains: Chain[] | undefined,
  targetChain: Chain,
  intentOp: IntentOp,
  signature: Hex,
  authorizations: SignedAuthorizationList,
) {
  return simulateIntentInternal(
    config,
    sourceChains,
    targetChain,
    intentOp,
    signature,
    authorizations,
  )
}

function createSignedIntentOp(
  intentOp: IntentOp,
  signature: Hex,
  authorizations: SignedAuthorizationList,
): SignedIntentOp {
  return {
    ...intentOp,
    originSignatures: Array(intentOp.elements.length).fill(signature),
    destinationSignature: signature,
    signedAuthorizations:
      authorizations.length > 0
        ? authorizations.map((authorization) => ({
            chainId: authorization.chainId,
            address: authorization.address,
            nonce: authorization.nonce,
            yParity: authorization.yParity ?? 0,
            r: authorization.r,
            s: authorization.s,
          }))
        : undefined,
  }
}

async function submitIntentInternal(
  config: RhinestoneAccountConfig,
  sourceChains: Chain[] | undefined,
  targetChain: Chain,
  intentOp: IntentOp,
  signature: Hex,
  authorizations: SignedAuthorizationList,
) {
  const signedIntentOp = createSignedIntentOp(
    intentOp,
    signature,
    authorizations,
  )
  const orchestrator = getOrchestratorByChain(
    targetChain.id,
    config.rhinestoneApiKey,
    config.orchestratorUrl,
  )
  const intentResults = await orchestrator.submitIntent(signedIntentOp)
  return {
    type: 'intent',
    id: BigInt(intentResults.result.id),
    sourceChains: sourceChains?.map((chain) => chain.id),
    targetChain: targetChain.id,
  } as TransactionResult
}

async function simulateIntentInternal(
  config: RhinestoneAccountConfig,
  _sourceChains: Chain[] | undefined,
  targetChain: Chain,
  intentOp: IntentOp,
  signature: Hex,
  authorizations: SignedAuthorizationList,
) {
  const signedIntentOp = createSignedIntentOp(
    intentOp,
    signature,
    authorizations,
  )
  const orchestrator = getOrchestratorByChain(
    targetChain.id,
    config.rhinestoneApiKey,
    config.orchestratorUrl,
  )
  const simulationResults = await orchestrator.simulateIntent(signedIntentOp)
  return simulationResults
}

async function getValidatorAccount(
  config: RhinestoneAccountConfig,
  signers: SignerSet | undefined,
  publicClient: PublicClient,
  chain: Chain,
) {
  if (!signers) {
    return getSmartAccount(config, publicClient, chain)
  }

  // Owners
  const withOwner = signers.type === 'owner' ? signers : null
  if (withOwner) {
    return getSmartAccount(config, publicClient, chain)
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
      return getOwnableValidator(
        1,
        withOwner.accounts.map((account) => account.address),
      )
    }
    // Passkeys (WebAuthn)
    if (withOwner.kind === 'passkey') {
      return getWebAuthnValidator(
        1,
        withOwner.accounts.map((account) => ({
          pubKey: account.publicKey,
          authenticatorId: account.id,
        })),
      )
    }
    // Multi-factor
    if (withOwner.kind === 'multi-factor') {
      return getMultiFactorValidator(1, withOwner.validators)
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

function parseCalls(calls: CallInput[], chainId: number): Call[] {
  return calls.map((call) => ({
    data: call.data ?? '0x',
    value: call.value ?? 0n,
    to: resolveTokenAddress(call.to, chainId),
  }))
}

async function getSetupOperationsAndDelegations(
  config: RhinestoneAccountConfig,
  chain: Chain,
  accountAddress: Address,
  eip7702InitSignature?: Hex,
): Promise<{
  setupOps: { to: Address; data: Hex }[]
  delegations?: Record<number, { contract: Address }>
}> {
  const initCode = getInitCode(config)

  if (config.eoa) {
    const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address
    return {
      setupOps: [],
      delegations: {
        0: {
          contract: PERMIT2_ADDRESS,
        },
      },
    }
  } else if (initCode) {
    const isAccountDeployed = await isDeployed(config, chain)
    if (isAccountDeployed) {
      return {
        setupOps: [],
      }
    }
    // Contract account with init code
    return {
      setupOps: [
        {
          to: initCode.factory,
          data: initCode.factoryData,
        },
      ],
    }
  } else {
    // EIP-7702 account
    const isAccountDeployed = await isDeployed(config, chain)
    if (isAccountDeployed) {
      return {
        setupOps: [],
      }
    }
    const eip7702InitSignature = await signEip7702InitData(config)
    return {
      setupOps: [
        {
          to: accountAddress,
          data: eip7702InitSignature,
        },
      ],
    }
  }
}

export {
  prepareTransaction,
  signTransaction,
  signAuthorizations,
  signAuthorizationsInternal,
  signMessage,
  signTypedData,
  submitTransaction,
  simulateTransaction,
  getOrchestratorByChain,
  signIntent,
  prepareTransactionAsIntent,
  submitIntentInternal,
  simulateIntentInternal,
  getValidatorAccount,
  parseCalls,
}
export type {
  IntentData,
  TransactionResult,
  PreparedTransactionData,
  SignedTransactionData,
}
