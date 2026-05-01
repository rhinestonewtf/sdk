import {
  type Address,
  type Chain,
  concat,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodePacked,
  type HashTypedDataParameters,
  type Hex,
  hashDomain,
  hashMessage,
  hashStruct,
  hashTypedData,
  isAddress,
  keccak256,
  type PublicClient,
  publicActions,
  type SignableMessage,
  type SignedAuthorization,
  type SignedAuthorizationList,
  type TypedData,
  type TypedDataDefinition,
  type TypedDataDomain,
  type TypedDataParameter,
  toHex,
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
  getAccountProvider,
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
import { convertOwnerSetToSignerSet } from '../accounts/signing/common'
import { K1_DEFAULT_VALIDATOR_ADDRESS } from '../accounts/startale'
import {
  createTransport,
  getBundlerClient,
  type ValidatorConfig,
} from '../accounts/utils'
import { createAuthProvider } from '../auth/provider'
import type { Module } from '../modules/common'
import {
  buildMockSignature,
  DUMMY_PRECLAIMOP_SELECTOR,
  DUMMY_PRECLAIMOP_TARGET,
  getOwnerValidator,
  getPermissionId,
  getSmartSessionValidator,
  isSessionEnabled,
} from '../modules/validators'
import {
  getMultiFactorValidator,
  getSocialRecoveryValidator,
  getWebAuthnValidator,
  supportsEip712,
} from '../modules/validators/core'
import type { ResolvedSessionSignerSet } from '../modules/validators/smart-sessions'
import {
  type Execution,
  getOrchestrator,
  type IntentInput,
  type Quote,
  type SignData,
} from '../orchestrator'
import {
  getChainById,
  getTokenAddress,
  resolveTokenAddress,
} from '../orchestrator/registry'
import {
  type AccountAccessList,
  type AuxiliaryFunds,
  type IntentSubmitRequestInternal,
  type MappedChainTokenAccessList,
  type Account as OrchestratorAccount,
  type OriginSignature,
  type SettlementLayer,
  SIG_MODE_EMISSARY_EXECUTION_ERC1271,
  SIG_MODE_ERC1271_EMISSARY,
  type SupportedChain,
} from '../orchestrator/types'
import { convertBigIntFields } from '../orchestrator/utils'
import type {
  AccountProviderConfig,
  Call,
  CalldataInput,
  CallInput,
  ExactInputConfig,
  RhinestoneAccountConfig,
  RhinestoneConfig,
  Session,
  SessionEnableData,
  SessionSignerSet,
  SignerSet,
  SimpleTokenList,
  SourceAssetInput,
  Sponsorship,
  TokenRequest,
  TokenSymbol,
  Transaction,
  UserOperationTransaction,
} from '../types'
import {
  Eip7702InitSignatureRequiredError,
  QuoteNotInPreparedTransactionError,
  SignerNotSupportedError,
} from './error'

type InternalSignerSet =
  | Exclude<SignerSet, SessionSignerSet>
  | ResolvedSessionSignerSet

function isResolvedSessionSignerSet(
  signers: InternalSignerSet | undefined,
): signers is ResolvedSessionSignerSet {
  return (
    signers?.type === 'experimental_session' && 'verifyExecutions' in signers
  )
}

async function resolveSignersForChain(
  config: RhinestoneConfig,
  signers: SignerSet | undefined,
  chainId: number,
): Promise<InternalSignerSet | undefined> {
  if (signers?.type !== 'experimental_session') {
    return signers
  }
  const resolved = resolveSessionForChain(signers, chainId)
  const enabled = await isSessionEnabled(
    getAddress(config),
    config.provider,
    resolved.session,
    config.useDevContracts,
  )
  const enableData = enabled ? undefined : resolved.enableData
  const verifyExecutions =
    resolved.verifyExecutions ??
    signers.verifyExecutions ??
    resolved.session.hasExplicitPermissions
  return {
    type: 'experimental_session',
    session: resolved.session,
    enableData,
    verifyExecutions,
  } satisfies ResolvedSessionSignerSet
}

function resolveSessionForChain(
  signers: SessionSignerSet,
  chainId: number,
): {
  session: Session
  enableData?: SessionEnableData
  verifyExecutions?: boolean
} {
  if ('sessions' in signers) {
    const config = signers.sessions[chainId]
    if (!config) {
      throw new Error(`No session configured for chain ${chainId}`)
    }
    return config
  }
  return { session: signers.session, enableData: signers.enableData }
}

interface UserOperationResult {
  type: 'userop'
  hash: Hex
  chain: number
}

interface TransactionResult {
  type: 'intent'
  id: string
  sourceChains?: number[]
  targetChain: number
}

interface PreparedQuotes {
  best: Quote
  all: Quote[]
}

interface PreparedTransactionData {
  quotes: PreparedQuotes
  intentInput: unknown
  transaction: Transaction
}

interface QuoteSelection {
  intentId: string
}

interface PreparedUserOperationData {
  userOperation: UserOperation
  hash: Hex
  transaction: UserOperationTransaction
}

interface SignedTransactionData extends PreparedTransactionData {
  quote: Quote
  originSignatures: OriginSignature[]
  destinationSignature: Hex
  targetExecutionSignature: Hex | undefined
}

type TypedDataMessage = Record<string, unknown>
type TypedDataTypes = Record<string, readonly TypedDataParameter[]>

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
    auxiliaryFunds,
    account,
    recipient,
  } = getTransactionParams(transaction)
  const accountAddress = getAddress(config)

  const isUserOpSigner = signers?.type === 'guardians'
  if (isUserOpSigner) {
    throw new SignerNotSupportedError()
  }
  const prepared = await prepareTransactionAsIntent(
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
    auxiliaryFunds,
    account,
    signers,
  )

  return {
    quotes: prepared.quotes,
    intentInput: prepared.intentInput,
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
  _config: RhinestoneConfig,
  preparedTransaction: PreparedTransactionData,
  options?: QuoteSelection,
): {
  origin: TypedDataDefinition[]
  destination: TypedDataDefinition
  targetExecution?: TypedDataDefinition
} {
  const quote = resolveQuote(preparedTransaction.quotes, options)
  return getIntentMessages(quote.signData)
}

