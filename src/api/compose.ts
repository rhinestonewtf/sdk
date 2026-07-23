import { type Address, type Hex, isAddressEqual } from 'viem'
import type { AccountRuntime, AccountRuntimePort } from '../accounts/adapter'
import { createAccountConstruction } from '../accounts/construction'
import { FactoryArgsNotAvailableError } from '../accounts/error'
import { createAccountAdapter } from '../accounts/registry'
import { toEvmChainReference } from '../chains/caip2'
import { getChainById } from '../chains/catalog'
import { createBundlerClient } from '../clients/bundler/client'
import { createConfiguredOrchestratorClient } from '../clients/orchestrator/client'
import { createPaymasterClient } from '../clients/paymaster/client'
import { createRpcPort } from '../clients/rpc/client'
import {
  accountMaterial,
  createStaticAccountRuntime,
} from '../config/account-runtime'
import type {
  AccountInvocationContext,
  ResolvedAccountConfig,
  ResolvedSdkConfig,
} from '../config/resolved'
import { getIntentExecutorModule } from '../modules/intent-executor'
import {
  readInstalledModules,
  readModuleInstallations,
  readOwners,
} from '../modules/read-core'
import { defineValidator } from '../modules/validators/definition'
import { K1_DEFAULT_VALIDATOR_ADDRESS } from '../modules/validators/k1'
import { ecdsaSignerId } from '../modules/validators/signer-id'
import {
  getSessionDetails as buildSessionDetails,
  SESSION_LOCK_TAG,
} from '../modules/validators/smart-sessions/authorization'
import { getSmartSessionEmissaryAddress } from '../modules/validators/smart-sessions/module'
import {
  readSessionEnabled,
  readSessionNonce,
} from '../modules/validators/smart-sessions/state'
import type {
  ResolvedSessionSignerSet,
  Session,
  SessionDetails,
} from '../modules/validators/smart-sessions/types'
import type { ResolvedValidatorDefinition } from '../modules/validators/types'
import {
  createAccountSigningContext,
  getAccountSignatureRoute,
  getSigningValidatorCodec,
  getSigningValidatorFactors,
} from '../signing/context'
import {
  createNexusEip7702InitTypedData,
  signAuthorizationList,
  signNexusEip7702Init,
} from '../signing/eip7702'
import { createValidatorSigningTasks, signingTopology } from '../signing/plan'
import {
  resolveSessionEnableChain,
  signSessionEnablement,
} from '../signing/session-enable'
import { createSignerInvocationPort } from '../signing/signers/registry'
import type { ExternalSignerRegistry } from '../signing/signers/types'
import { resolveAccountTypedDataSigning } from '../signing/typed-data'
import type {
  OwnerSignerSelection,
  SignerInvocationPort,
  SigningCheckpointPort,
} from '../signing/types'
import {
  buildIntentSigningInput,
  prepareIntent,
} from '../transactions/intents/prepare'
import { sendIntent } from '../transactions/intents/send'
import { prepareIntentSessions } from '../transactions/intents/sessions'
import {
  assembleIntent,
  signIntent,
  signIntentAsOwner,
} from '../transactions/intents/sign-transaction'
import { splitIntents } from '../transactions/intents/split'
import {
  getIntentStatus,
  waitForIntentStatus,
} from '../transactions/intents/status'
import { submitIntent } from '../transactions/intents/submit'
import type {
  IntentInput,
  IntentSessionSelection,
  IntentWorkflowContext,
  PreparedIntent,
} from '../transactions/intents/types'
import { prepareUserOperation } from '../transactions/user-operations/prepare'
import {
  reconstructPreparedUserOperation,
  reconstructSignedUserOperation,
} from '../transactions/user-operations/reconstruct'
import { sendUserOperation } from '../transactions/user-operations/send'
import { signUserOperation } from '../transactions/user-operations/sign'
import {
  getUserOperationStatus,
  waitForUserOperationStatus,
} from '../transactions/user-operations/status'
import { submitUserOperation } from '../transactions/user-operations/submit'
import type { UserOperationWorkflowContext } from '../transactions/user-operations/types'
import type {
  AccountComposition,
  AccountDependencyResolver,
  AccountWorkflows,
  CoreComposition,
  CoreDependencies,
  IntentMessages,
  ProjectWorkflows,
} from './compose-types'
import { signRuntimeMessage, signRuntimeTypedData } from './direct-signing'
import { getAppFeeBalances } from './queries/app-fees'
import { getPortfolio } from './queries/portfolio'

export type {
  AccountComposition,
  AccountWorkflows,
  ClockPort,
  CoreComposition,
  CoreCompositionFactory,
  CoreDependencies,
  ProjectWorkflows,
} from './compose-types'

