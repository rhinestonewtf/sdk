import {
  type Address,
  type Chain,
  concat,
  createPublicClient,
  createWalletClient,
  encodePacked,
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
  type TypedDataDomain,
  toHex,
  zeroAddress,
} from 'viem'
import {
  entryPoint07Address,
  getUserOperationHash,
  type UserOperation,
} from 'viem/account-abstraction'
import { wrapTypedDataSignature } from 'viem/experimental/erc7739'
import {
  EoaSigningMethodNotConfiguredError,
  getAddress,
  getEip712Domain,
  getEip7702InitCall,
  getGuardianSmartAccount,
  getInitCode,
  getPackedSignature,
  getSmartAccount,
  getSmartSessionSmartAccount,
  getTypedDataPackedSignature,
  is7702,
  toErc6492Signature,
} from '../accounts'
import {
  createTransport,
  getBundlerClient,
  type ValidatorConfig,
} from '../accounts/utils'
import { getIntentExecutor } from '../modules'
import type { Module } from '../modules/common'
import {
  getOwnerValidator,
  getPermissionId,
  getSmartSessionValidator,
} from '../modules/validators'
import {
  getMultiFactorValidator,
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
  AccountProviderConfig,
  Call,
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
import { getCompactTypedData, getPermit2Digest } from './compact'
import { SignerNotSupportedError } from './error'
import { getTypedData as getPermit2TypedData } from './permit2'
import { getTypedData as getSingleChainOpsTypedData } from './singleChainOps'

interface UserOperationResult {
  type: 'userop'
  hash: Hex
  chain: number
}

interface TransactionResult {
  type: 'intent'
  id: bigint
  sourceChains?: number[]
  targetChain: number
}

interface PreparedTransactionData {
  intentRoute: IntentRoute
  transaction: Transaction
}

interface PreparedUserOperationData {
  userOperation: UserOperation
  hash: Hex
  transaction: UserOperationTransaction
}

interface SignedTransactionData extends PreparedTransactionData {
  originSignatures: Hex[]
  destinationSignature: Hex
}

interface SignedUserOperationData extends PreparedUserOperationData {
  signature: Hex
}

async function prepareTransaction(
  config: RhinestoneConfig,
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
    lockFunds,
    account,
    recipient,
  } = getTransactionParams(transaction)
  const accountAddress = getAddress(config)
  // const recipientAddress = recipient ? getAddress(recipient) : undefined

  const isUserOpSigner =
    signers?.type === 'guardians' || signers?.type === 'session'
  if (isUserOpSigner) {
    throw new SignerNotSupportedError()
  }
  const intentRoute = await prepareTransactionAsIntent(
    config,
    sourceChains,
    targetChain,
    await resolveCallInputs(
      transaction.calls,
      config,
      targetChain,
      accountAddress,
    ),
    transaction.gasLimit,
    tokenRequests,
    recipient,
    accountAddress,
    sponsored ?? false,
    eip7702InitSignature,
    settlementLayers,
    sourceAssets,
    feeAsset,
    lockFunds,
    account,
  )

  return {
    intentRoute,
    transaction,
  }
}

async function prepareUserOperation(
  config: RhinestoneConfig,
  transaction: UserOperationTransaction,
): Promise<PreparedUserOperationData> {
  const chain = transaction.chain
  const signers = transaction.signers
  const accountAddress = getAddress(config)
  const data = await prepareTransactionAsUserOp(
    config,
    chain,
    await resolveCallInputs(transaction.calls, config, chain, accountAddress),
    signers,
    transaction.gasLimit,
  )
  return {
    userOperation: data.userOp,
    hash: data.hash,
    transaction,
  }
}

async function resolveCallInputs(
  inputs: CallInput[],
  config: RhinestoneConfig,
  chain: Chain,
  accountAddress: Address,
): Promise<CalldataInput[]> {
  const resolved: CalldataInput[] = []
  for (const intent of inputs) {
    if ('resolve' in intent) {
      const result = await intent.resolve({ config, chain, accountAddress })
      if (Array.isArray(result)) {
        resolved.push(...result)
      } else if (result) {
        resolved.push(result)
      }
    } else {
      resolved.push(intent as CalldataInput)
    }
  }
  return resolved
}

