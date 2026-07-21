export const PRIMARY_CATEGORIES = [
  'accounts',
  'validators',
  'sessions',
  'intents',
  'user-operations-and-direct-signing',
  'failures',
] as const

export const CHARACTERIZATION_SUBJECTS = [
  'legacy',
  'rewrite',
  'public',
] as const

export const WORKFLOW_KINDS = [
  'intent',
  'user-operation',
  'direct-signing',
] as const

export const EXECUTION_MODES = ['sign', 'dryRun', 'execute'] as const

export const COMPARISON_STRATEGIES = [
  'exact',
  'shared-inputs',
  'isolated-state',
] as const

export const AXIS_VOCABULARY = {
  account: [
    'safe',
    'safe:1.4.1',
    'safe-adapter:1.0.0',
    'safe-adapter:2.0.0',
    'nexus',
    'nexus:1.0.2',
    'nexus:1.2.0',
    'nexus:rhinestone-1.0.0-beta',
    'nexus:rhinestone-1.0.0',
    'kernel',
    'kernel:3.1',
    'kernel:3.2',
    'kernel:3.3',
    'startale',
    'hca',
    'eoa',
    'version:default',
    'version:explicit',
    'state:new',
    'state:deployed',
    'state:adopted',
    'state:eip7702',
    'factory:default',
    'factory:custom',
    'salt:default',
    'salt:explicit',
    'nonce:default',
    'nonce:explicit',
  ],
  owner: [
    'ecdsa:single',
    'ecdsa:multi-threshold-one',
    'ecdsa:multi-threshold-many',
    'ens:unexpired',
    'ens:expired',
    'passkey:single',
    'passkey:multiple',
    'mfa:ecdsa-passkey',
    'id:numeric',
    'id:hex',
    'threshold:min',
    'threshold:max',
    'threshold:invalid',
    'validator:default',
    'validator:custom-module',
    'owner-order:permuted',
    'owner:duplicate',
    'signing:full',
    'signing:independent',
    'signer:missing',
  ],
  session: [
    'none',
    'fresh',
    'enabled',
    'claim:fresh-only',
    'claim:enabled-only',
    'signers:single',
    'signers:per-chain',
    'owners:per-chain',
    'destination:non-evm-reuse',
    'owner-only',
    'destination:reuse',
    'destination:explicit',
    'permission:sudo',
    'permission:scoped',
    'permission:fallback',
    'permission:abi',
    'policy:universal-action',
    'policy:argument-expression',
    'policy:spending',
    'policy:timeframe',
    'policy:usage',
    'policy:value',
    'policy:intent-execution',
    'policy:permit2-claim',
    'permit:cross-chain',
    'recipient:bridge-self',
    'recipient:override',
    'settlement:subset',
    'settlement:all',
    'window:valid',
    'window:invalid',
    'limit:valid',
    'limit:invalid',
    'selector:valid',
    'selector:invalid',
    'calldata-offset:valid',
    'calldata-offset:invalid',
    'action:enable',
    'action:use',
    'action:disable',
    'action:erc1271',
    'action:headless-sign-intent',
    'independent-owner-signing:rejected',
    'contracts:development',
    'contracts:production',
  ],
  operation: [
    'intent:same-chain',
    'intent:cross-chain',
    'destination:non-evm',
    'asset:native',
    'asset:erc20',
    'asset:symbol',
    'asset:chain-token',
    'asset:non-evm-address',
    'amount:exact',
    'amount:omitted',
    'calls:single',
    'calls:multiple',
    'calls:lazy-single',
    'calls:lazy-multiple',
    'source-calls:none',
    'source-calls:without-funds',
    'source-calls:with-funds',
    'recipient:account',
    'recipient:alternate',
    'sponsorship:sponsored',
    'sponsorship:unsponsored',
    'app-fee',
    'settlement-filter',
    'access-list',
    'preclaim',
    'flow:prepare-sign-submit',
    'flow:send-convenience',
    'userop:entrypoint-0.7',
    'userop:prepare',
    'userop:sign',
    'userop:submit',
    'userop:sponsored',
    'userop:unsponsored',
    'userop:nonce-key',
    'userop:nonce-used',
    'sign:message',
    'sign:typed-data',
    'typed:nested',
    'typed:numeric-coercion',
    'verify:erc1271',
    'verify:erc6492',
    'verify:erc7739',
    'eip7702:authorization',
    'eip7702:init',
    'wallet-chain:selected',
    'wallet-chain:switch',
  ],
  infrastructure: [
    'auth:deprecated-api-key',
    'auth:current',
    'auth:jwt',
    'auth:jwt-refresh',
    'auth:jwt-failure',
    'rpc:default',
    'rpc:alchemy',
    'rpc:custom-per-chain',
    'bundler:default',
    'bundler:custom',
    'paymaster:default',
    'paymaster:custom',
    'orchestrator:default',
    'orchestrator:custom-url',
    'orchestrator:custom-headers',
    'contracts:development',
    'contracts:production',
    'failure:prepare',
    'failure:sign',
    'failure:authorize',
    'failure:submit',
    'failure:execution',
    'tamper:signature',
    'tamper:prepared',
    'unsupported:account',
    'unsupported:route',
    'unsupported:chain',
    'unsupported:token',
    'live-terminal-fixture',
    'live-server-fixture',
    'wrong-chain',
    'transport:connection',
    'transport:rate-limit',
    'transport:retry',
    'transport:timeout',
    'network:offline',
  ],
} as const

