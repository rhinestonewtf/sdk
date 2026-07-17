import type {
  Address,
  Chain,
  HashTypedDataParameters,
  Hex,
  SignableMessage,
  SignedAuthorizationList,
  TypedData,
  TypedDataDefinition,
} from 'viem'
import type { UserOperationReceipt } from 'viem/account-abstraction'
import { parseCaip2, toEvmChainReference } from '../chains/caip2'
import { getChainReference, sharedChainCatalog } from '../chains/catalog'
import { normalizeTokenAddress } from '../chains/tokens'
import type {
  OrchestratorAccountAccessList,
  OrchestratorQuote,
} from '../clients/orchestrator/types'
import type { LegacyAccountConfig } from '../config/legacy'
import { materializeAccountInvocationContext } from '../config/resolve'
import type { AccountInvocationContext } from '../config/resolved'
// Public compatibility types are sourced from their current (transitional)
// owners; commit 8 relocates these to their permanent rewrite homes.
import type {
  TransactionResult,
  TransactionStatus,
  UserOperationResult,
} from '../execution'
import type {
  OwnerSignature,
  PreparedTransactionData,
  PreparedUserOperationData,
  QuoteSelection,
  SignAsOwnerOptions,
  SignedTransactionData,
  SignedUserOperationData,
} from '../execution/utils'
import type { SessionDetails } from '../modules/validators/smart-sessions/types'
import type { DestinationChain } from '../orchestrator'
import type {
  OriginSignature,
  Portfolio,
  Quote,
  SignData,
} from '../orchestrator/types'
import { IndependentSigningNotSupportedError } from '../signing/error'
import type {
  IntentInput,
  PreparedIntent,
  SignedIntent,
} from '../transactions/intents/types'
import type { PreparedUserOperation } from '../transactions/user-operations/types'
import type {
  CallInput,
  RhinestoneAccountConfig,
  Session,
  SignerSet,
  SourceAssetInput,
  Transaction,
  UserOperationTransaction,
} from '../types'
import type { CoreComposition } from './compose-types'

interface SubmitTransactionOptions {
  authorizations?: SignedAuthorizationList
  internal_dryRun?: boolean
}

interface SignedIntentData {
  originSignatures: OriginSignature[]
  destinationSignature: Hex
  targetExecutionSignature: Hex | undefined
}

type Compat = LegacyAccountConfig<unknown>

/**
 * The account facade. Mirrors the published `RhinestoneAccount` surface, but
 * every method materializes a fresh invocation context from the retained
 * mutable compatibility config and delegates to the SDK-core composition.
 */
export interface RhinestoneAccount {
  config: RhinestoneAccountConfig
  deploy(chain: Chain, params?: { sponsored?: boolean }): Promise<boolean>
  isDeployed(chain: Chain): Promise<boolean>
  setup(chain: Chain): Promise<boolean>
  getInitData(): { factory: Address; factoryData: Hex }
  signEip7702InitData(): Promise<Hex>
  prepareTransaction(transaction: Transaction): Promise<PreparedTransactionData>
  getTransactionMessages(
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ): {
    origin: TypedDataDefinition[]
    destination: TypedDataDefinition
    targetExecution?: TypedDataDefinition
  }
  signTransaction(
    preparedTransaction: PreparedTransactionData,
    options: SignAsOwnerOptions,
  ): Promise<OwnerSignature>
  signTransaction(
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ): Promise<SignedTransactionData>
  assembleTransaction(
    preparedTransaction: PreparedTransactionData,
    signatures: OwnerSignature[],
  ): Promise<SignedTransactionData>
  signAuthorizations(
    preparedTransaction: PreparedTransactionData,
  ): Promise<SignedAuthorizationList>
  signMessage(
    message: SignableMessage,
    chain: Chain,
    signers: SignerSet | undefined,
  ): Promise<Hex>
  signTypedData<
    typedData extends TypedData | Record<string, unknown> = TypedData,
    primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
  >(
    parameters: HashTypedDataParameters<typedData, primaryType>,
    chain: Chain,
    signers: SignerSet | undefined,
  ): Promise<Hex>
  signIntent(
    signData: SignData,
    targetChain: DestinationChain,
    signers?: SignerSet,
  ): Promise<SignedIntentData>
  submitTransaction(
    signedTransaction: SignedTransactionData,
    options?: SubmitTransactionOptions,
  ): Promise<TransactionResult>
  prepareUserOperation(
    transaction: UserOperationTransaction,
  ): Promise<PreparedUserOperationData>
  signUserOperation(
    preparedUserOperation: PreparedUserOperationData,
  ): Promise<SignedUserOperationData>
  submitUserOperation(
    signedUserOperation: SignedUserOperationData,
  ): Promise<UserOperationResult>
  sendUserOperation(
    transaction: UserOperationTransaction,
  ): Promise<UserOperationResult>
  waitForExecution(result: TransactionResult): Promise<TransactionStatus>
  waitForExecution(result: UserOperationResult): Promise<UserOperationReceipt>
  getAddress(): Address
  getPortfolio(onTestnets?: boolean): Promise<Portfolio>
  experimental_getSessionDetails(sessions: Session[]): Promise<SessionDetails>
  experimental_isSessionEnabled(session: Session): Promise<boolean>
  experimental_signEnableSession(details: SessionDetails): Promise<Hex>
  getOwners(chain: Chain): Promise<{
    accounts: Address[]
    threshold: number
  } | null>
  getValidators(chain: Chain): Promise<Address[]>
  getExecutors(chain: Chain): Promise<Address[]>
}