const sessionEnabledAbi = [
  {
    type: 'function',
    name: 'isPermissionEnabled',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'permissionId', type: 'bytes32' },
    ],
    outputs: [{ name: 'enabled', type: 'bool' }],
  },
] as const

export function createCoreComposition<CompatibilityConfig = unknown>(
  config: ResolvedSdkConfig,
  dependencies: CoreDependencies,
  resolveAccountDependencies: AccountDependencyResolver<CompatibilityConfig> = () =>
    dependencies,
): CoreComposition<CompatibilityConfig> {
  const project: ProjectWorkflows = {
    getIntentStatus: (intentId) =>
      getIntentStatus({ statusClient: dependencies.orchestrator }, intentId),
    splitIntents: (input) => splitIntents(dependencies.orchestrator, input),
    getAppFeeBalances: () => getAppFeeBalances(dependencies.orchestrator),
  }
  return {
    config,
    project,
    createAccount: (context) =>
      createAccountComposition(context, resolveAccountDependencies(context)),
  }
}

export function createConfiguredCoreComposition<CompatibilityConfig = unknown>(
  config: ResolvedSdkConfig,
): CoreComposition<CompatibilityConfig> {
  return createCoreComposition<CompatibilityConfig>(
    config,
    createConfiguredDependencies(config),
    (context) => createConfiguredDependencies(context.sdk),
  )
}

function createConfiguredDependencies(
  config: ResolvedSdkConfig,
): CoreDependencies {
  const rpc = createRpcPort(config.provider)
  return {
    orchestrator: createConfiguredOrchestratorClient(config),
    rpc,
    bundler: createBundlerClient({
      endpoint: config.bundler,
      provider: config.provider,
    }),
    ...(config.paymaster
      ? { paymaster: createPaymasterClient({ endpoint: config.paymaster }) }
      : {}),
    clock: {
      now: Date.now,
      sleep: (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)),
      timeout: (promise, milliseconds, error) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(error()), milliseconds)
          promise.then(
            (value) => {
              clearTimeout(timer)
              resolve(value)
            },
            (reason) => {
              clearTimeout(timer)
              reject(reason)
            },
          )
        }),
    },
  }
}

