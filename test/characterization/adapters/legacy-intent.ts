import {
  type Address,
  type Chain,
  createPublicClient,
  erc20Abi,
  type Hex,
  hashTypedData,
  http,
  type SignedAuthorizationList,
  type TypedDataDefinition,
} from 'viem'
import { experimental_disableSession } from '../../../src/actions/smart-sessions'
import type {
  OwnerSignature,
  PreparedTransactionData,
  SignedIntentData,
  SignedTransactionData,
  Transaction,
  TransactionResult,
} from '../../../src/index'
import {
  ensureFunded,
  waitForOrchestratorNative,
  waitForOrchestratorUsdc,
} from '../../integration/framework/funding'
import {
  characterizationScenarios,
  isExecutableCharacterizationScenario,
  type ScenarioHandlerKey,
} from '../catalog'
import { getComparisonGroupNamespace, getIdentityNamespace } from '../identity'
import {
  type CharacterizationObservation,
  createModeObservation,
  type ErrorPhase,
  failedOutcome,
  type SigningObservation,
  successfulOutcome,
} from '../observe'
import type {
  CharacterizationSubject,
  IntentScenario,
  TerminalAssertion,
} from '../types'
import {
  buildLegacyIntentCasePlan,
  buildLegacyIntentFixture,
  createIntentSdkInput,
  createSessionCall,
  createSubjectSdk,
  getLegacyUsdcAddress,
  LEGACY_INTENT_CASE_HANDLERS,
  LEGACY_INTENT_FIXTURE_HANDLERS,
  LEGACY_INTENT_SOURCE_CHAIN,
  LEGACY_INTENT_TARGET_CHAIN,
  type LegacyIntentCasePlan,
  type LegacyIntentFixture,
  observeLegacyAccount,
} from './legacy-intent-fixtures'

type RunLegacyIntentScenarioInput = {
  readonly scenario: IntentScenario
  readonly subject?: Extract<
    CharacterizationSubject,
    'legacy' | 'public' | 'rewrite'
  >
  readonly baseSha: string
  readonly runId: string
  readonly identityNamespace?: string
  readonly preparedReplay?: PreparedTransactionData
  readonly onPrepared?: (prepared: PreparedTransactionData) => void
}

type SuccessfulStage = {
  readonly phase: 'success'
  readonly prepared: PreparedTransactionData
  readonly signed: SignedTransactionData | SignedIntentData
  readonly authorizations?: SignedAuthorizationList
  readonly submission?: TransactionResult
  readonly terminal?: unknown
}

type FailedStage = {
  readonly phase: ErrorPhase
  readonly error: unknown
  readonly prepared?: PreparedTransactionData
  readonly signed?: SignedTransactionData | SignedIntentData
  readonly authorizations?: SignedAuthorizationList
  readonly submission?: TransactionResult
}

type PipelineResult = SuccessfulStage | FailedStage

export type BalanceObservation = {
  readonly kind: 'native' | 'erc20'
  readonly address: Address
  readonly chainId: number
  readonly expectedDelta: bigint
  readonly tolerance?: bigint
  readonly before: bigint
  readonly after: bigint
  readonly delta: bigint
}

const CHARACTERIZATION_FUNDING = {
  native: 1_000_000_000_000_000n,
  erc20: 100_000n,
} as const

function scenarioHandlerKey(scenario: IntentScenario): ScenarioHandlerKey {
  return `intent:${scenario.fixtureId}:${scenario.caseId}`
}

const executableIntentScenarios = characterizationScenarios.filter(
  (scenario): scenario is IntentScenario =>
    scenario.workflow === 'intent' &&
    isExecutableCharacterizationScenario(scenario),
)

export const LEGACY_INTENT_HANDLER_KEYS = new Set<ScenarioHandlerKey>(
  executableIntentScenarios.map(scenarioHandlerKey),
)