async function signTransaction(
  config: RhinestoneConfig,
  preparedTransaction: PreparedTransactionData,
): Promise<SignedTransactionData> {
  const { targetChain, signers } = getTransactionParams(
    preparedTransaction.transaction,
  )
  const intentRoute = preparedTransaction.intentRoute
  const { originSignatures, destinationSignature } = await signIntent(
    config,
    targetChain,
    intentRoute.intentOp,
    signers,
  )

  return {
    intentRoute,
    transaction: preparedTransaction.transaction,
    originSignatures,
    destinationSignature,
  }
}

async function signUserOperation(
  config: RhinestoneConfig,
  preparedUserOperation: PreparedUserOperationData,
): Promise<SignedUserOperationData> {
  const chain = preparedUserOperation.transaction.chain
  const userOp = preparedUserOperation.userOperation
  const signers = preparedUserOperation.transaction.signers
  // Smart sessions require a UserOp flow
  const signature = await signUserOp(config, chain, signers, userOp)
  return {
    userOperation: preparedUserOperation.userOperation,
    hash: preparedUserOperation.hash,
    transaction: preparedUserOperation.transaction,
    signature,
  }
}

async function signAuthorizations(
  config: RhinestoneConfig,
  preparedTransaction: PreparedTransactionData,
) {
  return await signAuthorizationsInternal(
    config,
    preparedTransaction.intentRoute,
  )
}

async function signMessage(
  config: RhinestoneConfig,
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
  config: RhinestoneConfig,
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

  if (signers?.type === 'session') {
    return await signTypedDataWithSession(
      config,
      chain,
      {
        address: validator.address,
        isRoot,
      },
      signers,
      parameters,
    )
  }

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

async function signTypedDataWithSession<
  typedData extends TypedData | Record<string, unknown> = TypedData,
  primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
>(
  config: RhinestoneConfig,
  chain: Chain,
  validator: ValidatorConfig,
  signers: SignerSet & { type: 'session' },
  parameters: HashTypedDataParameters<typedData, primaryType>,
) {
  const { name, version, chainId, verifyingContract, salt } = getEip712Domain(
    config,
    chain,
  )
  const signature = await getTypedDataPackedSignature(
    config,
    signers,
    chain,
    validator,
    {
      domain: parameters.domain as TypedDataDomain,
      primaryType: 'TypedDataSign',
      types: {
        ...(parameters.types as TypedData),
        TypedDataSign: [
          { name: 'contents', type: parameters.primaryType },
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
          { name: 'salt', type: 'bytes32' },
        ],
      },
      message: {
        contents: parameters.message as Record<string, unknown>,
        name,
        version,
        chainId,
        verifyingContract,
        salt,
      },
    },
    (signature) => {
      const erc7739Signature = wrapTypedDataSignature({
        domain: parameters.domain as TypedDataDomain,
        primaryType: parameters.primaryType,
        types: parameters.types as TypedData,
        message: parameters.message as Record<string, unknown>,
        signature,
      })
      return encodePacked(
        ['bytes32', 'bytes'],
        [getPermissionId(signers.session), erc7739Signature],
      )
    },
  )
  return await toErc6492Signature(config, signature, chain)
}

async function signAuthorizationsInternal(
  config: RhinestoneConfig,
  data: IntentRoute | UserOperation,
) {
  const eoa = config.eoa
  if (!eoa) {
    throw new Error('EIP-7702 initialization is required for EOA accounts')
  }
  const accountAddress = getAddress(config)
  const requiredDelegations =
    'intentOp' in data
      ? data.intentOp.signedMetadata.account.requiredDelegations || {}
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
  config: RhinestoneConfig,
  signedTransaction: SignedTransactionData,
  authorizations: SignedAuthorizationList,
  dryRun: boolean = false,
): Promise<TransactionResult> {
  const { intentRoute, transaction, originSignatures, destinationSignature } =
    signedTransaction
  const { sourceChains, targetChain } = getTransactionParams(transaction)
  const intentOp = intentRoute.intentOp
  return await submitIntent(
    config,
    sourceChains,
    targetChain,
    intentOp,
    originSignatures,
    destinationSignature,
    authorizations,
    dryRun,
  )
}

async function submitUserOperation(
  config: RhinestoneConfig,
  signedUserOperation: SignedUserOperationData,
) {
  const chain = signedUserOperation.transaction.chain
  const userOp = signedUserOperation.userOperation
  const signature = signedUserOperation.signature
  // Smart sessions require a UserOp flow
  return await submitUserOp(config, chain, userOp, signature)
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
  const lockFunds = transaction.lockFunds
  const account = transaction.experimental_accountOverride
  const recipient = transaction.recipient

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
    lockFunds,
    account,
    recipient,
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
  config: RhinestoneConfig,
  chain: Chain,
  callInputs: CalldataInput[],
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
    userOp,
    hash: getUserOperationHash({
      userOperation: userOp,
      chainId: chain.id,
      entryPointAddress: entryPoint07Address,
      entryPointVersion: '0.7',
    }),
  }
}