// Internal intent state is cached by identity as a fast path for same-instance
// flows (avoids re-issuing RPC reads and re-resolving sessions). When the public
// object crosses SDK instances (paired replay) or is externally rebuilt, it is
// reconstructed from the public shape instead (see reconstructInput).
const preparedIntents = new WeakMap<object, PreparedIntent<Compat>>()
const signedIntents = new WeakMap<object, SignedIntent<Compat>>()
const preparedUserOperations = new WeakMap<
  object,
  PreparedUserOperation<Compat>
>()
const signedUserOperations = new WeakMap<
  object,
  import('../transactions/user-operations/types').SignedUserOperation<Compat>
>()

function toPublicQuote(quote: OrchestratorQuote): Quote {
  return quote as unknown as Quote
}

function toPreparedTransactionData(
  prepared: PreparedIntent<Compat>,
  transaction: Transaction,
): PreparedTransactionData {
  const data: PreparedTransactionData = {
    quotes: {
      traceId: prepared.traceId,
      best: toPublicQuote(prepared.quote),
      all: prepared.quotes.map(toPublicQuote),
    },
    intentInput: prepared.request,
    transaction,
  }
  preparedIntents.set(data, prepared)
  return data
}

function selectedPublicQuote(
  prepared: PreparedTransactionData,
  intentId?: string,
): Quote {
  if (!intentId) return prepared.quotes.best
  return (
    prepared.quotes.all.find((quote) => quote.intentId === intentId) ??
    prepared.quotes.best
  )
}

function reconstructInput(
  prepared: PreparedTransactionData,
  intentId?: string,
): Parameters<
  ReturnType<
    CoreComposition<Compat>['createAccount']
  >['workflows']['reconstructPreparedIntent']
>[1] {
  const quote = selectedPublicQuote(prepared, intentId)
  return {
    traceId: prepared.quotes.traceId,
    quote: quote as unknown as PreparedIntent<Compat>['quote'],
    quotes: prepared.quotes.all as unknown as PreparedIntent<Compat>['quotes'],
    request: prepared.intentInput as PreparedIntent<Compat>['request'],
    intentInput: adaptTransaction(prepared.transaction),
  }
}

function toSignedTransactionData(
  prepared: PreparedTransactionData,
  signed: SignedIntent<Compat>,
): SignedTransactionData {
  const data: SignedTransactionData = {
    ...prepared,
    quote: toPublicQuote(signed.prepared.quote),
    originSignatures:
      signed.originSignatures as SignedTransactionData['originSignatures'],
    destinationSignature: signed.destinationSignature,
    targetExecutionSignature: signed.targetSignature,
  }
  signedIntents.set(data, signed)
  return data
}

function referenceChain(): import('../chains/types').EvmChainReference {
  for (const id of sharedChainCatalog.getSupportedChainIds()) {
    try {
      return toEvmChainReference(id)
    } catch {
      // Not an EVM chain; keep looking.
    }
  }
  throw new Error('No EVM chain is available for account initialization')
}

