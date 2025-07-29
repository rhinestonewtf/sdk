import {
  type Address,
  type Chain,
  createPublicClient,
  type Hex,
  type PublicClient,
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
  getGuardianSmartAccount,
  getInitCode,
  getPackedSignature,
  getSmartAccount,
  getSmartSessionSmartAccount,
} from '../accounts'
import { createTransport, getBundlerClient } from '../accounts/utils'
import {
  getOwnerValidator,
  getSmartSessionValidator,
} from '../modules/validators'
import {
  getMultiFactorValidator,
  getOwnableValidator,
  getSocialRecoveryValidator,
  getWebAuthnValidator,
} from '../modules/validators/core'
import {
  getIntentOpHash,
  getOrchestrator,
  type IntentInput,
  type IntentOp,
  type IntentRoute,
  type SupportedChain,
} from '../orchestrator'
import {
  PROD_ORCHESTRATOR_URL,
  STAGING_ORCHESTRATOR_URL,
} from '../orchestrator/consts'
import { isTestnet, resolveTokenAddress } from '../orchestrator/registry'
import type {
  Call,
  CallInput,
  RhinestoneAccountConfig,
  SignerSet,
  TokenRequest,
  Transaction,
} from '../types'
import {
  OrderPathRequiredForIntentsError,
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
      sourceChain?: number
      targetChain: number
    }

interface IntentData {
  type: 'intent'
  hash: Hex
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
  const { sourceChains, targetChain, tokenRequests, signers, sponsored } =
    getTransactionParams(transaction)
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
    signature = await signIntent(config, targetChain, data.hash, signers)
  }

  return {
    data,
    transaction: preparedTransaction.transaction,
    signature,
  }
}

async function submitTransaction(
  config: RhinestoneAccountConfig,
  signedTransaction: SignedTransactionData,
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
  const sponsored = transaction.sponsored

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
  }
}

async function prepareTransactionAsUserOp(
  config: RhinestoneAccountConfig,
  chain: Chain,
  callInputs: CallInput[],
  signers: SignerSet | undefined,
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
) {
  const initCode = getInitCode(config)
  const calls = parseCalls(callInputs, targetChain.id)
  const accountAccessList =
    sourceChains && sourceChains.length > 0
      ? {
          chainIds: sourceChains.map((chain) => chain.id as SupportedChain),
        }
      : undefined

  const metaIntent: IntentInput = {
    destinationChainId: targetChain.id,
    tokenTransfers: tokenRequests.map((tokenRequest) => ({
      tokenAddress: resolveTokenAddress(tokenRequest.address, targetChain.id),
      amount: tokenRequest.amount,
    })),
    account: {
      address: accountAddress,
      accountType: 'ERC7579',
      setupOps: initCode
        ? [
            {
              to: initCode.factory,
              data: initCode.factoryData,
            },
          ]
        : [
            {
              to: zeroAddress,
              data: '0x',
            },
          ],
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
    },
  }

  const orchestrator = getOrchestratorByChain(
    targetChain.id,
    config.rhinestoneApiKey,
  )
  const intentRoute = await orchestrator.getIntentRoute(metaIntent)
  const intentHash = getIntentOpHash(intentRoute.intentOp)

  return {
    type: 'intent',
    intentRoute,
    hash: intentHash,
  } as IntentData
}

async function signIntent(
  config: RhinestoneAccountConfig,
  targetChain: Chain,
  intentHash: Hex,
  signers?: SignerSet,
) {
  const validator = getValidator(config, signers)
  if (!validator) {
    throw new Error('Validator not available')
  }
  const ownerValidator = getOwnerValidator(config)
  const isRoot = validator.address === ownerValidator.address

  const signature = await getPackedSignature(
    config,
    signers,
    targetChain,
    {
      address: validator.address,
      isRoot,
    },
    intentHash,
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
) {
  return submitIntentInternal(
    config,
    sourceChains,
    targetChain,
    intentOp,
    signature,
  )
}

function getOrchestratorByChain(chainId: number, apiKey: string) {
  const orchestratorUrl = isTestnet(chainId)
    ? STAGING_ORCHESTRATOR_URL
    : PROD_ORCHESTRATOR_URL
  return getOrchestrator(apiKey, orchestratorUrl)
}

async function submitIntentInternal(
  config: RhinestoneAccountConfig,
  sourceChains: Chain[] | undefined,
  targetChain: Chain,
  intentOp: IntentOp,
  signature: Hex,
) {
  const signedIntentOp = {
    ...intentOp,
    originSignatures: Array(intentOp.elements.length).fill(signature),
    destinationSignature: signature,
  }
  const orchestrator = getOrchestratorByChain(
    targetChain.id,
    config.rhinestoneApiKey,
  )
  const intentResults = await orchestrator.submitIntent(signedIntentOp)
  return {
    type: 'intent',
    id: BigInt(intentResults.result.id),
    sourceChains: sourceChains?.map((chain) => chain.id),
    targetChain: targetChain.id,
  } as TransactionResult
}

async function getValidatorAccount(
  config: RhinestoneAccountConfig,
  signers: SignerSet | undefined,
  publicClient: PublicClient,
  chain: Chain,
) {
  if (!signers) {
    return undefined
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
      const passkeyAccount = withOwner.account
      return getWebAuthnValidator({
        pubKey: passkeyAccount.publicKey,
        authenticatorId: passkeyAccount.id,
      })
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

export {
  prepareTransaction,
  signTransaction,
  submitTransaction,
  getOrchestratorByChain,
  signIntent,
  prepareTransactionAsIntent,
  submitIntentInternal,
  getValidatorAccount,
  parseCalls,
}
export type {
  IntentData,
  TransactionResult,
  PreparedTransactionData,
  SignedTransactionData,
}