export const SCENARIO_TAGS = [
  'smoke',
  'negative',
  'stateful',
  'golden-vector',
  'live-gap',
  'high-risk:undeployed-safe-passkey-cross-chain',
  'high-risk:deployed-safe-threshold-independent',
  'high-risk:nexus-eip7702-signing',
  'high-risk:kernel-version-session-enable-use',
  'high-risk:startale-cross-chain-destination-signing',
  'high-risk:hca-custom-factory-default-validator',
  'high-risk:per-chain-session-asymmetry',
  'high-risk:mfa-threshold-aggregation',
  'high-risk:cross-chain-permit-claim-recipient',
  'high-risk:source-call-funds-cross-chain-token',
  'high-risk:deployless-erc6492-erc1271',
  'high-risk:custom-module-capability-resolution',
] as const

export const INTENT_FIXTURE_IDS = [
  'safe-ecdsa',
  'safe-passkey',
  'safe-threshold',
  'hca-ens',
  'safe-mfa',
  'nexus-ecdsa',
  'kernel-ecdsa',
  'startale-ecdsa',
  'hca-default',
  'hca-custom-factory',
  'eoa-configured',
  'session-single',
  'session-per-chain',
  'session-cross-chain',
  'session-policy',
  'custom-validator',
  'auth-jwt',
  'custom-providers',
] as const

export const INTENT_CASE_IDS = [
  'same-chain-noop',
  'cross-chain-noop',
  'non-evm-destination',
  'native-transfer',
  'erc20-transfer',
  'symbol-request',
  'chain-token-request',
  'amount-omitted-request',
  'multiple-calls',
  'lazy-single-call',
  'lazy-multiple-calls',
  'source-call-without-funds',
  'source-call-with-funds',
  'alternate-recipient',
  'unsponsored-noop',
  'app-fee',
  'settlement-filter',
  'access-list',
  'preclaim',
  'send-convenience',
  'enable-and-use-session',
  'use-enabled-session',
  'claim-only-session',
  'disable-session',
  'session-erc1271',
  'session-headless-sign',
  'cross-chain-permit',
  'invalid-policy',
  'tampered-signature',
  'tampered-prepared-payload',
  'unsupported-route',
  'unsupported-chain',
  'unsupported-token',
  'missing-authorization',
  'terminal-failure-fixture',
  'server-failure-fixture',
] as const