export function createAccountFacade(
  compatibilityConfig: LegacyAccountConfig<unknown>,
  composition: CoreComposition<LegacyAccountConfig<unknown>>,
): RhinestoneAccount {
  const context = (
    method: AccountInvocationContext<LegacyAccountConfig<unknown>>['method'],
  ) =>
    materializeAccountInvocationContext(
      composition.config,
      compatibilityConfig,
      method,
    )
  const workflowsFor = (
    ctx: AccountInvocationContext<LegacyAccountConfig<unknown>>,
  ) => composition.createAccount(ctx).workflows

  const resolvePrepared = (
    ctx: AccountInvocationContext<Compat>,
    prepared: PreparedTransactionData,
    intentId?: string,
  ): Promise<PreparedIntent<Compat>> => {
    const cached = preparedIntents.get(prepared)
    if (cached && !intentId) return Promise.resolve(cached)
    return workflowsFor(ctx).reconstructPreparedIntent(
      ctx,
      reconstructInput(prepared, intentId),
    )
  }

  const account: RhinestoneAccount = {
    config: compatibilityConfig as unknown as RhinestoneAccountConfig,
    deploy(chain, params) {
      const ctx = context('deploy')
      return workflowsFor(ctx).deploy(ctx, toEvmChainReference(chain.id), {
        ...(params?.sponsored !== undefined
          ? { sponsored: params.sponsored }
          : {}),
      })
    },
    isDeployed(chain) {
      const ctx = context('is-deployed')
      return workflowsFor(ctx).isDeployed(ctx, toEvmChainReference(chain.id))
    },
    setup(chain) {
      const ctx = context('setup')
      return workflowsFor(ctx).setup(ctx, toEvmChainReference(chain.id))
    },
    getInitData() {
      const ctx = context('get-init-data')
      return workflowsFor(ctx).getInitData(ctx)
    },
    async signEip7702InitData() {
      const ctx = context('sign-eip7702-init-data')
      const result = await workflowsFor(ctx).signEip7702InitData(
        ctx,
        referenceChain(),
      )
      return result.signature
    },
    async prepareTransaction(transaction) {
      const ctx = context('prepare-intent')
      const prepared = await workflowsFor(ctx).prepareIntent(
        ctx,
        adaptTransaction(transaction),
      )
      return toPreparedTransactionData(prepared, transaction)
    },
    getTransactionMessages(preparedTransaction, options) {
      const quote = selectedPublicQuote(preparedTransaction, options?.intentId)
      return {
        origin: [...quote.signData.origin],
        destination: quote.signData.destination,
        ...(quote.signData.targetExecution
          ? { targetExecution: quote.signData.targetExecution }
          : {}),
      }
    },
    signTransaction: ((
      preparedTransaction: PreparedTransactionData,
      options?: QuoteSelection | SignAsOwnerOptions,
    ): Promise<SignedTransactionData | OwnerSignature> => {
      const ctx = context('sign-intent')
      const workflows = workflowsFor(ctx)
      if (options && 'owner' in options) {
        // Independent owner signing is unsupported for smart-session intents;
        // reject before resolving sessions (which would issue an RPC read),
        // matching the legacy fast-fail.
        if (adaptTransaction(preparedTransaction.transaction).signers) {
          return Promise.reject(new IndependentSigningNotSupportedError())
        }
        const signerId = signerIdForOwner(options.owner)
        return resolvePrepared(ctx, preparedTransaction).then(
          (internal) =>
            workflows.signIntentAsOwner(
              ctx,
              internal,
              signerId,
            ) as unknown as Promise<OwnerSignature>,
        )
      }
      return resolvePrepared(ctx, preparedTransaction, options?.intentId)
        .then((internal) => workflows.signIntent(ctx, internal))
        .then(({ intent }) =>
          toSignedTransactionData(preparedTransaction, intent),
        )
    }) as unknown as RhinestoneAccount['signTransaction'],
    async assembleTransaction(preparedTransaction, signatures) {
      const ctx = context('assemble-intent')
      const workflows = workflowsFor(ctx)
      const internal = await resolvePrepared(ctx, preparedTransaction)
      const signed = await workflows.assembleIntent(
        ctx,
        internal,
        signatures as unknown as Parameters<typeof workflows.assembleIntent>[2],
      )
      return toSignedTransactionData(preparedTransaction, signed)
    },
    async signAuthorizations(preparedTransaction) {
      const ctx = context('sign-authorizations')
      const intentInput = adaptTransaction(preparedTransaction.transaction)
      const chains = intentInput.sourceChains
        ? [...intentInput.sourceChains]
        : [intentInput.destination]
      const result = await workflowsFor(ctx).signAuthorizations(ctx, {
        chains,
        ...(intentInput.eip7702InitSignature
          ? { eip7702InitSignature: intentInput.eip7702InitSignature }
          : {}),
      })
      return result.authorizations as SignedAuthorizationList
    },
    async signMessage(message, chain, _signers) {
      const ctx = context('sign-message')
      const result = await workflowsFor(ctx).signMessage(ctx, {
        message,
        chain: toEvmChainReference(chain.id),
      })
      return result.signature
    },
    async signTypedData(parameters, chain, _signers) {
      const ctx = context('sign-typed-data')
      const result = await workflowsFor(ctx).signTypedData(ctx, {
        typedData: parameters as unknown as TypedDataDefinition,
        chain: toEvmChainReference(chain.id),
      })
      return result.signature
    },
    async signIntent(signData, targetChain, signers) {
      const ctx = context('sign-intent')
      const result = await workflowsFor(ctx).signIntentFromSignData(ctx, {
        signData: {
          origin: signData.origin,
          destination: signData.destination,
          ...(signData.targetExecution
            ? { targetExecution: signData.targetExecution }
            : {}),
        },
        targetChain: destinationChainReference(targetChain),
        ...(signers ? { signers: adaptSignerSelection(signers) } : {}),
      })
      return {
        originSignatures:
          result.originSignatures as SignedIntentData['originSignatures'],
        destinationSignature: result.destinationSignature,
        targetExecutionSignature: result.targetExecutionSignature,
      }
    },
    async submitTransaction(signedTransaction, options) {
      const ctx = context('submit-intent')
      const workflows = workflowsFor(ctx)
      // Fast path for the same-instance signed object; otherwise (cross-instance
      // replay or caller-tampered signatures) rebuild from the public shape.
      const cached = signedIntents.get(signedTransaction)
      const base: SignedIntent<Compat> = cached ?? {
        prepared: await resolvePrepared(ctx, signedTransaction),
        originSignatures:
          signedTransaction.originSignatures as SignedIntent<Compat>['originSignatures'],
        destinationSignature: signedTransaction.destinationSignature,
        ...(signedTransaction.targetExecutionSignature
          ? { targetSignature: signedTransaction.targetExecutionSignature }
          : {}),
        transcript: { planKind: 'intent-full', payloadId: '0x', stages: [] },
      }
      const signed: SignedIntent<Compat> = {
        ...base,
        ...(options?.authorizations
          ? { authorizations: options.authorizations }
          : {}),
        ...(options?.internal_dryRun ? { dryRun: true } : {}),
      }
      const submitted = await workflows.submitIntent(ctx, signed)
      return {
        type: 'intent',
        id: submitted.intentId,
        traceId: submitted.traceId,
        ...(submitted.sourceChains
          ? { sourceChains: [...submitted.sourceChains] }
          : {}),
        targetChain: submitted.targetChain,
      }
    },
    async prepareUserOperation(transaction) {
      const ctx = context('prepare-user-operation')
      const prepared = await workflowsFor(ctx).prepareUserOperation(ctx, {
        chain: toEvmChainReference(transaction.chain.id),
        calls: transaction.calls.map((call) =>
          adaptCall(call, transaction.chain.id),
        ),
        ...(transaction.gasLimit === undefined
          ? {}
          : { gasLimit: transaction.gasLimit }),
      })
      const data: PreparedUserOperationData = {
        userOperation:
          prepared.operation as unknown as PreparedUserOperationData['userOperation'],
        hash: prepared.hash,
        transaction,
      }
      preparedUserOperations.set(data, prepared)
      return data
    },
    async signUserOperation(preparedUserOperation) {
      const ctx = context('sign-user-operation')
      const internal = preparedUserOperations.get(preparedUserOperation)
      if (!internal) {
        throw new Error(
          'Prepared user operation was not created by this SDK instance',
        )
      }
      const signed = await workflowsFor(ctx).signUserOperation(ctx, internal)
      const data: SignedUserOperationData = {
        ...preparedUserOperation,
        userOperation:
          signed.operation as unknown as SignedUserOperationData['userOperation'],
        signature: signed.signature,
      }
      signedUserOperations.set(data, signed)
      return data
    },
    async submitUserOperation(signedUserOperation) {
      const ctx = context('submit-user-operation')
      const internal = signedUserOperations.get(signedUserOperation)
      if (!internal) {
        throw new Error(
          'Signed user operation was not created by this SDK instance',
        )
      }
      const submitted = await workflowsFor(ctx).submitUserOperation(
        ctx,
        internal,
      )
      return { type: 'userop', hash: submitted.hash, chain: submitted.chain.id }
    },
    async sendUserOperation(transaction) {
      const ctx = context('send-user-operation')
      const submitted = await workflowsFor(ctx).sendUserOperation(ctx, {
        chain: toEvmChainReference(transaction.chain.id),
        calls: transaction.calls.map((call) =>
          adaptCall(call, transaction.chain.id),
        ),
        ...(transaction.gasLimit === undefined
          ? {}
          : { gasLimit: transaction.gasLimit }),
      })
      return { type: 'userop', hash: submitted.hash, chain: submitted.chain.id }
    },
    waitForExecution: ((
      result: TransactionResult | UserOperationResult,
    ): Promise<TransactionStatus | UserOperationReceipt> => {
      if (result.type === 'intent') {
        const ctx = context('wait-for-execution')
        return workflowsFor(ctx)
          .waitForIntentStatus(ctx, result.id)
          .then((status) => ({
            traceId: status.traceId,
            status: status.status as TransactionStatus['status'],
            accountAddress: status.account,
            operations: status.operations as TransactionStatus['operations'],
          }))
      }
      const ctx = context('wait-for-execution')
      return workflowsFor(ctx)
        .waitForUserOperationStatus(ctx, {
          type: 'userop',
          chain: toEvmChainReference(result.chain),
          hash: result.hash,
        })
        .then((status) => status.receipt as UserOperationReceipt)
    }) as unknown as RhinestoneAccount['waitForExecution'],
    getAddress() {
      const ctx = context('get-address')
      return workflowsFor(ctx).getAddress(ctx, referenceChain())
    },
    getPortfolio(onTestnets = false) {
      const ctx = context('get-portfolio')
      return workflowsFor(ctx)
        .getPortfolio(ctx, onTestnets)
        .then((portfolio) => portfolio.tokens as unknown as Portfolio)
    },
    experimental_getSessionDetails(sessions) {
      const ctx = context('get-session-details')
      return workflowsFor(ctx).getSessionDetails(ctx, sessions)
    },
    experimental_isSessionEnabled(session) {
      const ctx = context('is-session-enabled')
      return workflowsFor(ctx).isSessionEnabled(ctx, session)
    },
    experimental_signEnableSession(details) {
      const ctx = context('sign-enable-session')
      return workflowsFor(ctx).signEnableSession(ctx, details)
    },
    getOwners(chain) {
      const ctx = context('get-owners')
      return workflowsFor(ctx)
        .getOwners(ctx, toEvmChainReference(chain.id))
        .then((owners) =>
          owners
            ? { accounts: [...owners.accounts], threshold: owners.threshold }
            : null,
        )
    },
    getValidators(chain) {
      const ctx = context('get-validators')
      return workflowsFor(ctx)
        .getValidators(ctx, toEvmChainReference(chain.id))
        .then((addresses) => [...addresses])
    },
    getExecutors(chain) {
      const ctx = context('get-executors')
      return workflowsFor(ctx)
        .getExecutors(ctx, toEvmChainReference(chain.id))
        .then((addresses) => [...addresses])
    },
  }
  return account
}