function createAccountComposition<CompatibilityConfig>(
  initialContext: AccountInvocationContext<CompatibilityConfig>,
  dependencies: CoreDependencies,
): AccountComposition<CompatibilityConfig> {
  const workflows: AccountWorkflows<CompatibilityConfig> = {
    getAddress: (context, chain) =>
      createStaticAccountRuntime(context.account, chain, false).identity
        .address,
    signMessage: async (context, input) => {
      const account = createAccountRuntimePort(context.account, dependencies)
      const session =
        input.signers?.kind === 'smart-session'
          ? directSession(input.signers, input.chain)
          : undefined
      return signRuntimeMessage({
        ...input,
        runtime: await account.forChain(input.chain),
        signerInvoker: signerInvoker(
          context.account,
          dependencies,
          session
            ? defineValidator(session.session.owners, 'smart-session-validator')
            : input.signers?.kind === 'owner'
              ? input.signers.validator
              : undefined,
        ),
        checkpoints: checkpointPort(context.account, dependencies),
        ...(input.signers?.kind === 'owner'
          ? { selection: input.signers }
          : {}),
        ...(session ? { session } : {}),
      })
    },
    signTypedData: async (context, input) => {
      const account = createAccountRuntimePort(context.account, dependencies)
      const session =
        input.signers?.kind === 'smart-session'
          ? directSession(input.signers, input.chain)
          : undefined
      return signRuntimeTypedData({
        ...input,
        runtime: await account.forChain(input.chain),
        signerInvoker: signerInvoker(
          context.account,
          dependencies,
          session
            ? defineValidator(session.session.owners, 'smart-session-validator')
            : input.signers?.kind === 'owner'
              ? input.signers.validator
              : undefined,
        ),
        checkpoints: checkpointPort(context.account, dependencies),
        ...(input.signers?.kind === 'owner'
          ? { selection: input.signers }
          : {}),
        ...(session ? { session } : {}),
      })
    },
    signEip7702InitData: (context) =>
      signEip7702InitData(context.account, dependencies),
    signAuthorizations: (context, input) =>
      signEip7702Authorizations(context.account, input, dependencies),
    prepareIntent: (context, input) =>
      prepareIntent(intentContext(context, dependencies), input),
    signIntent: async (context, input) => {
      const ownerSelection =
        input.input.signers?.kind === 'owner' ? input.input.signers : undefined
      const intent = await signIntent(
        intentContext(context, dependencies, ownerSelection?.validator),
        input,
      )
      return { intent, transcript: intent.transcript }
    },
    signIntentAsOwner: (context, input, selection) => {
      const ownerSelection =
        input.input.signers?.kind === 'owner' ? input.input.signers : undefined
      return signIntentAsOwner(
        intentContext(context, dependencies, ownerSelection?.validator),
        input,
        selection,
      )
    },
    assembleIntent: (context, input, signatures) =>
      assembleIntent(intentContext(context, dependencies), input, signatures),
    submitIntent: (context, input) =>
      submitIntent(intentContext(context, dependencies), input),
    sendIntent: (context, input) =>
      sendIntent(intentContext(context, dependencies), input),
    waitForIntentStatus: (context, intentId) =>
      waitForIntentStatus(intentContext(context, dependencies), intentId),
    prepareUserOperation: (context, input) =>
      prepareUserOperation(
        userOperationContext(context, dependencies, input.signers),
        input,
      ),
    signUserOperation: (context, input) =>
      signUserOperation(
        userOperationContext(context, dependencies, input.input.signers),
        input,
      ),
    submitUserOperation: (context, input) =>
      submitUserOperation(userOperationContext(context, dependencies), input),
    sendUserOperation: (context, input) =>
      sendUserOperation(
        userOperationContext(context, dependencies, input.signers),
        input,
      ),
    getUserOperationStatus: (context, input) =>
      getUserOperationStatus(
        userOperationContext(context, dependencies),
        input,
      ),
    waitForUserOperationStatus: (context, input) =>
      waitForUserOperationStatus(
        userOperationContext(context, dependencies),
        input,
      ),
    reconstructPreparedUserOperation: (context, input) =>
      reconstructPreparedUserOperation(
        userOperationContext(context, dependencies, input.signers),
        input,
      ),
    reconstructSignedUserOperation: (context, input) =>
      reconstructSignedUserOperation(
        userOperationContext(context, dependencies, input.signers),
        input,
      ),
    getPortfolio: (context, onTestnets = false) =>
      getPortfolio({
        account: createAccountRuntimePort(context.account, dependencies),
        client: dependencies.orchestrator,
        onTestnets,
      }),
    getInitData: (context) => accountInitData(context.account),
    isDeployed: (context, chain) =>
      isAccountDeployed(context.account, chain, dependencies),
    deploy: (context, chain, options) =>
      deployAccount(context, chain, options, dependencies),
    setup: (context, chain) => setupAccount(context, chain, dependencies),
    getTransactionMessages: (prepared) => intentMessages(prepared),
    reconstructPreparedIntent: (context, input) =>
      reconstructPreparedIntent(context, input, dependencies),
    signIntentFromSignData: (context, input) =>
      signIntentFromSignData(context, input, dependencies),
    getOwners: (context, chain) =>
      readOwners({
        rpc: dependencies.rpc.forChain(chain),
        chain,
        accountKind: context.account.account.kind,
        account: createStaticAccountRuntime(context.account, chain, false)
          .identity.address,
        ...(hcaFactory(context.account)
          ? { hcaFactory: hcaFactory(context.account) as Address }
          : {}),
      }),
    getValidators: (context, chain) =>
      readInstalledModules({
        rpc: dependencies.rpc.forChain(chain),
        chain,
        accountKind: context.account.account.kind,
        account: createStaticAccountRuntime(context.account, chain, false)
          .identity.address,
        kind: 'validator',
      }),
    getExecutors: (context, chain) =>
      readInstalledModules({
        rpc: dependencies.rpc.forChain(chain),
        chain,
        accountKind: context.account.account.kind,
        account: createStaticAccountRuntime(context.account, chain, false)
          .identity.address,
        kind: 'executor',
      }),
    getSessionDetails: (context, sessions) =>
      accountSessionDetails(context.account, sessions, dependencies),
    isSessionEnabled: (context, session) =>
      accountSessionEnabled(context.account, session, dependencies),
    signEnableSession: (context, details) =>
      signAccountEnableSession(context, details, dependencies),
  }
  return { context: initialContext, workflows }
}

async function signEip7702InitData(
  account: ResolvedAccountConfig,
  dependencies: CoreDependencies,
) {
  const chain = referenceChain()
  const runtime = createStaticAccountRuntime(account, chain, false)
  const adoption = runtime.adapter.getEip7702AdoptionPlan?.(
    runtime.construction,
  )
  if (!adoption || !account.eoa) {
    throw new Error('EIP-7702 initialization is unavailable for this account')
  }
  return signNexusEip7702Init({
    planInput: {
      typedData: createNexusEip7702InitTypedData(adoption),
      signer: {
        id: ecdsaSignerId(account.eoa),
        kind: 'ecdsa',
      },
    },
    signerInvoker: signerInvoker(account, dependencies),
    checkpoints: { read: async () => [] },
  })
}