export const USER_OPERATION_FIXTURE_IDS = [
  'safe-user-operation-paymaster',
  'kernel-user-operation-no-paymaster',
  'nexus-user-operation-paymaster',
  'custom-user-operation-providers',
] as const

export const USER_OPERATION_CASE_IDS = [
  'prepare-and-sign',
  'submit-and-receipt',
  'sponsored',
  'unsponsored',
  'nonce-key',
  'nonce-already-used',
] as const

export const DIRECT_SIGNING_FIXTURE_IDS = [
  'safe-signing',
  'nexus-signing',
  'kernel-signing',
  'startale-signing',
  'session-signing',
  'eip7702-signing',
  'independent-signing',
] as const

export const DIRECT_SIGNING_CASE_IDS = [
  'plain-message',
  'typed-data',
  'nested-typed-data',
  'numeric-coercion',
  'erc1271-verification',
  'erc6492-verification',
  'erc7739-verification',
  'eip7702-authorization',
  'eip7702-init',
  'independent-contribution',
  'session-independent-rejection',
] as const

export const OBSERVATIONS = [
  'account-address',
  'deployment-state',
  'prepared-payload',
  'signed-payload',
  'signature-artifact',
  'signer-invocations',
  'authorization',
  'submission-result',
  'terminal-status',
  'balance-delta',
  'module-state',
  'error',
] as const

export const NORMALIZATION_RULES = [
  'request-id',
  'quote-id',
  'timestamps',
  'gas-estimates',
  'transaction-hash',
  'receipt-block',
] as const

export const TERMINAL_ASSERTIONS = [
  'intent-completed',
  'intent-terminal-failure',
  'no-failed-operations',
  'account-deployed',
  'balance-changed',
  'session-enabled',
  'session-disabled',
  'user-operation-receipt-success',
  'user-operation-receipt-failure',
] as const

export const ERROR_CLASS_IDS = [
  'AccountConfigurationNotSupportedError',
  'Error',
  'ExternalServiceTimeoutError',
  'IndependentSigningNotSupportedError',
  'InvalidAccountNonceError',
  'InsufficientOwnerSignaturesError',
  'InvalidOwnerSigningOptionsError',
  'IntentFailedError',
  'OrchestratorError',
  'QuoteNotInPreparedTransactionError',
  'RateLimitedError',
  'RpcRequestError',
  'SimulationFailedError',
  'TypeError',
  'UnauthorizedError',
  'UnprocessableContentError',
  'UnsupportedChainError',
  'UnsupportedTokenError',
  'ValidationError',
  'WalletClientNoConnectedAccountError',
] as const

type Values<T extends readonly string[]> = T[number]

export type PrimaryCategory = Values<typeof PRIMARY_CATEGORIES>
export type CharacterizationSubject = Values<typeof CHARACTERIZATION_SUBJECTS>
export type WorkflowKind = Values<typeof WORKFLOW_KINDS>
export type ExecutionMode = Values<typeof EXECUTION_MODES>
export type ComparisonStrategy = Values<typeof COMPARISON_STRATEGIES>
export type ScenarioTag = Values<typeof SCENARIO_TAGS>
export type CharacterizationAxis = keyof typeof AXIS_VOCABULARY
export type AxisValue<TAxis extends CharacterizationAxis> = Values<
  (typeof AXIS_VOCABULARY)[TAxis]
>
export type ScenarioAxes = {
  readonly [TAxis in CharacterizationAxis]: readonly AxisValue<TAxis>[]
}

export type IntentFixtureId = Values<typeof INTENT_FIXTURE_IDS>
export type IntentCaseId = Values<typeof INTENT_CASE_IDS>
export type UserOperationFixtureId = Values<typeof USER_OPERATION_FIXTURE_IDS>
export type UserOperationCaseId = Values<typeof USER_OPERATION_CASE_IDS>
export type DirectSigningFixtureId = Values<typeof DIRECT_SIGNING_FIXTURE_IDS>
export type ScenarioFixtureId =
  | IntentFixtureId
  | UserOperationFixtureId
  | DirectSigningFixtureId