function signerIdForOwner(owner: SignAsOwnerOptions['owner']): string {
  // ECDSA local accounts also expose `publicKey`, so discriminate on the
  // account type rather than the presence of a public key.
  if ((owner as { type?: string }).type === 'webAuthn') {
    return `webauthn:${((owner as { publicKey: Hex }).publicKey).toLowerCase()}`
  }
  return `ecdsa:${(owner as { address: Address }).address.toLowerCase()}`
}

function destinationChainReference(
  targetChain: DestinationChain,
): import('../chains/types').ChainReference {
  if ('kind' in targetChain && typeof targetChain.caip2 === 'string') {
    return parseCaip2(targetChain.caip2)
  }
  return getChainReference(
    sharedChainCatalog,
    (targetChain as { id: number }).id,
  )
}

function adaptSignerSelection(
  signers: SignerSet,
): IntentInput['signers'] | undefined {
  if (signers.type !== 'experimental_session') return undefined
  if ('sessions' in signers) {
    return {
      kind: 'smart-session',
      byChain: Object.fromEntries(
        Object.entries(signers.sessions).map(([chainId, selection]) => [
          Number(chainId),
          selection,
        ]),
      ),
    }
  }
  return {
    kind: 'smart-session',
    byChain: {
      [signers.session.chain.id]: {
        session: signers.session,
        ...(signers.enableData ? { enableData: signers.enableData } : {}),
      },
    },
  }
}

