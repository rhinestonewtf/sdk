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
  isAddress,
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
} from '../orchestrator'
import {
  PROD_ORCHESTRATOR_URL,
  STAGING_ORCHESTRATOR_URL,
} from '../orchestrator/consts'
import {
  getChainById,
  getTokenAddress,
  isTestnet,
  resolveTokenAddress,
} from '../orchestrator/registry'
import type {
  MappedChainTokenAccessList,
  SettlementLayer,
  SupportedChain,
  UnmappedChainTokenAccessList,
} from '../orchestrator/types'
import type {
  Call,
  CallInput,
  RhinestoneAccountConfig,
  SignerSet,
  SourceAssetInput,
  TokenRequest,
  TokenSymbol,
  Transaction,
} from '../types'
import { getIntentData } from './compact'
import {
  OrderPathRequiredForIntentsError,
  SimulationNotSupportedForUserOpFlowError,
  SourceChainsNotAvailableForUserOpFlowError,
  UserOperationRequiredForSmartSessionsError,
} from './error'

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
    sourceAssets,
    feeAsset,
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
      sourceAssets,
      feeAsset,
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
  const eoa = config.eoa
  if (!eoa) {
    throw new Error('EIP-7702 initialization is required for EOA accounts')
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
    const walletClient = createWalletClient({
      chain,
      account: eoa,
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
  const sourceAssets = transaction.sourceAssets
  const feeAsset = transaction.feeAsset

  const tokenRequests = getTokenRequests(
    sourceChains || [],
    targetChain,
    initialTokenRequests,
    settlementLayers,
  )

  return {
    sourceChains,
    targetChain,
    tokenRequests,
    signers,
    sponsored,
    eip7702InitSignature,
    gasLimit,
    settlementLayers,
    sourceAssets,
    feeAsset,
  }
}

function getTokenRequests(
  sourceChains: Chain[],
  targetChain: Chain,
  initialTokenRequests: TokenRequest[] | undefined,
  settlementLayers: SettlementLayer[] | undefined,
) {
  if (initialTokenRequests) {
    validateTokenSymbols(
      targetChain,
      initialTokenRequests.map((tokenRequest) => tokenRequest.address),
    )
  }
  // Across requires passing some value to repay the solvers
  const defaultTokenRequest = {
    address: zeroAddress,
    amount: 1n,
  }
  const isSameChain =
    (settlementLayers?.length === 1 && settlementLayers[0] === 'SAME_CHAIN') ||
    (sourceChains.length === 1 && sourceChains[0].id === targetChain.id)
  const tokenRequests =
    !initialTokenRequests || initialTokenRequests.length === 0
      ? isSameChain
        ? []
        : [defaultTokenRequest]
      : initialTokenRequests
  return tokenRequests
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
  eip7702InitSignature: Hex | undefined,
  settlementLayers: SettlementLayer[] | undefined,
  sourceAssets: SourceAssetInput | undefined,
  feeAsset: Address | TokenSymbol | undefined,
) {
  const calls = parseCalls(callInputs, targetChain.id)
  const accountAccessList = createAccountAccessList(sourceChains, sourceAssets)

  const { setupOps, delegations } = await getSetupOperationsAndDelegations(
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
      accountType: 'ERC7579',
      setupOps,
      delegations,
    },
    destinationExecutions: calls,
    destinationGasUnits: gasLimit,
    accountAccessList,
    options: {
      topupCompact: false,
      feeToken: feeAsset,
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
  const intentRoute = await orchestrator.getIntentRoute(metaIntent)

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
  const typedData = getIntentData(intentOp)
  if (supportsEip712(validator)) {
    const signature = await getTypedDataPackedSignature(
      config,
      signers,
      targetChain,
      {
        address: validator.address,
        isRoot,
      },
      typedData,
    )
    return signature
  }
  const hash = hashTypedData(typedData)
  const signature = await getPackedSignature(
    config,
    signers,
    targetChain,
    {
      address: validator.address,
      isRoot,
    },
    hash,
  )
  return signature
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

function createAccountAccessList(
  sourceChains: Chain[] | undefined,
  sourceAssets: SourceAssetInput | undefined,
): MappedChainTokenAccessList | UnmappedChainTokenAccessList | undefined {
  if (!sourceChains && !sourceAssets) return undefined
  const chainIds = sourceChains?.map((chain) => chain.id as SupportedChain)
  if (!sourceAssets) {
    return { chainIds }
  }
  if (Array.isArray(sourceAssets)) {
    return chainIds
      ? { chainIds, tokens: sourceAssets }
      : { tokens: sourceAssets }
  }
  return { chainTokens: sourceAssets }
}

async function getSetupOperationsAndDelegations(
  config: RhinestoneAccountConfig,
  chain: Chain,
  accountAddress: Address,
  eip7702InitSignature?: Hex,
) {
  const initCode = getInitCode(config)

  if (config.eoa) {
    // EIP-7702 initialization is only needed for EOA accounts
    if (!eip7702InitSignature || eip7702InitSignature === '0x') {
      throw new Error(
        'EIP-7702 initialization signature is required for EOA accounts',
      )
    }

    const { initData: eip7702InitData, contract: eip7702Contract } =
      await getEip7702InitCall(config, eip7702InitSignature)

    return {
      setupOps: [
        {
          to: accountAddress,
          data: eip7702InitData,
        },
      ],
      delegations: {
        0: {
          contract: eip7702Contract,
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
    // Already deployed contract account
    return {
      setupOps: [],
    }
  }
}

function validateTokenSymbols(
  chain: Chain,
  tokenAddressOrSymbols: (Address | TokenSymbol)[],
) {
  function validateTokenSymbol(
    chain: Chain,
    addressOrSymbol: Address | TokenSymbol,
  ) {
    // Address
    if (isAddress(addressOrSymbol)) {
      return true
    }
    // Token symbol
    const address = getTokenAddress(addressOrSymbol, chain.id)
    return isAddress(address)
  }

  for (const addressOrSymbol of tokenAddressOrSymbols) {
    if (!validateTokenSymbol(chain, addressOrSymbol)) {
      throw new Error(`Invalid token symbol: ${addressOrSymbol}`)
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
  getTokenRequests,
}
export type {
  IntentData,
  TransactionResult,
  PreparedTransactionData,
  SignedTransactionData,
}
