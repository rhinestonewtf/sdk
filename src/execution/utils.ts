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
  type TypedDataDefinition,
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
  EoaAccountMustHaveAccountError,
  EoaSigningMethodNotConfiguredError,
  FactoryArgsNotAvailableError,
  getAddress,
  getEip712Domain,
  getEip1271Signature,
  getEip7702InitCall,
  getEmissarySignature,
  getGuardianSmartAccount,
  getInitCode,
  getSmartAccount,
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
import {
  type AccountAccessList,
  type AuxiliaryFunds,
  type Account as OrchestratorAccount,
  type OriginSignature,
  type SettlementLayer,
  SIG_MODE_EMISSARY_EXECUTION_ERC1271,
  SIG_MODE_ERC1271_EMISSARY,
  type SupportedChain,
} from '../orchestrator/types'
import type {
  AccountProviderConfig,
  Call,
  CalldataInput,
  CallInput,
  ExactInputConfig,
  RhinestoneAccountConfig,
  RhinestoneConfig,
  SignerSet,
  SimpleTokenList,
  SourceAssetInput,
  Sponsorship,
  TokenRequest,
  TokenSymbol,
  Transaction,
  UserOperationTransaction,
} from '../types'
import { getCompactTypedData } from './compact'
import {
  Eip7702InitSignatureRequiredError,
  SignerNotSupportedError,
} from './error'
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
  originSignatures: OriginSignature[]
  destinationSignature: Hex
  targetExecutionSignature: Hex | undefined
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
    auxiliaryFunds,
    account,
    recipient,
  } = getTransactionParams(transaction)
  const accountAddress = getAddress(config)

  const isUserOpSigner = signers?.type === 'guardians'
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
    sponsored,
    eip7702InitSignature,
    settlementLayers,
    sourceAssets,
    feeAsset,
    lockFunds,
    auxiliaryFunds,
    account,
    signers,
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
  inputs: CallInput[] | undefined,
  config: RhinestoneConfig,
  chain: Chain,
  accountAddress: Address,
): Promise<CalldataInput[]> {
  const resolved: CalldataInput[] = []
  if (!inputs) {
    return resolved
  }
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

function getTransactionMessages(
  config: RhinestoneConfig,
  preparedTransaction: PreparedTransactionData,
): {
  origin: TypedDataDefinition[]
  destination: TypedDataDefinition
} {
  return getIntentMessages(
    config,
    preparedTransaction.intentRoute.intentOp,
    false,
  )
}

async function signTransaction(
  config: RhinestoneConfig,
  preparedTransaction: PreparedTransactionData,
): Promise<SignedTransactionData> {
  const { signers } = getTransactionParams(preparedTransaction.transaction)
  const intentRoute = preparedTransaction.intentRoute
  const targetChain =
    'targetChain' in preparedTransaction.transaction
      ? preparedTransaction.transaction.targetChain
      : preparedTransaction.transaction.chain
  const { originSignatures, destinationSignature } = await signIntent(
    config,
    intentRoute.intentOp,
    targetChain,
    signers,
    false,
  )
  const targetExecutionSignature = await getTargetExecutionSignature(
    config,
    intentRoute.intentOp,
    targetChain,
    signers,
  )

  return {
    intentRoute,
    transaction: preparedTransaction.transaction,
    originSignatures,
    destinationSignature,
    targetExecutionSignature,
  }
}

async function getTargetExecutionSignature(
  config: RhinestoneConfig,
  intentOp: IntentOp,
  targetChain: Chain,
  signers: SignerSet | undefined,
) {
  if (signers?.type !== 'experimental_session') {
    return undefined
  }
  const targetExecutionIntentOp = {
    ...intentOp,
    nonce: intentOp.targetExecutionNonce,
  }
  const { destinationSignature: targetExecutionSignature } = await signIntent(
    config,
    targetExecutionIntentOp,
    targetChain,
    signers,
    true,
  )
  return targetExecutionSignature
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
  const signature = await getEip1271Signature(
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
  options?: {
    skipErc6492?: boolean
  },
) {
  const validator = getValidator(config, signers)
  if (!validator) {
    throw new Error('Validator not available')
  }
  const ownerValidator = getOwnerValidator(config)
  const isRoot = validator.address === ownerValidator.address

  if (signers?.type === 'experimental_session') {
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
  if (!options?.skipErc6492) {
    return await toErc6492Signature(config, signature, chain)
  }
  return signature
}

async function signTypedDataWithSession<
  typedData extends TypedData | Record<string, unknown> = TypedData,
  primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
>(
  config: RhinestoneConfig,
  chain: Chain,
  validator: ValidatorConfig,
  signers: SignerSet & { type: 'experimental_session' },
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
  const {
    intentRoute,
    transaction,
    originSignatures,
    destinationSignature,
    targetExecutionSignature,
  } = signedTransaction
  const { sourceChains, targetChain } = getTransactionParams(transaction)
  const intentOp = intentRoute.intentOp
  return await submitIntent(
    config,
    sourceChains,
    targetChain,
    intentOp,
    originSignatures,
    destinationSignature,
    targetExecutionSignature,
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
  const auxiliaryFunds = transaction.auxiliaryFunds
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
    auxiliaryFunds,
    account,
    recipient,
  }
}

function getTokenRequests(
  sourceChains: Chain[] | undefined,
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
    (sourceChains &&
      sourceChains.length === 1 &&
      sourceChains[0].id === targetChain.id)
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

function getAccountType(
  accountConfig: AccountProviderConfig | undefined,
): 'EOA' | 'ERC7579' {
  if (accountConfig?.type === 'eoa') {
    return 'EOA'
  } else {
    return 'ERC7579'
  }
}

function getIntentAccount(
  config: RhinestoneConfig,
  eip7702InitSignature: Hex | undefined,
  account:
    | {
        setupOps?: {
          to: Address
          data: Hex
        }[]
      }
    | undefined,
) {
  const accountAddress = getAddress(config)
  const accountType = getAccountType(config.account)

  const { setupOps, delegations } = getSetupOperationsAndDelegations(
    config,
    accountAddress,
    eip7702InitSignature,
  )
  return {
    address: accountAddress,
    accountType: accountType,
    setupOps: account?.setupOps ?? setupOps,
    delegations,
  }
}

async function prepareTransactionAsIntent(
  config: RhinestoneConfig,
  sourceChains: Chain[] | undefined,
  targetChain: Chain,
  callInputs: CalldataInput[],
  gasLimit: bigint | undefined,
  tokenRequests: TokenRequest[],
  recipientInput: RhinestoneAccountConfig | Address | undefined,
  sponsored: Sponsorship | undefined,
  eip7702InitSignature: Hex | undefined,
  settlementLayers: SettlementLayer[] | undefined,
  sourceAssets: SourceAssetInput | undefined,
  feeAsset: Address | TokenSymbol | undefined,
  lockFunds: boolean | undefined,
  auxiliaryFunds: AuxiliaryFunds | undefined,
  account:
    | {
        setupOps?: {
          to: Address
          data: Hex
        }[]
      }
    | undefined,
  signers: SignerSet | undefined,
) {
  const calls = parseCalls(callInputs, targetChain.id)
  const accountAccessList = createAccountAccessList(sourceChains, sourceAssets)

  function getRecipient(
    recipient: RhinestoneAccountConfig | Address | undefined,
  ): OrchestratorAccount | undefined {
    if (typeof recipient === 'string') {
      // Passed as an address, assume it's an EOA
      return {
        address: recipient,
        accountType: 'EOA',
        setupOps: [],
        delegations: undefined,
      }
    }
    if (!recipient) {
      return undefined
    }
    return getIntentAccount(recipient, eip7702InitSignature, account)
  }

  const intentAccount = getIntentAccount(config, eip7702InitSignature, account)
  const recipient = getRecipient(recipientInput)
  const signatureMode =
    signers?.type === 'experimental_session'
      ? SIG_MODE_EMISSARY_EXECUTION_ERC1271
      : SIG_MODE_ERC1271_EMISSARY

  const metaIntent: IntentInput = {
    destinationChainId: targetChain.id,
    tokenRequests: tokenRequests.map((tokenRequest) => ({
      tokenAddress: resolveTokenAddress(tokenRequest.address, targetChain.id),
      amount: tokenRequest.amount,
    })),
    recipient,
    account: intentAccount,
    destinationExecutions: calls,
    destinationGasUnits: gasLimit,
    accountAccessList,
    options: {
      topupCompact: lockFunds ?? false,
      feeToken: feeAsset,
      sponsorSettings: sponsored
        ? typeof sponsored === 'object'
          ? {
              gasSponsored: sponsored.gas,
              bridgeFeesSponsored: sponsored.bridging,
              swapFeesSponsored: sponsored.swaps,
            }
          : {
              gasSponsored: sponsored,
              bridgeFeesSponsored: sponsored,
              swapFeesSponsored: sponsored,
            }
        : undefined,
      settlementLayers,
      signatureMode,
      auxiliaryFunds,
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
  intentOp: IntentOp,
  targetChain: Chain,
  signers?: SignerSet,
  targetExecution?: boolean,
) {
  const { origin, destination } = getIntentMessages(
    config,
    intentOp,
    targetExecution ?? false,
  )
  if (config.account?.type === 'eoa') {
    const eoa = config.eoa
    if (!eoa) {
      throw new EoaAccountMustHaveAccountError()
    }
    const originSignatures: Hex[] = []
    for (const typedData of origin) {
      if (eoa.signTypedData) {
        const signature = await eoa.signTypedData(typedData)
        originSignatures.push(signature)
      } else {
        throw new EoaSigningMethodNotConfiguredError('signTypedData')
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

  const originSignatures: OriginSignature[] = []
  for (const typedData of origin) {
    const chain = getChainById(typedData.domain?.chainId as number)
    // For same chain transactions, we need to modify the origin signers
    // Specifically, we need to remove the enable data in this case
    const matchesTargetChain = chain.id === targetChain.id
    const originSigners =
      signers?.type === 'experimental_session'
        ? ({
            type: 'experimental_session',
            session: signers.session,
            verifyExecutions: matchesTargetChain
              ? signers.verifyExecutions
              : undefined,
            enableData: matchesTargetChain ? signers.enableData : undefined,
          } as SignerSet & { type: 'experimental_session' })
        : signers
    const signature = await signIntentTypedData(
      config,
      originSigners,
      validator,
      isRoot,
      typedData,
      chain,
      targetExecution ?? false,
    )
    originSignatures.push(signature)
  }

  const destinationSignature = await getDestinationSignature(
    config,
    signers,
    validator,
    isRoot,
    targetChain,
    destination,
    originSignatures,
    targetExecution ?? false,
  )

  return {
    originSignatures,
    destinationSignature,
  }
}

async function getDestinationSignature(
  config: RhinestoneConfig,
  signers: SignerSet | undefined,
  validator: Module,
  isRoot: boolean,
  targetChain: Chain,
  destination: TypedDataDefinition,
  originSignatures: OriginSignature[],
  targetExecution: boolean,
): Promise<Hex> {
  // For smart sessions, we need to provide a separate destination signature for the target chain
  if (signers?.type === 'experimental_session') {
    const destinationChain = getChainById(targetChain.id)
    const destinationSignatures = await signIntentTypedData(
      config,
      signers,
      validator,
      isRoot,
      destination,
      destinationChain,
      targetExecution,
    )
    return typeof destinationSignatures === 'object'
      ? destinationSignatures.preClaimSig
      : (destinationSignatures ?? '0x')
  }

  const lastOriginSignature = originSignatures.at(-1)
  return typeof lastOriginSignature === 'object'
    ? lastOriginSignature.preClaimSig
    : (lastOriginSignature ?? '0x')
}

function getIntentMessages(
  config: RhinestoneConfig,
  intentOp: IntentOp,
  targetExecution: boolean,
) {
  const address = getAddress(config)
  const intentExecutor = getIntentExecutor(config)

  const withPermit2 = intentOp.elements.some(
    (element) =>
      element.mandate.qualifier.settlementContext.fundingMethod === 'PERMIT2',
  )
  const withIntentExecutorOps =
    targetExecution ||
    intentOp.elements.some(
      (element) =>
        element.mandate.qualifier.settlementContext.settlementLayer ===
        'INTENT_EXECUTOR',
    )
  const origin: TypedDataDefinition[] = []
  for (const element of intentOp.elements) {
    if (withIntentExecutorOps) {
      const typedData = getSingleChainOpsTypedData(
        address,
        intentExecutor.address,
        element,
        BigInt(intentOp.nonce),
      )
      origin.push(typedData)
    } else if (withPermit2) {
      const typedData = getPermit2TypedData(
        element,
        BigInt(intentOp.nonce),
        BigInt(intentOp.expires),
      )
      origin.push(typedData)
    } else {
      const typedData = getCompactTypedData(intentOp)
      origin.push(typedData)
    }
  }
  const destination = origin.at(-1) as TypedDataDefinition
  return {
    origin,
    destination,
  }
}

async function signIntentTypedData<
  typedData extends TypedData | Record<string, unknown> = TypedData,
  primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
>(
  config: RhinestoneConfig,
  signers: SignerSet | undefined,
  validator: Module,
  isRoot: boolean,
  parameters: HashTypedDataParameters<typedData, primaryType>,
  chain: Chain,
  targetExecution: boolean,
) {
  if (supportsEip712(validator)) {
    return await getTypedDataPackedSignature(
      config,
      signers,
      chain,
      {
        address: validator.address,
        isRoot,
      },
      parameters,
    )
  }
  const hash = hashTypedData(parameters)
  if (signers?.type === 'experimental_session' && signers.verifyExecutions) {
    if (targetExecution) {
      return await getEmissarySignature(
        config,
        {
          type: 'experimental_session',
          session: signers.session,
          verifyExecutions: true,
        },
        chain,
        hash,
      )
    }
    const eip1271Signature = await getEip1271Signature(
      config,
      {
        type: 'experimental_session',
        session: signers.session,
        verifyExecutions: false,
        enableData: signers.enableData,
      },
      chain,
      {
        address: validator.address,
        isRoot,
      },
      hash,
    )
    const emissarySignature = await getEmissarySignature(
      config,
      {
        type: 'experimental_session',
        session: signers.session,
        verifyExecutions: true,
        enableData: signers.enableData,
      },
      chain,
      hash,
    )
    return {
      preClaimSig: emissarySignature,
      notarizedClaimSig: eip1271Signature,
    }
  }

  return await getEip1271Signature(
    config,
    signers,
    chain,
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
  originSignatures: OriginSignature[],
  destinationSignature: Hex,
  targetExecutionSignature: Hex | undefined,
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
    targetExecutionSignature,
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
  originSignatures: OriginSignature[],
  destinationSignature: Hex,
  targetExecutionSignature: Hex | undefined,
  authorizations: SignedAuthorizationList,
): SignedIntentOp {
  return {
    ...intentOp,
    originSignatures,
    destinationSignature,
    targetExecutionSignature,
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
  originSignatures: OriginSignature[],
  destinationSignature: Hex,
  targetExecutionSignature: Hex | undefined,
  authorizations: SignedAuthorizationList,
  dryRun: boolean,
) {
  const signedIntentOp = createSignedIntentOp(
    intentOp,
    originSignatures,
    destinationSignature,
    targetExecutionSignature,
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

  const withGuardians = signers.type === 'guardians' ? signers : null

  return withGuardians
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
  const withSession = signers.type === 'experimental_session'
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
): AccountAccessList | undefined {
  if (!sourceChains && !sourceAssets) return undefined

  const chainIds = sourceChains?.map((chain) => chain.id as SupportedChain)

  if (!sourceAssets) return { chainIds }
  if (Array.isArray(sourceAssets)) {
    const isExactConfig =
      sourceAssets.length > 0 && typeof sourceAssets[0] !== 'string'

    if (isExactConfig) {
      const resolvedConfigs = (sourceAssets as ExactInputConfig[]).map(
        (config) => ({
          chainId: config.chain.id,
          tokenAddress: resolveTokenAddress(config.address, config.chain.id),
          amount: config.amount,
        }),
      )
      return resolvedConfigs
    }

    return chainIds
      ? { chainIds, tokens: sourceAssets as SimpleTokenList }
      : { tokens: sourceAssets as SimpleTokenList }
  }

  return { chainTokens: sourceAssets }
}

function getSetupOperationsAndDelegations(
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
      throw new Eip7702InitSignatureRequiredError()
    }

    const { initData: eip7702InitData, contract: eip7702Contract } =
      getEip7702InitCall(config, eip7702InitSignature)

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
    const to = 'factory' in initCode ? initCode.factory : undefined
    const data = 'factory' in initCode ? initCode.factoryData : undefined
    if (!to || !data) {
      // Check if it's a migrated account with address-only initData
      if (config.initData && !('factory' in config.initData)) {
        // Assume the account is already deployed
        return {
          setupOps: [],
        }
      }
      throw new FactoryArgsNotAvailableError()
    }
    // Contract account with init code
    return {
      setupOps: [
        {
          to,
          data,
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
  getTransactionMessages,
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
  getIntentAccount,
  getTargetExecutionSignature,
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