async function signTransaction(
  config: RhinestoneConfig,
  preparedTransaction: PreparedTransactionData,
  options?: QuoteSelection,
): Promise<SignedTransactionData> {
  const { signers } = getTransactionParams(preparedTransaction.transaction)
  const quote = resolveQuote(preparedTransaction.quotes, options)
  const targetChain =
    'targetChain' in preparedTransaction.transaction
      ? preparedTransaction.transaction.targetChain
      : preparedTransaction.transaction.chain
  const { originSignatures, destinationSignature } = await signIntent(
    config,
    quote.signData,
    targetChain,
    signers,
    false,
  )
  const targetExecutionSignature = await getTargetExecutionSignature(
    config,
    quote.signData,
    targetChain,
    signers,
  )

  return {
    quote,
    quotes: preparedTransaction.quotes,
    intentInput: preparedTransaction.intentInput,
    transaction: preparedTransaction.transaction,
    originSignatures,
    destinationSignature,
    targetExecutionSignature,
  }
}

function resolveQuote(quotes: PreparedQuotes, options?: QuoteSelection): Quote {
  if (!options) return quotes.best
  const match = quotes.all.find((q) => q.intentId === options.intentId)
  if (!match) {
    throw new QuoteNotInPreparedTransactionError({
      context: { intentId: options.intentId },
    })
  }
  return match
}