async function signEip7702Authorizations(
  account: ResolvedAccountConfig,
  input: {
    readonly chains: readonly import('../chains/types').ChainReference[]
    readonly eip7702InitSignature?: import('viem').Hex
  },
  dependencies: CoreDependencies,
) {
  if (!input.eip7702InitSignature) return { authorizations: [] }
  const chains = input.chains.flatMap((chain) =>
    chain.kind === 'evm' ? [chain] : [],
  )
  const firstChain = chains[0]
  if (!firstChain || !account.eoa) {
    throw new Error('EIP-7702 authorization requires an EVM chain and EOA')
  }
  const runtime = createStaticAccountRuntime(account, firstChain, false)
  const adoption = runtime.adapter.getEip7702AdoptionPlan?.(
    runtime.construction,
  )
  if (!adoption) {
    throw new Error('EIP-7702 authorization is unavailable for this account')
  }
  const facts = new Map<number, import('../signing/types').SigningRuntimeFact>()
  const nonceByChain: Record<number, number> = {}
  for (const chain of chains) {
    if (facts.has(chain.id)) continue
    const rpc = dependencies.rpc.forChain(chain)
    const { code } = await rpc.getCode({ chain }, account.eoa.address)
    facts.set(chain.id, {
      kind: 'delegation-code',
      id: `delegation-${chain.id}`,
      ...(code ? { code } : {}),
    })
    const delegated =
      code?.toLowerCase() ===
      `0xef0100${adoption.contract.slice(2)}`.toLowerCase()
    nonceByChain[chain.id] = delegated
      ? 0
      : Number(await rpc.getTransactionCount({ chain }, account.eoa.address))
  }
  const result = await signAuthorizationList({
    planInput: {
      account: account.eoa.address,
      contract: adoption.contract,
      chains,
      signer: {
        id: ecdsaSignerId(account.eoa),
        kind: 'ecdsa',
      },
      nonceByChain,
    },
    signerInvoker: signerInvoker(account, dependencies),
    checkpoints: {
      read: async (checkpoint) => {
        if (checkpoint.kind !== 'delegation-code') return []
        const fact = facts.get(checkpoint.chain.id)
        if (!fact) throw new Error(`Missing delegation fact ${checkpoint.id}`)
        return [fact]
      },
    },
  })
  return result
}

function referenceChain(): import('../chains/types').EvmChainReference {
  // Account addresses are CREATE2 and chain-independent, so initialization only
  // needs some EVM chain reference. With no bundled chain set, use mainnet.
  return toEvmChainReference(1)
}

function accountInitData(account: ResolvedAccountConfig): {
  readonly factory: Address
  readonly factoryData: Hex
} {
  const runtime = createStaticAccountRuntime(account, referenceChain(), false)
  const plan = runtime.adapter.getDeploymentPlan(runtime.construction)
  if (!plan.factory || !plan.factoryData) {
    throw new FactoryArgsNotAvailableError()
  }
  return { factory: plan.factory, factoryData: plan.factoryData }
}

function hcaFactory(account: ResolvedAccountConfig): Address | undefined {
  if (account.account.kind !== 'hca') return undefined
  if (account.account.factory.source === 'explicit') {
    return account.account.factory.value
  }
  return account.initData && 'factory' in account.initData
    ? account.initData.factory
    : undefined
}

async function isAccountDeployed(
  account: ResolvedAccountConfig,
  chain: import('../chains/types').EvmChainReference,
  dependencies: CoreDependencies,
): Promise<boolean> {
  if (account.account.kind === 'eoa') return true
  const runtime = createStaticAccountRuntime(account, chain, false)
  const { code } = await dependencies.rpc
    .forChain(chain)
    .getCode({ chain }, runtime.identity.address)
  return code !== undefined && code !== '0x'
}

function intentMessages<CompatibilityConfig>(
  prepared: PreparedIntent<CompatibilityConfig>,
): IntentMessages {
  const { signData } = prepared.quote
  return {
    origin: [...signData.origin],
    destination: signData.destination,
    ...(signData.targetExecution
      ? { targetExecution: signData.targetExecution }
      : {}),
  }
}

const zeroAddress = '0x0000000000000000000000000000000000000000' as Address