export type DirectSigningCaseId = Values<typeof DIRECT_SIGNING_CASE_IDS>
export type ScenarioCaseId =
  | IntentCaseId
  | UserOperationCaseId
  | DirectSigningCaseId
export type Observation = Values<typeof OBSERVATIONS>
export type NormalizationRule = Values<typeof NORMALIZATION_RULES>
export type TerminalAssertion = Values<typeof TERMINAL_ASSERTIONS>
export type ErrorClassId = Values<typeof ERROR_CLASS_IDS>

export type ExecutionSupport =
  | { readonly level: 'live' }
  | {
      readonly level: 'dry-run-only'
      readonly limitation: string
    }
  | {
      readonly level: 'offline-only'
      readonly limitation: string
      readonly coverageRef: string
    }

export type ExpectedOutcome =
  | { readonly kind: 'success' }
  | {
      readonly kind: 'failure'
      readonly stage: 'prepare' | 'sign' | 'authorize' | 'submit' | 'execution'
      readonly errorClass: ErrorClassId
      readonly code?: string
      readonly messageInvariant: string
    }

type ScenarioBase = {
  readonly id: string
  readonly primaryCategory: PrimaryCategory
  readonly axes: ScenarioAxes
  readonly tags: readonly ScenarioTag[]
  readonly support: ExecutionSupport
  readonly expected: ExpectedOutcome
  readonly setup: {
    readonly identity: 'deterministic' | 'ephemeral'
    readonly preconditions: readonly (
      | 'none'
      | 'account-deployed'
      | 'account-funded'
      | 'session-enabled'
      | 'stable-failure-fixture'
      | 'wallet-connected'
    )[]
    readonly funding: 'none' | 'gas-only' | 'native' | 'erc20'
    readonly uniqueness: 'scenario-id' | 'funding-lane'
    readonly cleanup: 'none' | 'disable-session'
  }
  readonly comparison: ComparisonStrategy
  readonly observations: readonly Observation[]
  readonly normalization: readonly NormalizationRule[]
  readonly terminalAssertions: readonly TerminalAssertion[]
  readonly timeoutMs: number
}

export type IntentScenario = ScenarioBase & {
  readonly workflow: 'intent'
  readonly mode: ExecutionMode
  readonly fixtureId: IntentFixtureId
  readonly caseId: IntentCaseId
}

export type UserOperationScenario = ScenarioBase & {
  readonly workflow: 'user-operation'
  readonly mode: 'sign' | 'execute'
  readonly fixtureId: UserOperationFixtureId
  readonly caseId: UserOperationCaseId
}

export type DirectSigningScenario = ScenarioBase & {
  readonly workflow: 'direct-signing'
  readonly mode: 'sign'
  readonly fixtureId: DirectSigningFixtureId
  readonly caseId: DirectSigningCaseId
}

export type CharacterizationScenario =
  | IntentScenario
  | UserOperationScenario
  | DirectSigningScenario

type ScenarioDefaults = Pick<
  ScenarioBase,
  | 'setup'
  | 'comparison'
  | 'observations'
  | 'normalization'
  | 'terminalAssertions'
  | 'timeoutMs'
>

type ScenarioDefinition<TScenario extends CharacterizationScenario> = Omit<
  TScenario,
  keyof ScenarioDefaults
> &
  Partial<ScenarioDefaults>

const DEFAULT_SCENARIO_FIELDS: ScenarioDefaults = {
  setup: {
    identity: 'deterministic',
    preconditions: ['none'],
    funding: 'none',
    uniqueness: 'scenario-id',
    cleanup: 'none',
  },
  comparison: 'exact',
  observations: [
    'account-address',
    'prepared-payload',
    'signed-payload',
    'signature-artifact',
    'signer-invocations',
  ],
  normalization: ['request-id', 'quote-id', 'timestamps', 'gas-estimates'],
  terminalAssertions: [],
  timeoutMs: 60_000,
}