export function assertLegacyIntentHandlerCoverage(
  scenarios: readonly IntentScenario[],
): void {
  const missing: string[] = []
  for (const scenario of scenarios) {
    if (!isExecutableCharacterizationScenario(scenario)) continue
    if (!(scenario.fixtureId in LEGACY_INTENT_FIXTURE_HANDLERS)) {
      missing.push(`${scenario.id}: fixture ${scenario.fixtureId}`)
      continue
    }
    if (!(scenario.caseId in LEGACY_INTENT_CASE_HANDLERS)) {
      missing.push(`${scenario.id}: case ${scenario.caseId}`)
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing legacy intent handlers:\n${missing.join('\n')}`)
  }
}

assertLegacyIntentHandlerCoverage(executableIntentScenarios)

export async function runLegacyIntentScenario({
  scenario,
  subject = 'legacy',
  baseSha,
  runId,
  identityNamespace: providedIdentityNamespace,
  preparedReplay,
  onPrepared,
}: RunLegacyIntentScenarioInput): Promise<CharacterizationObservation> {
  if (!isExecutableCharacterizationScenario(scenario)) {
    throw new Error(
      `${scenario.id} is ${scenario.support.level}; use its focused coverage reference instead of the live legacy adapter`,
    )
  }

  const namespaceInput = { scenario, baseSha, runId, subject }
  const identityNamespace =
    providedIdentityNamespace ?? getIdentityNamespace(namespaceInput)
  const context = {
    scenarioId: scenario.id,
    workflow: scenario.workflow,
    subject,
    runId,
    comparisonGroup: getComparisonGroupNamespace(namespaceInput),
  } as const

  let fixture: LegacyIntentFixture
  try {
    fixture = await buildLegacyIntentFixture(scenario, identityNamespace)
    await enforceIntentFixturePreconditions(fixture)
    // Preconditions run through the legacy oracle; the rewrite subject drives
    // the operations under test through the public facade on the same account.
    if (subject === 'rewrite') {
      fixture.account = await createSubjectSdk(
        'rewrite',
        createIntentSdkInput(scenario),
      ).createAccount(fixture.accountConfig)
    }
    fixture.invocations.length = 0
  } catch (error) {
    return finishFailure(context, scenario, {
      phase: 'construction',
      error,
    })
  }

  let plan: LegacyIntentCasePlan
  try {
    plan = await buildLegacyIntentCasePlan(fixture)
  } catch (error) {
    return finishFailure(
      context,
      scenario,
      {
        phase: 'prepare',
        error,
      },
      fixture,
    )
  }

  let before: bigint | undefined
  try {
    before = plan.balance ? await readIntentBalance(plan.balance) : undefined
  } catch (error) {
    return finishFailure(
      context,
      scenario,
      {
        phase: 'construction',
        error,
      },
      fixture,
    )
  }
  const pipeline = await executePipeline(
    fixture,
    plan,
    preparedReplay,
    onPrepared,
  )
  const signing = observeSigning(fixture, pipeline)

  if (pipeline.phase !== 'success') {
    return finishFailure(context, scenario, pipeline, fixture, signing)
  }

  let balance: BalanceObservation | undefined
  try {
    balance =
      before !== undefined && plan.balance
        ? await observeIntentBalance(plan.balance, before)
        : undefined
  } catch (error) {
    return finishFailure(
      context,
      scenario,
      failedAfterSuccess(pipeline, 'assert', error),
      fixture,
      signing,
    )
  }

  let assertions: readonly TerminalAssertion[] = []
  let assertionError: unknown
  try {
    assertions = await assertTerminalState(fixture, plan, pipeline, balance)
  } catch (error) {
    assertionError = error
  }
  try {
    await cleanupIntentFixture(fixture)
  } catch (error) {
    assertionError ??= error
  }
  if (assertionError !== undefined) {
    return finishFailure(
      context,
      scenario,
      failedAfterSuccess(pipeline, 'assert', assertionError),
      fixture,
      signing,
    )
  }
  const details = modeDetails(scenario, signing, pipeline, {
    balance,
    assertions,
  })
  return createModeObservation(context, details, successfulOutcome())
}

async function executePipeline(
  fixture: LegacyIntentFixture,
  plan: LegacyIntentCasePlan,
  preparedReplay?: PreparedTransactionData,
  onPrepared?: (prepared: PreparedTransactionData) => void,
): Promise<PipelineResult> {
  let prepared: PreparedTransactionData
  if (preparedReplay) {
    prepared = preparedReplay
  } else {
    try {
      prepared = await fixture.account.prepareTransaction(plan.transaction)
    } catch (error) {
      return { phase: 'prepare', error }
    }
    try {
      onPrepared?.(prepared)
    } catch (error) {
      return { phase: 'prepare', error, prepared }
    }
  }

  let signed: SignedTransactionData | SignedIntentData
  try {
    signed = await signPrepared(fixture, plan, prepared)
    if (plan.tamperSigned) signed = tamperSignedTransaction(signed)
  } catch (error) {
    return { phase: 'sign', error, prepared }
  }

  let authorizations: SignedAuthorizationList | undefined
  try {
    authorizations = plan.signAuthorizations
      ? await fixture.account.signAuthorizations(prepared)
      : undefined
  } catch (error) {
    return { phase: 'authorize', error, prepared, signed }
  }

  if (fixture.scenario.mode === 'sign') {
    return { phase: 'success', prepared, signed, authorizations }
  }
  if (!isSignedTransaction(signed)) {
    return {
      phase: 'submit',
      error: new Error(
        'Headless intent signatures cannot be submitted directly',
      ),
      prepared,
      signed,
      authorizations,
    }
  }

  let submission: TransactionResult
  try {
    submission = await fixture.account.submitTransaction(signed, {
      ...(authorizations ? { authorizations } : {}),
      ...(fixture.scenario.mode === 'dryRun' ? { internal_dryRun: true } : {}),
    })
  } catch (error) {
    return {
      phase: 'submit',
      error,
      prepared,
      signed,
      authorizations,
    }
  }

  if (fixture.scenario.mode === 'dryRun') {
    return {
      phase: 'success',
      prepared,
      signed,
      authorizations,
      submission,
    }
  }

  try {
    const terminal = await fixture.account.waitForExecution(submission)
    return {
      phase: 'success',
      prepared,
      signed,
      authorizations,
      submission,
      terminal,
    }
  } catch (error) {
    return {
      phase: 'execution',
      error,
      prepared,
      signed,
      authorizations,
      submission,
    }
  }
}

async function signPrepared(
  fixture: LegacyIntentFixture,
  plan: LegacyIntentCasePlan,
  prepared: PreparedTransactionData,
): Promise<SignedTransactionData | SignedIntentData> {
  if (plan.signKind === 'headless') {
    const quote = prepared.quotes.best
    const targetChain =
      'targetChain' in plan.transaction
        ? plan.transaction.targetChain
        : plan.transaction.chain
    return fixture.account.signIntent(
      quote.signData,
      targetChain,
      plan.transaction.signers,
    )
  }
  if (plan.signKind !== 'independent') {
    return fixture.account.signTransaction(prepared)
  }
  const signatures: OwnerSignature[] = []
  for (const owner of fixture.ownerAccounts) {
    signatures.push(await fixture.account.signTransaction(prepared, { owner }))
  }
  return fixture.account.assembleTransaction(prepared, signatures)
}

function isSignedTransaction(
  signed: SignedTransactionData | SignedIntentData,
): signed is SignedTransactionData {
  return 'quote' in signed && 'intentInput' in signed
}

function tamperSignedTransaction(
  signed: SignedTransactionData | SignedIntentData,
): SignedTransactionData | SignedIntentData {
  const corrupt = (signature: Hex): Hex => {
    if (signature.length < 132) return '0xffff'
    return `${signature.slice(0, -130)}${'ff'.repeat(65)}` as Hex
  }
  return {
    ...signed,
    originSignatures: signed.originSignatures.map((signature) =>
      typeof signature === 'string'
        ? corrupt(signature)
        : { ...signature, preClaimSig: corrupt(signature.preClaimSig) },
    ),
    destinationSignature: corrupt(signed.destinationSignature),
  }
}

export async function enforceIntentFixturePreconditions(
  fixture: LegacyIntentFixture,
): Promise<void> {
  const { scenario } = fixture
  if (scenario.setup.preconditions.includes('stable-failure-fixture')) {
    throw new Error('No stable live failure fixture is configured')
  }
  if (scenario.setup.preconditions.includes('account-deployed')) {
    const chains = requiredDeploymentChains(scenario)
    for (const chain of chains) {
      if (!(await fixture.account.isDeployed(chain))) {
        await fixture.account.deploy(chain, { sponsored: true })
      }
      if (!(await waitForAccountDeployment(fixture, chain))) {
        throw new Error(
          `${fixture.account.getAddress()} was not deployed on ${chain.id}`,
        )
      }
    }
    if (scenario.axes.account.includes('state:adopted')) {
      fixture.accountConfig = {
        ...fixture.accountConfig,
        initData: { address: fixture.account.getAddress() },
      }
      fixture.account = await fixture.sdk.createAccount(fixture.accountConfig)
    }
  }

  if (scenario.setup.preconditions.includes('account-funded')) {
    if (scenario.setup.funding === 'erc20') {
      await ensureFunded(
        fixture.account.getAddress(),
        LEGACY_INTENT_SOURCE_CHAIN,
        {
          usdc: CHARACTERIZATION_FUNDING.erc20,
        },
      )
      await waitForOrchestratorUsdc(
        fixture.account,
        LEGACY_INTENT_SOURCE_CHAIN,
        CHARACTERIZATION_FUNDING.erc20,
      )
    } else if (
      scenario.setup.funding === 'native' ||
      scenario.setup.funding === 'gas-only'
    ) {
      await ensureFunded(
        fixture.account.getAddress(),
        LEGACY_INTENT_SOURCE_CHAIN,
        {
          native: CHARACTERIZATION_FUNDING.native,
        },
      )
      await waitForOrchestratorNative(
        fixture.account,
        LEGACY_INTENT_SOURCE_CHAIN,
        CHARACTERIZATION_FUNDING.native,
      )
    } else {
      throw new Error('account-funded requires a non-none funding asset')
    }
  }

  if (scenario.setup.preconditions.includes('session-enabled')) {
    await ensureSessionsEnabled(fixture)
  }
}

async function waitForAccountDeployment(
  fixture: LegacyIntentFixture,
  chain: Chain,
): Promise<boolean> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await fixture.account.isDeployed(chain)) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return fixture.account.isDeployed(chain)
}

function requiredDeploymentChains(scenario: IntentScenario): Chain[] {
  if (
    scenario.axes.operation.includes('intent:cross-chain') &&
    scenario.fixtureId.startsWith('session-')
  ) {
    return [LEGACY_INTENT_SOURCE_CHAIN, LEGACY_INTENT_TARGET_CHAIN]
  }
  return [LEGACY_INTENT_SOURCE_CHAIN]
}

async function ensureSessionsEnabled(
  fixture: LegacyIntentFixture,
): Promise<void> {
  const missing: (typeof fixture.sessions)[number][] = []
  for (const session of fixture.sessions) {
    if (!(await fixture.account.experimental_isSessionEnabled(session))) {
      missing.push(session)
    }
  }
  if (missing.length === 0) return

  for (const session of missing) {
    const details = await fixture.account.experimental_getSessionDetails([
      session,
    ])
    const userSignature =
      await fixture.account.experimental_signEnableSession(details)
    await executeSetupTransaction(
      fixture,
      {
        chain: session.chain,
        sponsored: true,
        calls: [createSessionCall(fixture)],
        signers: {
          type: 'experimental_session',
          session,
          enableData: {
            userSignature,
            hashesAndChainIds: [...details.hashesAndChainIds],
            sessionToEnableIndex: 0,
          },
        },
      },
      'enable session',
    )
    await waitForSessionEnabled(fixture, session)
  }
}

async function waitForSessionEnabled(
  fixture: LegacyIntentFixture,
  session: LegacyIntentFixture['sessions'][number],
): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await fixture.account.experimental_isSessionEnabled(session)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Session ${session.permissionId} was not enabled`)
}

async function executeSetupTransaction(
  fixture: LegacyIntentFixture,
  transaction: Transaction,
  purpose: string,
): Promise<void> {
  const prepared = await fixture.account.prepareTransaction(transaction)
  const signed = await fixture.account.signTransaction(prepared)
  const result = await fixture.account.submitTransaction(signed)
  const terminal = await fixture.account.waitForExecution(result)
  const operations = getOperations(terminal)
  if (
    operations.length === 0 ||
    operations.some(({ status }) => status !== 'COMPLETED')
  ) {
    throw new Error(`${purpose} setup transaction did not complete`)
  }
}

export async function cleanupIntentFixture(
  fixture: LegacyIntentFixture,
): Promise<void> {
  if (fixture.scenario.setup.cleanup !== 'disable-session') return
  for (const session of fixture.sessions) {
    if (!(await fixture.account.experimental_isSessionEnabled(session)))
      continue
    await executeSetupTransaction(
      fixture,
      {
        chain: session.chain,
        sponsored: true,
        calls: [
          experimental_disableSession(
            session,
            new Date(Date.now() + 60 * 60_000),
          ),
        ],
      },
      'disable session cleanup',
    )
  }
}

function observeSigning(
  fixture: LegacyIntentFixture,
  pipeline: PipelineResult,
): SigningObservation {
  const prepared = pipeline.prepared
  const signed = pipeline.signed
  return {
    account: observeLegacyAccount(fixture),
    prepared: prepared ? observePrepared(prepared) : undefined,
    signing: {
      messages: prepared ? safelyObserveMessages(fixture, prepared) : [],
      invocations: [...fixture.invocations],
    },
    artifacts: signed ? observeSignatureArtifacts(signed) : undefined,
    authorizations: pipeline.authorizations,
  }
}

function safelyObserveMessages(
  fixture: LegacyIntentFixture,
  prepared: PreparedTransactionData,
) {
  try {
    return observeMessages(fixture, prepared)
  } catch (error) {
    return {
      unavailable: true,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function observePrepared(prepared: PreparedTransactionData) {
  return {
    quotes: {
      traceId: prepared.quotes.traceId,
      count: prepared.quotes.all.length,
      best: {
        intentId: prepared.quotes.best.intentId,
        settlementLayer: prepared.quotes.best.settlementLayer,
      },
      all: prepared.quotes.all.map((quote) => ({
        intentId: quote.intentId,
        settlementLayer: quote.settlementLayer,
      })),
    },
    intentInput: prepared.intentInput,
  }
}

function observeMessages(
  fixture: LegacyIntentFixture,
  prepared: PreparedTransactionData,
) {
  const messages = fixture.account.getTransactionMessages(prepared)
  const observe = (
    message: TypedDataDefinition,
    role: string,
    order: number,
  ) => {
    const chainId = message.domain?.chainId
    const numericChainId = chainId === undefined ? undefined : Number(chainId)
    return {
      role,
      order,
      ...(Number.isSafeInteger(numericChainId)
        ? { chainId: numericChainId }
        : {}),
      primaryType: message.primaryType,
      payload: hashTypedData(message),
    }
  }
  return [
    ...messages.origin.map((message, index) =>
      observe(message, 'origin', index),
    ),
    observe(messages.destination, 'destination', messages.origin.length),
    ...(messages.targetExecution
      ? [
          observe(
            messages.targetExecution,
            'target-execution',
            messages.origin.length + 1,
          ),
        ]
      : []),
  ]
}

function observeSignatureArtifacts(
  signed: SignedTransactionData | SignedIntentData,
) {
  return {
    origin: signed.originSignatures.map((signature, order) =>
      typeof signature === 'string'
        ? {
            order,
            shape: 'single',
            prefix: signature.slice(0, 12),
            bytes: signature,
          }
        : {
            order,
            shape: 'dual',
            preClaimPrefix: signature.preClaimSig.slice(0, 12),
            notarizedClaimPrefix: signature.notarizedClaimSig.slice(0, 12),
            preClaim: signature.preClaimSig,
            notarizedClaim: signature.notarizedClaimSig,
          },
    ),
    destination: signed.destinationSignature,
    targetExecution: signed.targetExecutionSignature,
  }
}

function modeDetails(
  scenario: IntentScenario,
  sign: SigningObservation,
  pipeline: PipelineResult,
  terminal?: {
    balance?: BalanceObservation
    assertions: readonly TerminalAssertion[]
  },
) {
  if (scenario.mode === 'sign') return { mode: 'sign' as const, sign }
  if (scenario.mode === 'dryRun') {
    return {
      mode: 'dryRun' as const,
      sign,
      simulation: {
        accepted: pipeline.phase === 'success',
        result: pipeline.submission,
      },
    }
  }
  return {
    mode: 'execute' as const,
    sign,
    execution: {
      submission: pipeline.submission,
      terminal: pipeline.phase === 'success' ? pipeline.terminal : undefined,
      balance: terminal?.balance,
      assertions: terminal?.assertions ?? [],
    },
  }
}

async function assertTerminalState(
  fixture: LegacyIntentFixture,
  plan: LegacyIntentCasePlan,
  pipeline: SuccessfulStage,
  balance: BalanceObservation | undefined,
): Promise<readonly TerminalAssertion[]> {
  if (fixture.scenario.mode !== 'execute') return []
  assertCompletedOperations(pipeline.terminal, plan.transaction)
  const asserted: TerminalAssertion[] = []
  for (const assertion of fixture.scenario.terminalAssertions) {
    switch (assertion) {
      case 'intent-completed':
        break
      case 'no-failed-operations':
        if (
          getOperations(pipeline.terminal).some(
            ({ status }) => status === 'FAILED',
          )
        ) {
          throw new Error('Terminal intent contains a failed operation')
        }
        break
      case 'account-deployed': {
        const chain = getDestinationChain(plan.transaction)
        if (chain && !(await fixture.account.isDeployed(chain))) {
          throw new Error(`Account was not deployed on ${chain.id}`)
        }
        break
      }
      case 'balance-changed':
        if (!balance) {
          throw new Error('Expected a recipient balance observation')
        }
        if (
          absolute(balance.delta - balance.expectedDelta) >
          (balance.tolerance ?? 0n)
        ) {
          throw new Error(
            `Expected recipient balance delta ${balance.expectedDelta}, received ${balance.delta}`,
          )
        }
        break
      case 'session-enabled':
        for (const session of fixture.sessions) {
          if (!(await fixture.account.experimental_isSessionEnabled(session))) {
            throw new Error(`Session ${session.permissionId} was not enabled`)
          }
        }
        break
      case 'session-disabled':
        for (const session of fixture.sessions) {
          if (await fixture.account.experimental_isSessionEnabled(session)) {
            throw new Error(`Session ${session.permissionId} was not disabled`)
          }
        }
        break
      case 'intent-terminal-failure':
        throw new Error('A successful pipeline cannot assert terminal failure')
      case 'user-operation-receipt-success':
      case 'user-operation-receipt-failure':
        throw new Error(`${assertion} is invalid for an intent scenario`)
    }
    asserted.push(assertion)
  }
  return asserted
}

export async function assertIntentFixtureTerminalState(input: {
  readonly fixture: LegacyIntentFixture
  readonly plan: LegacyIntentCasePlan
  readonly terminal: unknown
  readonly balance?: BalanceObservation
}): Promise<readonly TerminalAssertion[]> {
  return assertTerminalState(
    input.fixture,
    input.plan,
    {
      phase: 'success',
      prepared: {} as PreparedTransactionData,
      signed: {} as SignedTransactionData,
      terminal: input.terminal,
    },
    input.balance,
  )
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value
}

function getOperations(
  status: unknown,
): Array<{ chain?: number; status?: string }> {
  const operations = (status as { operations?: unknown[] } | undefined)
    ?.operations
  if (!Array.isArray(operations)) return []
  return operations.map(
    (operation) => operation as { chain?: number; status?: string },
  )
}

function assertCompletedOperations(
  status: unknown,
  transaction: Transaction,
): void {
  const operations = getOperations(status)
  if (operations.length === 0)
    throw new Error('Intent returned no terminal operations')
  const allowed = new Set(
    'chain' in transaction
      ? [transaction.chain.id]
      : [
          ...(transaction.sourceChains ?? []).map(({ id }) => id),
          ...('id' in transaction.targetChain
            ? [transaction.targetChain.id]
            : []),
        ],
  )
  const expected = getDestinationChain(transaction)
  if (
    expected &&
    !operations.some(
      ({ chain, status: operationStatus }) =>
        chain === expected.id && operationStatus === 'COMPLETED',
    )
  ) {
    throw new Error(`No completed operation was observed on ${expected.id}`)
  }
  if (
    operations.some(({ chain }) => chain !== undefined && !allowed.has(chain))
  ) {
    throw new Error('Intent produced an operation on an unexpected chain')
  }
  if (
    operations.some(
      ({ status: operationStatus }) => operationStatus !== 'COMPLETED',
    )
  ) {
    throw new Error('Intent did not complete every observed operation')
  }
  const observedChains = operations.flatMap(({ chain }) =>
    chain === undefined ? [] : [chain],
  )
  if (new Set(observedChains).size !== observedChains.length) {
    throw new Error('Intent produced duplicate operations for a chain')
  }
}

function getDestinationChain(transaction: Transaction): Chain | undefined {
  if ('chain' in transaction) return transaction.chain
  return 'id' in transaction.targetChain ? transaction.targetChain : undefined
}

export async function readIntentBalance(input: {
  kind: 'native' | 'erc20'
  address: Address
  chainId: number
}): Promise<bigint> {
  const chain = getChain(input.chainId)
  const client = createPublicClient({
    chain,
    transport: http(process.env[`INTEGRATION_RPC_URL_${chain.id}`]),
  })
  if (input.kind === 'native')
    return client.getBalance({ address: input.address })
  return client.readContract({
    address: getLegacyUsdcAddress(chain.id),
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [input.address],
  })
}

export async function observeIntentBalance(
  input: LegacyIntentCasePlan['balance'] & {},
  before: bigint,
): Promise<BalanceObservation> {
  const after = await readIntentBalance(input)
  return { ...input, before, after, delta: after - before }
}

function getChain(chainId: number): Chain {
  if (chainId === LEGACY_INTENT_SOURCE_CHAIN.id)
    return LEGACY_INTENT_SOURCE_CHAIN
  if (chainId === LEGACY_INTENT_TARGET_CHAIN.id)
    return LEGACY_INTENT_TARGET_CHAIN
  throw new Error(`Unsupported characterization balance chain ${chainId}`)
}

function failedAfterSuccess(
  result: SuccessfulStage,
  phase: ErrorPhase,
  error: unknown,
): FailedStage {
  return {
    phase,
    error,
    prepared: result.prepared,
    signed: result.signed,
    authorizations: result.authorizations,
    submission: result.submission,
  }
}

function finishFailure(
  context: {
    scenarioId: string
    workflow: 'intent'
    subject: 'legacy' | 'public' | 'rewrite'
    runId: string
    comparisonGroup: string
  },
  scenario: IntentScenario,
  result: FailedStage,
  fixture?: LegacyIntentFixture,
  observedSigning?: SigningObservation,
): CharacterizationObservation {
  const signing =
    observedSigning ?? (fixture ? observeSigning(fixture, result) : {})
  return createModeObservation(
    context,
    modeDetails(scenario, signing, result),
    failedOutcome(result.error, result.phase),
  )
}