async function deployAccount<CompatibilityConfig>(
  context: AccountInvocationContext<CompatibilityConfig>,
  chain: import('../chains/types').EvmChainReference,
  options:
    | { readonly sponsored?: boolean; readonly eip7702InitSignature?: Hex }
    | undefined,
  dependencies: CoreDependencies,
): Promise<boolean> {
  const account = context.account
  if (account.account.kind === 'eoa') return false
  if (await isAccountDeployed(account, chain, dependencies)) return false
  const runtime = createStaticAccountRuntime(account, chain, false)
  const adoption = account.eoa
    ? runtime.adapter.getEip7702AdoptionPlan?.(runtime.construction)
    : undefined
  const intentExecutorInstalled =
    account.initData && 'intentExecutorInstalled' in account.initData
      ? account.initData.intentExecutorInstalled
      : false
  const asUserOp = Boolean(account.initData) && !intentExecutorInstalled
  const useUserOperation =
    !adoption && (asUserOp || context.sdk.bundler?.kind === 'custom')
  let initSignature = options?.eip7702InitSignature
  if (adoption && !initSignature) {
    initSignature = (await signEip7702InitData(account, dependencies)).signature
  }
  if (useUserOperation) {
    const plan = runtime.adapter.getDeploymentPlan(runtime.construction)
    if (!plan.factory || !plan.factoryData) {
      throw new FactoryArgsNotAvailableError()
    }
    const workflowContext = userOperationContext(context, dependencies)
    const submitted = await sendUserOperation(workflowContext, {
      chain,
      calls: [{ target: zeroAddress, value: 0n, data: '0x' }],
    })
    await waitForUserOperationStatus(workflowContext, submitted)
  } else {
    const workflowContext = intentContext(context, dependencies)
    const submitted = await sendIntent(workflowContext, {
      destination: chain,
      sourceChains: [chain],
      calls: [],
      tokenRequests: [],
      ...(initSignature ? { eip7702InitSignature: initSignature } : {}),
      options: options?.sponsored
        ? { sponsorSettings: { gas: true, bridgeFees: true, swapFees: true } }
        : {},
    })
    await waitForIntentStatus(workflowContext, submitted.intentId)
  }
  return true
}

async function setupAccount<CompatibilityConfig>(
  context: AccountInvocationContext<CompatibilityConfig>,
  chain: import('../chains/types').EvmChainReference,
  dependencies: CoreDependencies,
): Promise<boolean> {
  const account = context.account
  if (account.account.kind === 'eoa' || account.account.kind === 'hca') {
    return false
  }
  const runtime = createStaticAccountRuntime(account, chain, true)
  const plan = runtime.construction.setup
  const candidates = [
    ...plan.validators,
    ...plan.executors,
    ...plan.fallbacks,
    ...plan.hooks,
  ].filter(
    (module) =>
      !(
        account.account.kind === 'startale' &&
        isAddressEqual(module.address, K1_DEFAULT_VALIDATOR_ADDRESS)
      ),
  )
  const installationState = await readModuleInstallations({
    rpc: dependencies.rpc.forChain(chain),
    chain,
    account: runtime.identity.address,
    modules: candidates,
  })
  const missing = candidates.filter(
    (_module, index) => !installationState[index],
  )
  if (missing.length === 0) return false
  const calls = missing.flatMap((module) =>
    runtime.adapter.encodeModuleInstallation(module).map((data) => ({
      target: runtime.identity.address,
      value: 0n,
      data,
    })),
  )
  const intentExecutor = getIntentExecutorModule(account.sessions.environment)
  const usesIntent = missing.every(
    (module) => !isAddressEqual(module.address, intentExecutor.address),
  )
  if (usesIntent) {
    const submitted = await sendIntent(intentContext(context, dependencies), {
      destination: chain,
      sourceChains: [chain],
      calls,
      tokenRequests: [],
      options: {},
    })
    await waitForIntentStatus(
      intentContext(context, dependencies),
      submitted.intentId,
    )
  } else {
    const submitted = await sendUserOperation(
      userOperationContext(context, dependencies),
      { chain, calls },
    )
    await waitForUserOperationStatus(
      userOperationContext(context, dependencies),
      submitted,
    )
  }
  return true
}

function accountSessionDetails(
  account: ResolvedAccountConfig,
  sessions: readonly Session[],
  dependencies: CoreDependencies,
): Promise<SessionDetails> {
  const address = createStaticAccountRuntime(account, referenceChain(), false)
    .identity.address
  const environment = account.sessions.environment
  return buildSessionDetails({
    account: address,
    sessions,
    environment,
    readNonce: (session) => {
      const chain = toEvmChainReference(session.chain.id)
      return readSessionNonce({
        rpc: dependencies.rpc.forChain(chain),
        chain,
        account: address,
        lockTag: SESSION_LOCK_TAG,
        environment,
      })
    },
  })
}