// Public `Transaction` -> internal `IntentInput`. Owned here because the facade
// is the only translation point between the compatibility surface and the
// intent workflow.
function adaptTransaction(transaction: Transaction): IntentInput {
  const destination =
    'chain' in transaction
      ? getChainReference(sharedChainCatalog, transaction.chain.id)
      : 'kind' in transaction.targetChain
        ? parseCaip2(transaction.targetChain.caip2)
        : getChainReference(sharedChainCatalog, transaction.targetChain.id)
  const destinationChainId =
    destination.kind === 'evm' ? destination.id : undefined
  const sourceChains =
    'chain' in transaction
      ? [getChainReference(sharedChainCatalog, transaction.chain.id)]
      : transaction.sourceChains?.map((chain) =>
          getChainReference(sharedChainCatalog, chain.id),
        )
  const evmSources = sourceChains?.flatMap((chain) =>
    chain.kind === 'evm' ? [chain] : [],
  )
  return {
    destination,
    ...(evmSources ? { sourceChains: evmSources } : {}),
    calls: (transaction.calls ?? []).map((call) =>
      adaptCall(call, destinationChainId),
    ),
    tokenRequests: (transaction.tokenRequests ?? []).map((request) => ({
      token:
        destinationChainId === undefined
          ? request.address
          : normalizeTokenAddress(
              sharedChainCatalog,
              request.address,
              destinationChainId,
              false,
            ),
      ...(request.amount === undefined ? {} : { amount: request.amount }),
    })),
    ...(typeof transaction.recipient === 'string'
      ? { recipient: transaction.recipient }
      : {}),
    ...(transaction.gasLimit === undefined
      ? {}
      : { gasLimit: transaction.gasLimit }),
    ...(transaction.eip7702InitSignature
      ? { eip7702InitSignature: transaction.eip7702InitSignature }
      : {}),
    ...(transaction.sourceAssets || sourceChains
      ? {
          accountAccessList: adaptSourceAssets(
            transaction.sourceAssets,
            evmSources?.map(({ id }) => id),
          ),
        }
      : {}),
    options: {
      ...(transaction.appFees ? { appFees: transaction.appFees } : {}),
      ...(transaction.sponsored
        ? {
            sponsorSettings:
              typeof transaction.sponsored === 'boolean'
                ? {
                    gas: transaction.sponsored,
                    bridgeFees: transaction.sponsored,
                    swapFees: transaction.sponsored,
                  }
                : {
                    gas: transaction.sponsored.gas,
                    bridgeFees: transaction.sponsored.bridging,
                    swapFees: transaction.sponsored.swaps,
                  },
          }
        : {}),
      ...(transaction.settlementLayers
        ? { settlementLayers: transaction.settlementLayers }
        : {}),
      ...(transaction.auxiliaryFunds
        ? { auxiliaryFunds: transaction.auxiliaryFunds }
        : {}),
    },
    ...(transaction.sourceCalls
      ? {
          sourceCalls: Object.fromEntries(
            Object.entries(transaction.sourceCalls).map(([chainId, calls]) => [
              Number(chainId),
              calls.map((call) => ({
                call: adaptCall(call, Number(chainId)),
                ...(call.provides ? { provides: call.provides } : {}),
              })),
            ]),
          ),
        }
      : {}),
    ...(transaction.experimental_accountOverride?.setupOps
      ? {
          accountSetupOverride:
            transaction.experimental_accountOverride.setupOps,
        }
      : {}),
    ...(transaction.signers?.type === 'experimental_session'
      ? {
          signers: {
            kind: 'smart-session',
            byChain: adaptSessionSelection(transaction, sourceChains ?? []),
          } as const,
        }
      : {}),
  }
}