async function getTargetExecutionSignature(
  config: RhinestoneConfig,
  signData: SignData,
  targetChain: Chain,
  signers: SignerSet | undefined,
) {
  if (signers?.type !== 'experimental_session') {
    return undefined
  }
  if (!signData.targetExecution) {
    return undefined
  }
  const resolvedSigners = await resolveSignersForChain(
    config,
    signers,
    targetChain.id,
  )
  if (
    !isResolvedSessionSignerSet(resolvedSigners) ||
    !resolvedSigners.verifyExecutions
  ) {
    return undefined
  }
  const validator = getValidator(config, signers)
  if (!validator) {
    throw new Error('Validator not available')
  }
  const ownerValidator = getOwnerValidator(config)
  const isRoot = validator.address === ownerValidator.address
  const destination = prepareTypedData(signData.targetExecution)
  const signature = await getDestinationSignature(
    config,
    resolvedSigners,
    validator,
    isRoot,
    targetChain,
    destination,
    [],
    true,
  )
  return signature
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
  const transaction = preparedTransaction.transaction
  const sourceChains =
    'chain' in transaction ? [transaction.chain] : transaction.sourceChains
  const targetChain =
    'chain' in transaction ? transaction.chain : transaction.targetChain
  return await signAuthorizationsInternal(config, {
    sourceChains,
    targetChain,
    eip7702InitSignature: transaction.eip7702InitSignature,
  })
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
    const resolved = resolveSessionForChain(signers, chain.id)
    return await signTypedDataWithSession(
      config,
      chain,
      {
        address: validator.address,
        isRoot,
      },
      resolved.session,
      parameters,
    )
  }

  const account = getAccountProvider(config)
  if (account.type === 'startale' && supportsEip712(validator)) {
    const isK1 =
      validator.address.toLowerCase() ===
      K1_DEFAULT_VALIDATOR_ADDRESS.toLowerCase()
    if (isK1) {
      const sig = await signErc7739TypedData(
        config,
        signers,
        validator,
        isRoot,
        parameters,
        chain,
      )
      if (!options?.skipErc6492) {
        return await toErc6492Signature(config, sig, chain)
      }
      return sig
    }
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
  session: Session,
  parameters: HashTypedDataParameters<typedData, primaryType>,
) {
  const { name, version, chainId, verifyingContract, salt } = getEip712Domain(
    config,
    chain,
  )
  const signers = convertOwnerSetToSignerSet(session.owners)
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
        [getPermissionId(session), erc7739Signature],
      )
    },
  )
  return await toErc6492Signature(config, signature, chain)
}

async function signAuthorizationsInternal(
  config: RhinestoneConfig,
  context: {
    sourceChains: Chain[] | undefined
    targetChain: Chain
    eip7702InitSignature: Hex | undefined
  },
) {
  const eoa = config.eoa
  if (!eoa) {
    throw new Error('EIP-7702 initialization is required for EOA accounts')
  }
  const eip7702InitSignature = context.eip7702InitSignature
  if (!eip7702InitSignature) {
    return []
  }
  const accountAddress = getAddress(config)
  const { contract: eip7702Contract } = getEip7702InitCall(
    config,
    eip7702InitSignature,
  )

  const chains = new Map<number, Chain>()
  for (const chain of [...(context.sourceChains ?? []), context.targetChain]) {
    chains.set(chain.id, chain)
  }

  const authorizations: SignedAuthorization[] = []
  for (const chain of chains.values()) {
    const walletClient = createWalletClient({
      chain,
      account: eoa,
      transport: createTransport(chain, config.provider),
    }).extend(publicActions)
    const code = await walletClient.getCode({
      address: accountAddress,
    })
    const isDelegated =
      code === concat(['0xef0100', eip7702Contract.toLowerCase() as Hex])
    if (isDelegated) {
      continue
    }
    const authorization = await walletClient.signAuthorization({
      contractAddress: eip7702Contract,
      chainId: chain.id,
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
    quote,
    intentInput,
    transaction,
    originSignatures,
    destinationSignature,
    targetExecutionSignature,
  } = signedTransaction
  const { sourceChains, targetChain } = getTransactionParams(transaction)
  return await submitIntentInternal(
    config,
    sourceChains,
    targetChain,
    quote,
    originSignatures,
    destinationSignature,
    targetExecutionSignature,
    authorizations,
    dryRun,
    intentInput,
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
  const auxiliaryFunds = transaction.auxiliaryFunds
  const account = transaction.experimental_accountOverride
  const recipient = transaction.recipient

  const tokenRequests = getTokenRequests(targetChain, initialTokenRequests)

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
    auxiliaryFunds,
    account,
    recipient,
  }
}

function getTokenRequests(
  targetChain: Chain,
  initialTokenRequests: TokenRequest[] | undefined,
) {
  if (initialTokenRequests) {
    validateTokenSymbols(
      targetChain,
      initialTokenRequests.map((tokenRequest) => tokenRequest.address),
    )
  }
  return initialTokenRequests ?? []
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

  const intentAccount: OrchestratorAccount = {
    ...getIntentAccount(config, eip7702InitSignature, account),
    ...(signers?.type === 'experimental_session' && {
      // Per-chain map: enables accurate per-chain session validation gas simulation
      mockSignatures: Object.fromEntries(
        [
          ...new Set([
            ...(sourceChains ?? []).map((c) => c.id),
            targetChain.id,
          ]),
        ].map((chainId) => [
          String(chainId),
          buildMockSignature(
            resolveSessionForChain(signers, chainId).session,
            config.useDevContracts,
            sourceChains?.length ?? 1,
            chainId,
          ),
        ]),
      ),
    }),
  }
  const recipient = getRecipient(recipientInput)
  const signatureMode =
    signers?.type === 'experimental_session'
      ? SIG_MODE_EMISSARY_EXECUTION_ERC1271
      : SIG_MODE_ERC1271_EMISSARY

  // For session signers that need enabling, pass a dummy preclaimop per source chain
  // so the orchestrator bakes it into the bundle before computing its HMAC. The filler
  // executes the op via verifyExecution in ENABLE mode, enabling the session on-chain
  // without a separate UserOp. Must be sent in the routing request — not injected
  // post-facto — because the orchestrator HMAC covers preClaimOps.
  const preClaimExecutions: Record<number, Execution[]> = {}
  if (signers?.type === 'experimental_session' && sourceChains) {
    const resolvedPerChain = await Promise.all(
      sourceChains.map(async (chain) => ({
        chainId: chain.id,
        resolved: await resolveSignersForChain(config, signers, chain.id),
      })),
    )
    for (const { chainId, resolved } of resolvedPerChain) {
      if (!isResolvedSessionSignerSet(resolved)) continue
      const { enableData, verifyExecutions } = resolved
      if (!verifyExecutions || !enableData) continue
      preClaimExecutions[chainId] = [
        {
          to: DUMMY_PRECLAIMOP_TARGET,
          value: 0n,
          data: DUMMY_PRECLAIMOP_SELECTOR,
        },
      ]
    }
  }

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
      feeToken: feeAsset,
      sponsorSettings: sponsored
        ? typeof sponsored === 'object'
          ? {
              gas: sponsored.gas,
              bridgeFees: sponsored.bridging,
              swapFees: sponsored.swaps,
            }
          : {
              gas: sponsored,
              bridgeFees: sponsored,
              swapFees: sponsored,
            }
        : undefined,
      settlementLayers,
      signatureMode,
      auxiliaryFunds,
    },
    ...(Object.keys(preClaimExecutions).length > 0 && { preClaimExecutions }),
  }

  const serializedIntent = convertBigIntFields(metaIntent)

  const orchestrator = getOrchestrator(
    config._authProvider ?? createAuthProvider(config),
    config.endpointUrl,
    config.headers,
  )
  const { routes } = await orchestrator.createQuote(metaIntent)
  const best = routes[0]
  if (!best) {
    throw new Error('Orchestrator returned no quote')
  }
  return {
    quotes: { best, all: routes } satisfies PreparedQuotes,
    intentInput: serializedIntent,
  }
}