function accountSessionEnabled(
  account: ResolvedAccountConfig,
  session: Session,
  dependencies: CoreDependencies,
): Promise<boolean> {
  const chain = toEvmChainReference(session.chain.id)
  const address = createStaticAccountRuntime(account, chain, false).identity
    .address
  return readSessionEnabled({
    rpc: dependencies.rpc.forChain(chain),
    chain,
    account: address,
    session,
    environment: account.sessions.environment,
  })
}

async function signAccountEnableSession<CompatibilityConfig>(
  context: AccountInvocationContext<CompatibilityConfig>,
  details: SessionDetails,
  dependencies: CoreDependencies,
): Promise<Hex> {
  const defaultChain = referenceChain()
  const defaultRuntime = createStaticAccountRuntime(
    context.account,
    defaultChain,
    false,
  )
  const defaultSigning = createAccountSigningContext({
    runtime: defaultRuntime,
    purpose: 'session-enable',
    signerInvoker: signerInvoker(context.account, dependencies),
  })
  const chain = resolveSessionEnableChain({
    accountKind: context.account.account.kind,
    validator:
      defaultSigning.validatorCapabilities.compatibilityKey.moduleAddress,
    hashesAndChainIds: details.hashesAndChainIds,
    defaultChain,
  })
  const runtime =
    chain.id === defaultChain.id
      ? defaultRuntime
      : createStaticAccountRuntime(context.account, chain, false)
  const signing = createAccountSigningContext({
    runtime,
    purpose: 'session-enable',
    signerInvoker: signerInvoker(context.account, dependencies),
  })
  const topology = signingTopology(signing.validator)
  const route = resolveAccountTypedDataSigning({
    typedData: details.data,
    chain,
    context: signing,
  })
  const accountRoute = getAccountSignatureRoute(
    runtime,
    signing,
    route.erc7739,
    route.payloadKind,
  )
  const result = await signSessionEnablement({
    context: signing,
    checkpoints: checkpointPort(context.account, dependencies),
    planInput: {
      typedData: details.data,
      signingMaterial: route.material,
      chain,
      ...topology,
      tasks: createValidatorSigningTasks({
        validator: signing.validator,
        signerReferences: signing.signerReferences,
        taskPrefix: 'typed-data',
        ecdsaInvocation: route.ecdsaInvocation,
        webauthnInvocation: route.webauthnInvocation,
      }),
      validatorCodec: getSigningValidatorCodec(signing, route.payloadKind),
      ...(signing.validator.kind === 'multi-factor'
        ? {
            validatorFactors: getSigningValidatorFactors(
              signing,
              route.payloadKind,
            ),
          }
        : {}),
      route: {
        erc7739: accountRoute.erc7739,
        accountEnvelope: accountRoute.accountEnvelope,
        erc6492: { kind: 'none' },
      },
    },
  })
  return result.signature
}

async function reconstructPreparedIntent<CompatibilityConfig>(
  context: AccountInvocationContext<CompatibilityConfig>,
  input: {
    readonly traceId: string
    readonly quote: PreparedIntent<CompatibilityConfig>['quote']
    readonly quotes: PreparedIntent<CompatibilityConfig>['quotes']
    readonly request: PreparedIntent<CompatibilityConfig>['request']
    readonly intentInput: IntentInput<CompatibilityConfig>
  },
  dependencies: CoreDependencies,
): Promise<PreparedIntent<CompatibilityConfig>> {
  const originChainId = Number(
    input.quote.signData.origin.at(-1)?.domain?.chainId,
  )
  const accountChain = toEvmChainReference(originChainId)
  const runtime = await createAccountRuntimePort(
    context.account,
    dependencies,
  ).forChain(accountChain)
  let resolvedSessions: PreparedIntent<CompatibilityConfig>['resolvedSessions']
  if (input.intentInput.signers?.kind === 'smart-session') {
    const prepared = await prepareIntentSessions<CompatibilityConfig>({
      intent: input.intentInput,
      runtime,
      context: { checkpoints: checkpointPort(context.account, dependencies) },
    })
    resolvedSessions = prepared?.byChain
  }
  const destination =
    input.intentInput.destination.kind === 'evm'
      ? input.intentInput.destination
      : undefined
  const signing = buildIntentSigningInput(
    runtime,
    input.quote,
    resolvedSessions,
    destination,
    input.intentInput.signers?.kind === 'owner'
      ? input.intentInput.signers.validator
      : undefined,
    input.intentInput.signers?.kind === 'owner'
      ? input.intentInput.signers.signerIds
      : undefined,
  )
  return {
    traceId: input.traceId,
    input: input.intentInput,
    request: input.request,
    quote: input.quote,
    quotes: input.quotes,
    signing,
    accountChain,
    ...(resolvedSessions
      ? {
          resolvedSessions,
          sessionEnvironment: runtime.construction.sessions.environment,
        }
      : {}),
  }
}