async function prepareTransactionAsIntent(
  config: RhinestoneConfig,
  sourceChains: Chain[] | undefined,
  targetChain: Chain,
  callInputs: CalldataInput[],
  gasLimit: bigint | undefined,
  tokenRequests: TokenRequest[],
  recipient: RhinestoneAccountConfig | Address | undefined,
  accountAddress: Address,
  isSponsored: boolean,
  eip7702InitSignature: Hex | undefined,
  settlementLayers: SettlementLayer[] | undefined,
  sourceAssets: SourceAssetInput | undefined,
  feeAsset: Address | TokenSymbol | undefined,
  lockFunds: boolean | undefined,
  account:
    | {
        setupOps?: {
          to: Address
          data: Hex
        }[]
      }
    | undefined,
) {
  const calls = parseCalls(callInputs, targetChain.id)
  const accountAccessList = createAccountAccessList(sourceChains, sourceAssets)

  const { setupOps, delegations } = await getSetupOperationsAndDelegations(
    config,
    accountAddress,
    eip7702InitSignature,
  )

  function getAccountType(
    accountConfig: AccountProviderConfig | undefined,
  ): 'EOA' | 'ERC7579' {
    if (accountConfig?.type === 'eoa') {
      return 'EOA'
    } else {
      return 'ERC7579'
    }
  }

  async function getRecipient(
    recipient: RhinestoneAccountConfig | Address | undefined,
  ): Promise<{
    address: Address
    accountType: 'EOA' | 'ERC7579'
    setupOps: {
      to: Address
      data: Hex
    }[]
    delegations:
      | {
          [chainId: number]: {
            contract: Address
          }
        }
      | undefined
  }> {
    if (typeof recipient === 'string') {
      // Passed as an address, assume it's an EOA
      return {
        address: recipient,
        accountType: 'EOA',
        setupOps: [],
        delegations: undefined,
      }
    }
    const recipientAddress = recipient ? getAddress(recipient) : undefined
    const recipientAccountType = recipient
      ? getAccountType(recipient.account)
      : undefined
    const { setupOps: recipientSetupOps, delegations: recipientDelegations } =
      recipient && recipientAddress
        ? await getSetupOperationsAndDelegations(
            recipient,
            recipientAddress,
            eip7702InitSignature,
          )
        : {
            setupOps: [],
            delegations: {},
          }
    if (!recipientAddress || !recipientAccountType) {
      throw new Error('Invalid recipient')
    }
    return {
      address: recipientAddress,
      accountType: recipientAccountType,
      setupOps: recipientSetupOps,
      delegations: recipientDelegations,
    }
  }

  const accountType = getAccountType(config.account)

  const metaIntent: IntentInput = {
    destinationChainId: targetChain.id,
    tokenRequests: tokenRequests.map((tokenRequest) => ({
      tokenAddress: resolveTokenAddress(tokenRequest.address, targetChain.id),
      amount: tokenRequest.amount,
    })),
    recipient: await getRecipient(recipient),
    account: {
      address: accountAddress,
      accountType: accountType,
      setupOps: account?.setupOps ?? setupOps,
      delegations,
    },
    destinationExecutions: calls.map((call) => ({
      to: call.to,
      value: call.value.toString(),
      data: call.data,
    })),
    destinationGasUnits: gasLimit,
    accountAccessList,
    options: {
      topupCompact: lockFunds ?? false,
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
    config.apiKey,
    config.endpointUrl,
  )
  const intentRoute = await orchestrator.getIntentRoute(metaIntent)
  return intentRoute
}

async function signIntent(
  config: RhinestoneConfig,
  targetChain: Chain,
  intentOp: IntentOp,
  signers?: SignerSet,
) {
  if (config.account?.type === 'eoa') {
    const originSignatures: Hex[] = []
    for (const element of intentOp.elements) {
      let digest: Hex | undefined
      if (config.eoa?.signTypedData) {
        const typedData = getPermit2TypedData(
          element,
          BigInt(intentOp.nonce),
          BigInt(intentOp.expires),
        )
        originSignatures.push(await config.eoa.signTypedData(typedData))
      } else if (config.eoa?.sign) {
        digest = getPermit2Digest(
          element,
          BigInt(intentOp.nonce),
          BigInt(intentOp.expires),
        )
        originSignatures.push(await (config.eoa as any).sign({ hash: digest }))
      } else if (config.eoa?.signMessage) {
        digest = getPermit2Digest(
          element,
          BigInt(intentOp.nonce),
          BigInt(intentOp.expires),
        )
        originSignatures.push(
          await (config.eoa as any).signMessage({
            message: { raw: digest },
          }),
        )
      } else {
        throw new EoaSigningMethodNotConfiguredError(
          'signTypedData, sign, or signMessage',
        )
      }
    }
    const destinationSignature = originSignatures.at(-1) as Hex
    return {
      originSignatures,
      destinationSignature,
    }
  }

  const validator = getValidator(config, signers)
  if (!validator) {
    throw new Error('Validator not available')
  }
  const ownerValidator = getOwnerValidator(config)
  const isRoot = validator.address === ownerValidator.address
  const signatures = await getIntentSignature(
    config,
    intentOp,
    signers,
    targetChain,
    validator,
    isRoot,
  )
  return {
    originSignatures: signatures.originSignatures,
    destinationSignature: signatures.destinationSignature,
  }
}

async function getIntentSignature(
  config: RhinestoneConfig,
  intentOp: IntentOp,
  signers: SignerSet | undefined,
  targetChain: Chain,
  validator: Module,
  isRoot: boolean,
) {
  const withPermit2 = intentOp.elements.some(
    (element) =>
      element.mandate.qualifier.settlementContext?.fundingMethod === 'PERMIT2',
  )
  const withIntentExecutorOps = intentOp.elements.some(
    (element) =>
      element.mandate.qualifier.settlementContext.settlementLayer ===
      'INTENT_EXECUTOR',
  )
  if (withIntentExecutorOps) {
    const signature = await getSingleChainOpsSignature(
      config,
      intentOp,
      signers,
      targetChain,
      validator,
      isRoot,
    )
    return signature
  }

  if (withPermit2) {
    return await getPermit2Signatures(
      config,
      intentOp,
      signers,
      targetChain,
      validator,
      isRoot,
    )
  }
  const signature = await getCompactSignature(
    config,
    intentOp,
    signers,
    targetChain,
    validator,
    isRoot,
  )
  return {
    originSignatures: Array(intentOp.elements.length).fill(signature),
    destinationSignature: signature,
  }
}

async function getSingleChainOpsSignature(
  config: RhinestoneConfig,
  intentOp: IntentOp,
  signers: SignerSet | undefined,
  targetChain: Chain,
  validator: Module,
  isRoot: boolean,
) {
  const address = getAddress(config)
  const intentExecutor = getIntentExecutor(config)
  const originSignatures: Hex[] = []
  for (const element of intentOp.elements) {
    const typedData = getSingleChainOpsTypedData(
      address,
      intentExecutor.address,
      element,
      BigInt(intentOp.nonce),
    )
    const signature = await signIntentTypedData(
      config,
      signers,
      targetChain,
      validator,
      isRoot,
      typedData,
    )
    originSignatures.push(signature)
  }
  const destinationSignature = originSignatures.at(-1) as Hex
  return {
    originSignatures,
    destinationSignature,
  }
}

async function getPermit2Signatures(
  config: RhinestoneConfig,
  intentOp: IntentOp,
  signers: SignerSet | undefined,
  targetChain: Chain,
  validator: Module,
  isRoot: boolean,
) {
  const originSignatures: Hex[] = []
  for (const element of intentOp.elements) {
    const typedData = getPermit2TypedData(
      element,
      BigInt(intentOp.nonce),
      BigInt(intentOp.expires),
    )
    const signature = await signIntentTypedData(
      config,
      signers,
      targetChain,
      validator,
      isRoot,
      typedData,
    )
    originSignatures.push(signature)
  }
  const destinationSignature = originSignatures.at(-1) as Hex
  return {
    originSignatures,
    destinationSignature,
  }
}

async function getCompactSignature(
  config: RhinestoneConfig,
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
  config: RhinestoneConfig,
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
  config: RhinestoneConfig,
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
  config: RhinestoneConfig,
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
  } as UserOperationResult
}