function adaptCall(call: CallInput, chainId: number | undefined) {
  if ('resolve' in call) {
    return {
      resolve: async (ctx: {
        config: unknown
        chain: { id: number }
        account: Address
      }) => {
        const chain = sharedChainCatalog.getChain(ctx.chain.id)
        if (!chain) throw new Error(`Unsupported chain ${ctx.chain.id}`)
        const value = await call.resolve({
          config: ctx.config as never,
          chain,
          accountAddress: ctx.account,
        })
        return (Array.isArray(value) ? value : [value]).map((item) =>
          normalizeCall(item, ctx.chain.id),
        )
      },
    }
  }
  if (chainId === undefined) {
    throw new Error('Destination calls are not supported for non-EVM chains')
  }
  return normalizeCall(call, chainId)
}

function normalizeCall(
  call: Exclude<CallInput, { resolve: unknown }>,
  chainId: number,
) {
  return {
    target: normalizeTokenAddress(
      sharedChainCatalog,
      call.to,
      chainId,
      false,
    ) as Address,
    value: call.value ?? 0n,
    data: call.data ?? '0x',
  }
}

function adaptSessionSelection(
  transaction: Transaction,
  chains: readonly { readonly kind: string; readonly id?: number }[],
) {
  const signers = transaction.signers
  if (!signers || signers.type !== 'experimental_session') return {}
  if ('sessions' in signers) {
    return Object.fromEntries(
      Object.entries(signers.sessions).map(([chainId, selection]) => [
        Number(chainId),
        selection,
      ]),
    )
  }
  const chainIds = new Set(
    chains.flatMap((chain) =>
      chain.kind === 'evm' && chain.id !== undefined ? [chain.id] : [],
    ),
  )
  if ('chain' in transaction) chainIds.add(transaction.chain.id)
  if ('targetChain' in transaction && 'id' in transaction.targetChain) {
    chainIds.add(transaction.targetChain.id)
  }
  return Object.fromEntries(
    [...chainIds].map((chainId) => [
      chainId,
      {
        session: signers.session,
        ...(signers.enableData ? { enableData: signers.enableData } : {}),
      },
    ]),
  )
}