async function signIntent(
  config: RhinestoneConfig,
  signData: SignData,
  targetChain: Chain,
  signers?: SignerSet,
  targetExecution?: boolean,
) {
  const { origin, destination } = getIntentMessages(signData)
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
    const originSigners = await resolveSignersForChain(
      config,
      signers,
      chain.id,
    )
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

  const destinationSigners = await resolveSignersForChain(
    config,
    signers,
    targetChain.id,
  )

  const destinationSignature = await getDestinationSignature(
    config,
    destinationSigners,
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
  signers: InternalSignerSet | undefined,
  validator: Module,
  isRoot: boolean,
  targetChain: Chain,
  destination: TypedDataDefinition,
  originSignatures: OriginSignature[],
  targetExecution: boolean,
): Promise<Hex> {
  // Smart sessions require a separate destination signature because the
  // session enable data differs per chain
  if (signers?.type === 'experimental_session') {
    return await signDestinationSeparately(
      config,
      signers,
      validator,
      isRoot,
      targetChain,
      destination,
      targetExecution,
    )
  }

  // ERC-7739 with K1 validator requires a separate destination signature because
  // the account's eip712Domain() returns the target chain's chainId, which differs
  // from the origin chain used for the last origin signature
  const isK1Validator =
    validator.address.toLowerCase() ===
    K1_DEFAULT_VALIDATOR_ADDRESS.toLowerCase()
  if (isK1Validator && supportsEip712(validator)) {
    return await signDestinationSeparately(
      config,
      signers,
      validator,
      isRoot,
      targetChain,
      destination,
      targetExecution,
    )
  }

  const lastOriginSignature = originSignatures.at(-1)
  return typeof lastOriginSignature === 'object'
    ? lastOriginSignature.preClaimSig
    : (lastOriginSignature ?? '0x')
}

async function signDestinationSeparately(
  config: RhinestoneConfig,
  signers: InternalSignerSet | undefined,
  validator: Module,
  isRoot: boolean,
  targetChain: Chain,
  destination: TypedDataDefinition,
  targetExecution: boolean,
): Promise<Hex> {
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

function getIntentMessages(signData: SignData): {
  origin: TypedDataDefinition[]
  destination: TypedDataDefinition
  targetExecution?: TypedDataDefinition
} {
  return {
    origin: signData.origin.map(prepareTypedData),
    destination: prepareTypedData(signData.destination),
    targetExecution: signData.targetExecution
      ? prepareTypedData(signData.targetExecution)
      : undefined,
  }
}

// Server emits uint*/int* values as decimal strings; viem's hashTypedData
// expects bigint. Walk the message tree against the type schema and coerce
// numeric fields back to bigint before signing.
function prepareTypedData(td: TypedDataDefinition): TypedDataDefinition {
  const types = td.types as TypedDataTypes
  return {
    ...td,
    message: coerceTypedDataMessage(
      types,
      td.primaryType as string,
      td.message as TypedDataMessage,
    ),
  } as TypedDataDefinition
}

function coerceTypedDataMessage(
  types: TypedDataTypes,
  primaryType: string,
  message: TypedDataMessage,
): TypedDataMessage {
  const fields = types[primaryType]
  if (!fields) return message
  const result: TypedDataMessage = { ...message }
  for (const { name, type } of fields) {
    if (name in message) {
      result[name] = coerceTypedDataValue(types, type, message[name])
    }
  }
  return result
}

function coerceTypedDataValue(
  types: TypedDataTypes,
  type: string,
  value: unknown,
): unknown {
  if (value === null || value === undefined) return value
  const arrayMatch = type.match(/^(.+)\[\d*\]$/)
  if (arrayMatch) {
    const elementType = arrayMatch[1]
    if (!Array.isArray(value)) return value
    return value.map((v) => coerceTypedDataValue(types, elementType, v))
  }
  if (/^u?int\d*$/.test(type)) {
    if (typeof value === 'string' || typeof value === 'number') {
      return BigInt(value)
    }
    return value
  }
  if (types[type]) {
    return coerceTypedDataMessage(types, type, value as TypedDataMessage)
  }
  return value
}

/** Computes claim policy calldata when parameters are Permit2 typed data with claim policies. */
function resolveClaimPolicyData<
  typedData extends TypedData | Record<string, unknown>,
  primaryType extends keyof typedData | 'EIP712Domain',
>(
  signers: ResolvedSessionSignerSet,
  parameters: HashTypedDataParameters<typedData, primaryType>,
): Hex | undefined {
  if (
    parameters.primaryType !== 'PermitBatchWitnessTransferFrom' ||
    !signers.session.claimPolicies.length
  ) {
    return undefined
  }
  const msg = parameters.message as Record<string, unknown>
  if (
    !msg.permitted ||
    !msg.mandate ||
    typeof msg.spender !== 'string' ||
    typeof msg.nonce !== 'bigint' ||
    typeof msg.deadline !== 'bigint'
  ) {
    return undefined
  }
  return undefined
}

async function signIntentTypedData<
  typedData extends TypedData | Record<string, unknown> = TypedData,
  primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
>(
  config: RhinestoneConfig,
  signers: InternalSignerSet | undefined,
  validator: Module,
  isRoot: boolean,
  parameters: HashTypedDataParameters<typedData, primaryType>,
  chain: Chain,
  targetExecution: boolean,
) {
  if (supportsEip712(validator)) {
    const isK1Validator =
      validator.address.toLowerCase() ===
      K1_DEFAULT_VALIDATOR_ADDRESS.toLowerCase()
    if (isK1Validator) {
      return await signErc7739TypedData(
        config,
        signers,
        validator,
        isRoot,
        parameters,
        chain,
      )
    }
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
  if (isResolvedSessionSignerSet(signers) && signers.verifyExecutions) {
    if (targetExecution) {
      const targetSigners: ResolvedSessionSignerSet = {
        type: 'experimental_session',
        session: signers.session,
        verifyExecutions: true,
        enableData: signers.enableData,
      }
      // signWithSession (called inside getEmissarySignature) already calls packSignature
      // internally, so no transform is needed here
      return await getEmissarySignature(config, targetSigners, chain, hash)
    }
    const claimPolicyData = resolveClaimPolicyData(signers, parameters)
    const sessionSignersForEip1271: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: signers.session,
      verifyExecutions: false,
      enableData: signers.enableData,
      claimPolicyData,
    }
    const eip1271Signature = await getEip1271Signature(
      config,
      sessionSignersForEip1271,
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
      } satisfies ResolvedSessionSignerSet,
      chain,
      hash,
    )
    return {
      preClaimSig: emissarySignature,
      notarizedClaimSig: eip1271Signature,
    }
  }

  if (isResolvedSessionSignerSet(signers)) {
    const claimPolicyData = resolveClaimPolicyData(signers, parameters)
    return await getEip1271Signature(
      config,
      claimPolicyData !== undefined ? { ...signers, claimPolicyData } : signers,
      chain,
      {
        address: validator.address,
        isRoot,
      },
      hash,
    )
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

async function submitIntentInternal(
  config: RhinestoneConfig,
  sourceChains: Chain[] | undefined,
  targetChain: Chain,
  quote: Quote,
  originSignatures: OriginSignature[],
  destinationSignature: Hex,
  targetExecutionSignature: Hex | undefined,
  authorizations: SignedAuthorizationList,
  dryRun: boolean,
  intentInput?: unknown,
): Promise<TransactionResult> {
  const request: IntentSubmitRequestInternal = {
    intentId: quote.intentId,
    signatures: {
      origin: originSignatures,
      destination: destinationSignature,
      ...(targetExecutionSignature !== undefined && {
        targetExecution: targetExecutionSignature,
      }),
    },
    ...(authorizations.length > 0 && {
      authorizations: {
        sponsor: authorizations.map((authorization) => ({
          chainId: authorization.chainId,
          address: authorization.address,
          nonce: authorization.nonce,
          yParity: authorization.yParity ?? 0,
          r: authorization.r,
          s: authorization.s,
        })),
      },
    }),
    ...(dryRun && { options: { dryRun: true } }),
  }
  const isSponsored = !!(
    intentInput as { options?: { sponsorSettings?: unknown } } | undefined
  )?.options?.sponsorSettings
  const orchestrator = getOrchestrator(
    config._authProvider ?? createAuthProvider(config),
    config.endpointUrl,
    config.headers,
  )
  const response = await orchestrator.createIntent(
    request,
    intentInput ? { intentInput, isSponsored } : undefined,
  )
  return {
    type: 'intent',
    id: response.intentId,
    sourceChains: sourceChains?.map((chain) => chain.id),
    targetChain: targetChain.id,
  }
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
      const chainTokens: Record<number, Address[]> = {}
      const chainTokenAmounts: Record<number, Record<Address, bigint>> = {}
      for (const config of sourceAssets as ExactInputConfig[]) {
        const chainId = config.chain.id
        const tokenAddress = resolveTokenAddress(
          config.address,
          config.chain.id,
        )
        if (config.amount !== undefined) {
          if (!chainTokenAmounts[chainId]) chainTokenAmounts[chainId] = {}
          chainTokenAmounts[chainId][tokenAddress] = config.amount
        } else {
          if (!chainTokens[chainId]) chainTokens[chainId] = []
          chainTokens[chainId].push(tokenAddress)
        }
      }
      const out: MappedChainTokenAccessList = {}
      if (Object.keys(chainTokens).length > 0) {
        out.chainTokens =
          chainTokens as MappedChainTokenAccessList['chainTokens']
      }
      if (Object.keys(chainTokenAmounts).length > 0) {
        out.chainTokenAmounts =
          chainTokenAmounts as MappedChainTokenAccessList['chainTokenAmounts']
      }
      return out
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

// Signs typed data using ERC-7739 nested EIP-712 for Startale accounts.
// Uses a Solady-compatible TypedDataSign hash and wraps the signature with
// the app domain separator and contents hash for on-chain verification.
async function signErc7739TypedData<
  typedData extends TypedData | Record<string, unknown> = TypedData,
  primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
>(
  config: RhinestoneConfig,
  signers: InternalSignerSet | undefined,
  validator: Module,
  isRoot: boolean,
  parameters: HashTypedDataParameters<typedData, primaryType>,
  chain: Chain,
) {
  const verifierDomain = getEip712Domain(config, chain)
  const hash = hashErc7739TypedDataForSolady({
    domain: parameters.domain as TypedDataDomain,
    types: parameters.types as TypedData,
    primaryType: parameters.primaryType as string,
    message: parameters.message as Record<string, unknown>,
    verifierDomain,
  })
  return await getEip1271Signature(
    config,
    signers,
    chain,
    {
      address: validator.address,
      isRoot,
    },
    hash,
    (signature) =>
      wrapTypedDataSignature({
        domain: parameters.domain as TypedDataDomain,
        primaryType: parameters.primaryType as string,
        types: parameters.types as TypedData,
        message: parameters.message as Record<string, unknown>,
        signature,
      }),
  )
}

// Computes an ERC-7739 TypedDataSign hash compatible with Solady's ERC1271
// on-chain verification. Solady constructs the TypedDataSign type string by
// appending the contentsType directly after the TypedDataSign definition,
// which differs from viem's standard EIP-712 encodeType that re-sorts all
// referenced types alphabetically.
function hashErc7739TypedDataForSolady({
  domain,
  types,
  primaryType,
  message,
  verifierDomain,
}: {
  domain: TypedDataDomain
  types: TypedData
  primaryType: string
  message: Record<string, unknown>
  verifierDomain: {
    name: string
    version: string
    chainId: number
    verifyingContract: Address
    salt: Hex
  }
}): Hex {
  type TypeField = { name: string; type: string }
  // Standard EIP-712 encodeType for the original content type
  function encodeTypeString(
    primary: string,
    allTypes: Record<string, readonly TypeField[]>,
  ): string {
    const deps = new Set<string>()
    function findDeps(t: string) {
      const match = t.match(/^\w*/)
      const typeName = match?.[0]
      if (!typeName || deps.has(typeName) || !allTypes[typeName]) return
      deps.add(typeName)
      for (const field of allTypes[typeName]) findDeps(field.type)
    }
    findDeps(primary)
    deps.delete(primary)
    const sorted = [primary, ...Array.from(deps).sort()]
    return sorted
      .map(
        (t) =>
          `${t}(${allTypes[t].map((f: TypeField) => `${f.type} ${f.name}`).join(',')})`,
      )
      .join('')
  }

  const contentsType = encodeTypeString(
    primaryType,
    types as Record<string, readonly TypeField[]>,
  )
  const contentsName = primaryType

  // Construct TypedDataSign type string matching Solady's on-chain encoding:
  // TypedDataSign(<contentsName> contents,...salt) + contentsType
  const typedDataSignTypeString = `TypedDataSign(${contentsName} contents,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)${contentsType}`
  const typedDataSignTypeHash = keccak256(toHex(typedDataSignTypeString))

  // Hash the original content struct
  const contentsHash = hashStruct({
    data: message,
    primaryType,
    types: types as Record<string, readonly TypeField[]>,
  })

  // Compute the TypedDataSign struct hash
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'bytes32' },
      ],
      [
        typedDataSignTypeHash,
        contentsHash,
        keccak256(toHex(verifierDomain.name)),
        keccak256(toHex(verifierDomain.version)),
        BigInt(verifierDomain.chainId),
        verifierDomain.verifyingContract,
        verifierDomain.salt,
      ],
    ),
  )

  // Compute the app domain separator
  const domainTypes = []
  if (domain.name) domainTypes.push({ name: 'name', type: 'string' })
  if (domain.version) domainTypes.push({ name: 'version', type: 'string' })
  if (domain.chainId) domainTypes.push({ name: 'chainId', type: 'uint256' })
  if (domain.verifyingContract)
    domainTypes.push({ name: 'verifyingContract', type: 'address' })
  if (domain.salt) domainTypes.push({ name: 'salt', type: 'bytes32' })

  const appDomainSeparator = hashDomain({
    domain,
    types: { EIP712Domain: domainTypes },
  } as any)

  // Final hash: keccak256("\x19\x01" || appDomainSep || structHash)
  return keccak256(concat(['0x1901', appDomainSeparator, structHash]))
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
  signIntent,
  prepareTransactionAsIntent,
  submitIntentInternal,
  getValidatorAccount,
  parseCalls,
  getTokenRequests,
  resolveCallInputs,
  getIntentAccount,
  getTargetExecutionSignature,
  hashErc7739TypedDataForSolady,
  resolveSessionForChain,
}
export type {
  InternalSignerSet,
  TransactionResult,
  PreparedQuotes,
  PreparedTransactionData,
  PreparedUserOperationData,
  QuoteSelection,
  SignedTransactionData,
  SignedUserOperationData,
  UserOperationResult,
}