async function submitIntent(
  config: RhinestoneConfig,
  sourceChains: Chain[] | undefined,
  targetChain: Chain,
  intentOp: IntentOp,
  originSignatures: Hex[],
  destinationSignature: Hex,
  authorizations: SignedAuthorizationList,
  dryRun: boolean,
) {
  return submitIntentInternal(
    config,
    sourceChains,
    targetChain,
    intentOp,
    originSignatures,
    destinationSignature,
    authorizations,
    dryRun,
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

function createSignedIntentOp(
  intentOp: IntentOp,
  originSignatures: Hex[],
  destinationSignature: Hex,
  authorizations: SignedAuthorizationList,
): SignedIntentOp {
  return {
    ...intentOp,
    originSignatures,
    destinationSignature,
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
  config: RhinestoneConfig,
  sourceChains: Chain[] | undefined,
  targetChain: Chain,
  intentOp: IntentOp,
  originSignatures: Hex[],
  destinationSignature: Hex,
  authorizations: SignedAuthorizationList,
  dryRun: boolean,
) {
  const signedIntentOp = createSignedIntentOp(
    intentOp,
    originSignatures,
    destinationSignature,
    authorizations,
  )
  const orchestrator = getOrchestratorByChain(
    targetChain.id,
    config.apiKey,
    config.endpointUrl,
  )
  const intentResults = await orchestrator.submitIntent(signedIntentOp, dryRun)
  return {
    type: 'intent',
    id: BigInt(intentResults.result.id),
    sourceChains: sourceChains?.map((chain) => chain.id),
    targetChain: targetChain.id,
  } as TransactionResult
}

async function getValidatorAccount(
  config: RhinestoneConfig,
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
  config: RhinestoneConfig,
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
      // Use the configured owner validator (e.g., ENS) rather than forcing Ownable
      return getOwnerValidator(config)
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

function parseCalls(calls: CalldataInput[], chainId: number): Call[] {
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
  config: RhinestoneConfig,
  accountAddress: Address,
  eip7702InitSignature?: Hex,
) {
  const initCode = getInitCode(config)

  if (config.account?.type === 'eoa') {
    return {
      setupOps: [],
    }
  } else if (is7702(config)) {
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
    if (isAddress(addressOrSymbol, { strict: false })) {
      return true
    }
    // Token symbol
    const address = getTokenAddress(addressOrSymbol, chain.id)
    return isAddress(address, { strict: false })
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
  prepareUserOperation,
  signUserOperation,
  submitUserOperation,
  getOrchestratorByChain,
  signIntent,
  prepareTransactionAsIntent,
  submitIntentInternal,
  getValidatorAccount,
  parseCalls,
  getTokenRequests,
  resolveCallInputs,
}
export type {
  IntentRoute,
  TransactionResult,
  PreparedTransactionData,
  PreparedUserOperationData,
  SignedTransactionData,
  SignedUserOperationData,
  UserOperationResult,
}