function adaptSourceAssets(
  sourceAssets: SourceAssetInput | undefined,
  chainIds: readonly number[] | undefined,
): OrchestratorAccountAccessList | undefined {
  if (!sourceAssets) return chainIds ? { chainIds } : undefined
  if (Array.isArray(sourceAssets)) {
    if (sourceAssets.length > 0 && typeof sourceAssets[0] === 'object') {
      const chainTokens: Record<number, Address[]> = {}
      const chainTokenAmounts: Record<number, Record<Address, bigint>> = {}
      for (const item of sourceAssets as {
        chain: { id: number }
        address: Address | string
        amount?: bigint
      }[]) {
        const token = normalizeTokenAddress(
          sharedChainCatalog,
          item.address,
          item.chain.id,
          false,
        ) as Address
        if (item.amount === undefined)
          (chainTokens[item.chain.id] ??= []).push(token)
        else (chainTokenAmounts[item.chain.id] ??= {})[token] = item.amount
      }
      return {
        ...(Object.keys(chainTokens).length > 0 ? { chainTokens } : {}),
        ...(Object.keys(chainTokenAmounts).length > 0
          ? { chainTokenAmounts }
          : {}),
      }
    }
    return {
      ...(chainIds ? { chainIds } : {}),
      tokens: sourceAssets as string[],
    }
  }
  return { chainTokens: sourceAssets }
}