const EXECUTE_NORMALIZATION_RULES = [
  'transaction-hash',
  'receipt-block',
] as const satisfies readonly NormalizationRule[]

// Live cost budgets, in ms. On dev the orchestrator portfolio endpoint alone is
// ~25-30s per call, and cold setup (deploy + fund + portfolio propagation)
// stacks several such calls plus on-chain settlement. A flat timeout starves
// cold funded/deploy scenarios; these additive budgets keep each timeout
// proportional to the setup and mode the scenario actually drives. Warm reuse of
// the same SDK_ITEST_RUN_ID stays well under these.
const MODE_TIMEOUT_MS = {
  sign: 60_000,
  dryRun: 90_000,
  execute: 180_000,
} as const
const FUNDING_TIMEOUT_MS = 120_000
const DEPLOY_TIMEOUT_MS = 60_000
const SESSION_ENABLE_TIMEOUT_MS = 60_000

function computeTimeoutMs(
  definition: ScenarioDefinition<CharacterizationScenario>,
  preconditions: ReadonlySet<ScenarioBase['setup']['preconditions'][number]>,
): number {
  const funding = definition.setup?.funding ?? 'none'
  let timeout = MODE_TIMEOUT_MS[definition.mode]
  if (preconditions.has('account-funded') || funding !== 'none') {
    timeout += FUNDING_TIMEOUT_MS
  }
  if (preconditions.has('account-deployed')) timeout += DEPLOY_TIMEOUT_MS
  if (preconditions.has('session-enabled')) timeout += SESSION_ENABLE_TIMEOUT_MS
  return timeout
}

function scenarioDefaults(
  definition: ScenarioDefinition<CharacterizationScenario>,
): ScenarioDefaults {
  const preconditions = new Set<
    ScenarioBase['setup']['preconditions'][number]
  >()
  if (
    definition.axes.account.includes('state:deployed') ||
    definition.axes.account.includes('state:adopted')
  ) {
    preconditions.add('account-deployed')
  }
  if (definition.axes.session.includes('enabled')) {
    preconditions.add('session-enabled')
  }
  if (preconditions.size === 0) preconditions.add('none')

  // Timeout tracks the effective setup: an explicit scenario `setup` overrides
  // the inferred preconditions (intentScenario spreads the definition last), so
  // budget against whichever will actually run.
  const effectivePreconditions = definition.setup
    ? new Set(definition.setup.preconditions)
    : preconditions

  return {
    ...DEFAULT_SCENARIO_FIELDS,
    timeoutMs: computeTimeoutMs(definition, effectivePreconditions),
    comparison:
      definition.mode === 'dryRun'
        ? 'isolated-state'
        : DEFAULT_SCENARIO_FIELDS.comparison,
    normalization:
      definition.mode === 'execute'
        ? [
            ...DEFAULT_SCENARIO_FIELDS.normalization,
            ...EXECUTE_NORMALIZATION_RULES,
          ]
        : DEFAULT_SCENARIO_FIELDS.normalization,
    setup: {
      ...DEFAULT_SCENARIO_FIELDS.setup,
      preconditions: [...preconditions],
    },
  }
}

export function intentScenario(
  definition: ScenarioDefinition<IntentScenario>,
): IntentScenario {
  return { ...scenarioDefaults(definition), ...definition }
}

export function userOperationScenario(
  definition: ScenarioDefinition<UserOperationScenario>,
): UserOperationScenario {
  return { ...scenarioDefaults(definition), ...definition }
}

export function directSigningScenario(
  definition: ScenarioDefinition<DirectSigningScenario>,
): DirectSigningScenario {
  return { ...scenarioDefaults(definition), ...definition }
}