async function signIntentFromSignData<CompatibilityConfig>(
  context: AccountInvocationContext<CompatibilityConfig>,
  input: {
    readonly signData: IntentMessages
    readonly targetChain: import('../chains/types').ChainReference
    readonly signers?: IntentInput<CompatibilityConfig>['signers']
  },
  dependencies: CoreDependencies,
) {
  const originChainId = Number(input.signData.origin.at(-1)?.domain?.chainId)
  const accountChain = toEvmChainReference(originChainId)
  const runtime = await createAccountRuntimePort(
    context.account,
    dependencies,
  ).forChain(accountChain)
  let resolvedSessions: PreparedIntent<CompatibilityConfig>['resolvedSessions']
  if (input.signers?.kind === 'smart-session') {
    const preparedSessions = await prepareIntentSessions<CompatibilityConfig>({
      intent: {
        destination: input.targetChain,
        calls: [],
        tokenRequests: [],
        signers: input.signers,
      },
      runtime,
      context: { checkpoints: checkpointPort(context.account, dependencies) },
    })
    resolvedSessions = preparedSessions?.byChain
  }
  const destination =
    input.targetChain.kind === 'evm' ? input.targetChain : undefined
  const quote = {
    signData: {
      origin: [...input.signData.origin],
      destination: input.signData.destination,
      ...(input.signData.targetExecution
        ? { targetExecution: input.signData.targetExecution }
        : {}),
    },
  } as unknown as PreparedIntent<CompatibilityConfig>['quote']
  const signing = buildIntentSigningInput(
    runtime,
    quote,
    resolvedSessions,
    destination,
    input.signers?.kind === 'owner' ? input.signers.validator : undefined,
    input.signers?.kind === 'owner' ? input.signers.signerIds : undefined,
  )
  const prepared: PreparedIntent<CompatibilityConfig> = {
    traceId: '',
    input: {
      destination: input.targetChain,
      calls: [],
      tokenRequests: [],
      ...(input.signers ? { signers: input.signers } : {}),
    },
    request: {} as PreparedIntent<CompatibilityConfig>['request'],
    quote,
    quotes: [quote],
    signing,
    accountChain,
    ...(resolvedSessions
      ? {
          resolvedSessions,
          sessionEnvironment: runtime.construction.sessions.environment,
        }
      : {}),
  }
  const signed = await signIntent(
    intentContext(
      context,
      dependencies,
      input.signers?.kind === 'owner' ? input.signers.validator : undefined,
    ),
    prepared,
  )
  return {
    originSignatures: signed.originSignatures,
    destinationSignature: signed.destinationSignature,
    targetExecutionSignature: signed.targetSignature,
    transcript: signed.transcript,
  }
}

function intentContext<CompatibilityConfig>(
  context: AccountInvocationContext<CompatibilityConfig>,
  dependencies: CoreDependencies,
  validator?: ResolvedValidatorDefinition,
): IntentWorkflowContext<CompatibilityConfig> {
  return {
    compatibilityConfig: context.compatibilityConfig,
    account: createAccountRuntimePort(context.account, dependencies),
    quoteClient: dependencies.orchestrator,
    submissionClient: dependencies.orchestrator,
    statusClient: dependencies.orchestrator,
    signerInvoker: signerInvoker(context.account, dependencies, validator),
    checkpoints: checkpointPort(context.account, dependencies),
    signAuthorizations: async (input) =>
      (await signEip7702Authorizations(context.account, input, dependencies))
        .authorizations,
    clock: dependencies.clock,
  }
}

function userOperationContext<CompatibilityConfig>(
  context: AccountInvocationContext<CompatibilityConfig>,
  dependencies: CoreDependencies,
  selection?: OwnerSignerSelection,
): UserOperationWorkflowContext<CompatibilityConfig> {
  if (!dependencies.bundler) {
    throw new Error('A bundler client is required for UserOperations')
  }
  return {
    compatibilityConfig: context.compatibilityConfig,
    account: createAccountRuntimePort(context.account, dependencies),
    rpc: dependencies.rpc,
    bundler: dependencies.bundler,
    ...(dependencies.paymaster ? { paymaster: dependencies.paymaster } : {}),
    signerInvoker: signerInvoker(
      context.account,
      dependencies,
      selection?.validator,
    ),
    checkpoints: checkpointPort(context.account, dependencies),
    clock: dependencies.clock,
  }
}

function createAccountRuntimePort(
  account: ResolvedAccountConfig,
  dependencies: Pick<CoreDependencies, 'rpc'>,
): AccountRuntimePort {
  const cache = new Map<number, Promise<AccountRuntime>>()
  return {
    forChain: (chain) => {
      const existing = cache.get(chain.id)
      if (existing) return existing
      const pending = materializeAccountRuntime(account, dependencies, chain)
      cache.set(chain.id, pending)
      return pending
    },
  }
}

async function materializeAccountRuntime(
  resolved: ResolvedAccountConfig,
  dependencies: Pick<CoreDependencies, 'rpc'>,
  chain: import('../chains/types').EvmChainReference,
): Promise<AccountRuntime> {
  const material = accountMaterial(resolved)
  const pendingConstruction = createAccountConstruction({
    material,
    chain,
    deployed: false,
  })
  const pendingAdapter = createAccountAdapter(pendingConstruction)
  const identity = pendingAdapter.getIdentity(pendingConstruction)
  const { code } = await dependencies.rpc
    .forChain(chain)
    .getCode({ chain }, identity.address)
  const deployed = code !== undefined && code !== '0x'
  if (!deployed) {
    return {
      adapter: pendingAdapter,
      construction: pendingConstruction,
      identity,
    }
  }
  const construction = createAccountConstruction({
    material,
    chain,
    deployed: true,
  })
  const adapter = createAccountAdapter(construction)
  return {
    adapter,
    construction,
    identity: adapter.getIdentity(construction),
  }
}

function signerInvoker(
  account: ResolvedAccountConfig,
  dependencies: CoreDependencies,
  validator?: ResolvedValidatorDefinition,
): SignerInvocationPort {
  return (
    dependencies.signerInvoker ??
    createSignerInvocationPort({
      signers: signerRegistry(account, validator),
      resolveChain: (chain) => getChainById(chain.id),
    })
  )
}

function signerRegistry(
  account: ResolvedAccountConfig,
  validator?: ResolvedValidatorDefinition,
): ExternalSignerRegistry {
  const signers: Record<string, ExternalSignerRegistry[string]> = {}
  for (const owner of [
    ...validatorOwners(account.owners),
    ...validatorOwners(validator),
  ]) {
    signers[owner.signerId] =
      owner.kind === 'webauthn'
        ? { kind: 'webauthn', account: owner.account }
        : { kind: 'ecdsa', account: owner.account }
  }
  if (account.eoa) {
    signers[ecdsaSignerId(account.eoa)] = {
      kind: 'ecdsa',
      account: account.eoa,
    }
  }
  return signers
}

function validatorOwners(validator: ResolvedValidatorDefinition | undefined) {
  if (!validator) return []
  return validator.kind === 'multi-factor'
    ? validator.validators.flatMap(({ owners }) => owners)
    : validator.owners
}

function directSession(
  selection: IntentSessionSelection,
  chain: import('../chains/types').EvmChainReference,
): ResolvedSessionSignerSet {
  const selected = selection.byChain[chain.id]
  if (!selected) throw new Error(`No session configured for chain ${chain.id}`)
  return {
    kind: 'smart-session',
    session: selected.session,
    ...(selected.enableData ? { enableData: selected.enableData } : {}),
    verifyExecutions: false,
  }
}

function checkpointPort(
  account: ResolvedAccountConfig,
  dependencies: CoreDependencies,
): SigningCheckpointPort {
  return {
    read: async (checkpoint) => {
      const rpc = dependencies.rpc.forChain(checkpoint.chain)
      switch (checkpoint.kind) {
        case 'account-deployment': {
          const { code } = await rpc.getCode(
            { chain: checkpoint.chain },
            checkpoint.account,
          )
          return [
            {
              kind: 'account-deployed',
              id: checkpoint.id,
              deployed: code !== undefined && code !== '0x',
            },
          ]
        }
        case 'delegation-code': {
          const { code } = await rpc.getCode(
            { chain: checkpoint.chain },
            checkpoint.account,
          )
          return [
            {
              kind: 'delegation-code',
              id: checkpoint.id,
              ...(code ? { code } : {}),
            },
          ]
        }
        case 'session-enabled': {
          const enabled = await rpc.readContract<boolean>(
            { chain: checkpoint.chain },
            {
              address: getSmartSessionEmissaryAddress(
                account.sessions.environment,
              ),
              abi: sessionEnabledAbi,
              functionName: 'isPermissionEnabled',
              args: [checkpoint.account, checkpoint.permissionId],
            },
          )
          return [{ kind: 'session-enabled', id: checkpoint.id, enabled }]
        }
      }
    },
  }
}
