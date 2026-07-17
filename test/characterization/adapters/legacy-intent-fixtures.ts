import { createHash } from 'node:crypto'
import { p256 } from '@noble/curves/p256'
import {
  type Abi,
  type Account,
  type Address,
  bytesToHex,
  type Chain,
  concat,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  hashMessage,
  hashTypedData,
  hexToBytes,
  keccak256,
  stringToHex,
  type TypedDataDefinition,
} from 'viem'
import {
  toWebAuthnAccount,
  type WebAuthnAccount,
} from 'viem/account-abstraction'
import { arbitrumSepolia, baseSepolia } from 'viem/chains'
import { experimental_disableSession } from '../../../src/actions/smart-sessions'
import { RhinestoneSDK as RewriteRhinestoneSDK } from '../../../src/api/sdk'
import {
  hyperCoreMainnet,
  type NonEvmAddress,
  type RhinestoneAccount,
  type RhinestoneAccountConfig,
  RhinestoneSDK,
  type SessionDefinition,
  type SignerSet,
  solanaMainnet,
  type Transaction,
} from '../../../src/index'
import { toSession } from '../../../src/smart-sessions/index'
import {
  getIntegrationOrchestratorUrl,
  getIntegrationUseDevContracts,
} from '../../integration/config/environment'
import { createDeterministicOwner } from '../identity'
import type { IntentCaseId, IntentFixtureId, IntentScenario } from '../types'

export const LEGACY_INTENT_SOURCE_CHAIN = baseSepolia
export const LEGACY_INTENT_TARGET_CHAIN = arbitrumSepolia

const NOOP_TARGET: Address = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
const CUSTOM_HCA_FACTORY: Address = '0x2222222222222222222222222222222222222222'
const CUSTOM_OWNABLE_VALIDATOR: Address =
  '0x2483da3a338895199e5e538530213157e931bf06'
const UNSUPPORTED_TOKEN: Address = '0x000000000000000000000000000000000000dead'
const P256_ORDER = BigInt(
  '0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551',
)

const noopAbi = [
  {
    type: 'function',
    name: 'noop',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const policyAbi = [
  {
    type: 'function',
    name: 'constrained',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const payableAbi = [
  {
    type: 'function',
    name: 'deposit',
    inputs: [],
    outputs: [],
    stateMutability: 'payable',
  },
] as const

export type LegacySignerInvocation = {
  readonly kind:
    | 'message'
    | 'typed-data'
    | 'transaction'
    | 'authorization'
    | 'webauthn'
  readonly role: string
  readonly chainId?: number
  readonly payload: Hex
  readonly order: number
}

export type LegacyIntentFixture = {
  readonly scenario: IntentScenario
  readonly identityNamespace: string
  readonly sdk: RhinestoneSDK
  account: RhinestoneAccount
  accountConfig: RhinestoneAccountConfig
  readonly invocations: LegacySignerInvocation[]
  readonly ownerAccounts: readonly Account[]
  readonly sessions: readonly ReturnType<typeof toSession>[]
  readonly recipient: Address
}

export type LegacyIntentCasePlan = {
  readonly transaction: Transaction
  readonly signKind?: 'full' | 'independent' | 'headless'
  readonly tamperSigned?: boolean
  readonly signAuthorizations?: boolean
  readonly balance?: {
    readonly kind: 'native' | 'erc20'
    readonly address: Address
    readonly chainId: number
    readonly expectedDelta: bigint
    readonly tolerance?: bigint
  }
}

type FixtureBuilder = (
  scenario: IntentScenario,
  identityNamespace: string,
) => Promise<LegacyIntentFixture>

export type FixtureSubject = 'legacy' | 'public' | 'rewrite'

type CaseBuilder = (
  fixture: LegacyIntentFixture,
) => Promise<LegacyIntentCasePlan>

export class LegacyIntentFixtureError extends Error {
  constructor(
    readonly scenarioId: string,
    message: string,
  ) {
    super(`${scenarioId}: ${message}`)
    this.name = 'LegacyIntentFixtureError'
  }
}

function requireEnvironment(name: string, scenarioId: string): string {
  const value = process.env[name]
  if (!value) {
    throw new LegacyIntentFixtureError(
      scenarioId,
      `${name} is required for this live characterization scenario`,
    )
  }
  return value
}

function requireRelayerApiKey(scenarioId: string): string {
  const value =
    process.env.INTEGRATION_RHINESTONE_API_RELAYER_KEY ??
    process.env.INTEGRATION_RELAYER_API_KEY
  if (!value) {
    throw new LegacyIntentFixtureError(
      scenarioId,
      'INTEGRATION_RHINESTONE_API_RELAYER_KEY is required for this live characterization scenario',
    )
  }
  return value
}

export function createIntentSdkInput(
  scenario: IntentScenario,
): ConstructorParameters<typeof RhinestoneSDK>[0] {
  const endpointUrl = getIntegrationOrchestratorUrl()
  if (
    scenario.axes.infrastructure.includes('orchestrator:custom-url') &&
    !endpointUrl
  ) {
    throw new LegacyIntentFixtureError(
      scenario.id,
      'A resolved orchestrator URL is required for this live characterization scenario',
    )
  }

  const provider = scenario.axes.infrastructure.includes('rpc:alchemy')
    ? {
        type: 'alchemy' as const,
        apiKey: requireEnvironment('INTEGRATION_ALCHEMY_API_KEY', scenario.id),
      }
    : scenario.axes.infrastructure.includes('rpc:custom-per-chain')
      ? {
          type: 'custom' as const,
          urls: Object.fromEntries(
            [LEGACY_INTENT_SOURCE_CHAIN, LEGACY_INTENT_TARGET_CHAIN].map(
              (chain) => [
                chain.id,
                requireEnvironment(
                  `INTEGRATION_RPC_URL_${chain.id}`,
                  scenario.id,
                ),
              ],
            ),
          ),
        }
      : undefined

  const common = {
    ...(endpointUrl ? { endpointUrl: endpointUrl.replace(/\/+$/, '') } : {}),
    ...(provider ? { provider } : {}),
    useDevContracts: resolveUseDevContracts(scenario),
    ...(scenario.axes.infrastructure.includes('orchestrator:custom-headers')
      ? { headers: { 'x-sdk-characterization': scenario.id } }
      : {}),
  }

  if (scenario.axes.infrastructure.includes('auth:jwt')) {
    const rejected = scenario.axes.infrastructure.includes('auth:jwt-failure')
    const token = rejected
      ? 'invalid-characterization-jwt'
      : requireEnvironment('INTEGRATION_RHINESTONE_JWT', scenario.id)
    return {
      ...common,
      auth: {
        mode: 'experimental_jwt',
        accessToken: scenario.axes.infrastructure.includes('auth:jwt-refresh')
          ? async () => token
          : token,
      },
    }
  }

  const apiKey =
    scenario.mode === 'dryRun'
      ? requireRelayerApiKey(scenario.id)
      : requireEnvironment('INTEGRATION_RHINESTONE_API_KEY', scenario.id)
  return scenario.axes.infrastructure.includes('auth:deprecated-api-key')
    ? { ...common, apiKey }
    : {
        ...common,
        auth: { mode: 'apiKey', apiKey },
      }
}

function resolveUseDevContracts(scenario: IntentScenario): boolean {
  const contractAxes = [
    ...scenario.axes.infrastructure,
    ...scenario.axes.session,
  ]
  if (contractAxes.includes('contracts:development')) return true
  if (contractAxes.includes('contracts:production')) return false
  return getIntegrationUseDevContracts()
}

function payloadHash(value: unknown): Hex {
  return keccak256(
    stringToHex(
      JSON.stringify(value, (_, item) =>
        typeof item === 'bigint' ? `${item}n` : item,
      ),
    ),
  )
}

function typedDataChainId(
  typedData: Pick<TypedDataDefinition, 'domain'>,
): number | undefined {
  const value = typedData.domain?.chainId
  if (value === undefined) return undefined
  const chainId = Number(value)
  return Number.isSafeInteger(chainId) ? chainId : undefined
}

function traceEcdsaOwner(
  identityNamespace: string,
  role: string,
  invocations: LegacySignerInvocation[],
): Account {
  const owner = createDeterministicOwner(identityNamespace, role)
  const signMessage = owner.signMessage.bind(owner)
  owner.signMessage = async (parameters) => {
    invocations.push({
      kind: 'message',
      role,
      payload: hashMessage(parameters.message),
      order: invocations.length,
    })
    return signMessage(parameters)
  }
  const signTypedData = owner.signTypedData.bind(owner)
  owner.signTypedData = async (parameters) => {
    const typedData = parameters as TypedDataDefinition
    const chainId = typedDataChainId(typedData)
    invocations.push({
      kind: 'typed-data',
      role,
      ...(chainId === undefined ? {} : { chainId }),
      payload: hashTypedData(typedData),
      order: invocations.length,
    })
    return signTypedData(parameters)
  }
  const signTransaction = owner.signTransaction.bind(owner)
  owner.signTransaction = async (transaction, options) => {
    invocations.push({
      kind: 'transaction',
      role,
      chainId: transaction.chainId,
      payload: payloadHash(transaction),
      order: invocations.length,
    })
    return signTransaction(transaction, options)
  }
  const signAuthorization = owner.signAuthorization.bind(owner)
  owner.signAuthorization = async (authorization) => {
    invocations.push({
      kind: 'authorization',
      role,
      chainId: authorization.chainId,
      payload: payloadHash(authorization),
      order: invocations.length,
    })
    return signAuthorization(authorization)
  }
  return owner
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}

function sha256(value: Uint8Array | string): Uint8Array {
  return createHash('sha256').update(value).digest()
}

function createP256Signer(identityNamespace: string, role: string) {
  const seed = BigInt(
    keccak256(stringToHex(`${identityNamespace}:${role}:p256`)),
  )
  const scalar = (seed % (P256_ORDER - 1n)) + 1n
  const privateBytes = hexToBytes(
    `0x${scalar.toString(16).padStart(64, '0')}` as Hex,
  )
  const publicKey = p256.getPublicKey(privateBytes, false)

  return {
    publicKey: bytesToHex(publicKey.subarray(1)),
    sign(hash: Hex) {
      const challenge = base64Url(hexToBytes(hash))
      const clientDataJSON = JSON.stringify({
        type: 'webauthn.get',
        challenge,
        origin: 'https://characterization.local',
        crossOrigin: false,
      })
      const authenticatorData = concat([
        bytesToHex(sha256('characterization.local')),
        '0x01',
        '0x00000000',
      ])
      const signedPayload = concat([
        authenticatorData,
        bytesToHex(sha256(clientDataJSON)),
      ])
      const signature = p256
        .sign(hexToBytes(signedPayload), privateBytes, {
          prehash: true,
          lowS: true,
        })
        .toCompactRawBytes()
      return {
        signature: bytesToHex(signature),
        webauthn: {
          authenticatorData,
          clientDataJSON,
          challengeIndex: clientDataJSON.indexOf('"challenge"'),
          typeIndex: clientDataJSON.indexOf('"type"'),
          userVerificationRequired: false,
        },
        raw: {} as never,
      }
    },
  }
}

export function createLegacyDeterministicPasskey(
  identityNamespace: string,
  role: string,
  invocations: LegacySignerInvocation[] = [],
): WebAuthnAccount {
  const signer = createP256Signer(identityNamespace, role)
  const account = toWebAuthnAccount({
    credential: {
      id: `sdk-characterization-${payloadHash(`${identityNamespace}:${role}`).slice(2, 18)}`,
      publicKey: signer.publicKey,
    },
  })
  const sign = async (hash: Hex) => {
    invocations.push({
      kind: 'webauthn',
      role,
      payload: hash,
      order: invocations.length,
    })
    return signer.sign(hash)
  }
  account.sign = ({ hash }) => sign(hash)
  account.signMessage = ({ message }) => sign(hashMessage(message))
  account.signTypedData = (parameters) =>
    sign(hashTypedData(parameters as TypedDataDefinition))
  return account
}

function accountProviderFor(
  scenario: IntentScenario,
): NonNullable<RhinestoneAccountConfig['account']> {
  const accountAxes = scenario.axes.account
  if (accountAxes.includes('safe')) {
    return {
      type: 'safe' as const,
      ...(accountAxes.includes('version:explicit')
        ? { version: '1.4.1' as const }
        : {}),
      ...(accountAxes.includes('safe-adapter:2.0.0')
        ? { adapter: '2.0.0' as const }
        : accountAxes.includes('safe-adapter:1.0.0')
          ? { adapter: '1.0.0' as const }
          : {}),
      ...(accountAxes.includes('nonce:explicit') ? { nonce: 1n } : {}),
    }
  }
  if (accountAxes.includes('kernel')) {
    const version: '3.1' | '3.2' | '3.3' = accountAxes.includes('kernel:3.1')
      ? '3.1'
      : accountAxes.includes('kernel:3.3')
        ? '3.3'
        : '3.2'
    return {
      type: 'kernel' as const,
      ...(accountAxes.includes('version:explicit') ? { version } : {}),
      ...(accountAxes.includes('salt:explicit')
        ? { salt: payloadHash(`${scenario.id}:kernel-salt`) }
        : {}),
    }
  }
  if (accountAxes.includes('startale')) {
    return {
      type: 'startale' as const,
      ...(accountAxes.includes('salt:explicit')
        ? { salt: payloadHash(`${scenario.id}:startale-salt`) }
        : {}),
    }
  }
  if (accountAxes.includes('hca')) {
    return {
      type: 'hca' as const,
      ...(accountAxes.includes('factory:custom')
        ? { factory: CUSTOM_HCA_FACTORY }
        : {}),
    }
  }
  if (accountAxes.includes('eoa')) return { type: 'eoa' as const }

  const version = accountAxes.includes('nexus:1.0.2')
    ? '1.0.2'
    : accountAxes.includes('nexus:1.2.0')
      ? '1.2.0'
      : accountAxes.includes('nexus:rhinestone-1.0.0-beta')
        ? 'rhinestone-1.0.0-beta'
        : accountAxes.includes('nexus:rhinestone-1.0.0')
          ? 'rhinestone-1.0.0'
          : undefined
  return {
    type: 'nexus' as const,
    ...(version ? { version } : {}),
    ...(accountAxes.includes('salt:explicit')
      ? { salt: payloadHash(`${scenario.id}:nexus-salt`) }
      : {}),
  }
}

function ownerConfigFor(
  fixtureId: IntentFixtureId,
  scenario: IntentScenario,
  identityNamespace: string,
  invocations: LegacySignerInvocation[],
) {
  const owner = (role: string) =>
    traceEcdsaOwner(identityNamespace, role, invocations)
  const passkey = (role: string) =>
    createLegacyDeterministicPasskey(identityNamespace, role, invocations)

  if (fixtureId === 'safe-passkey') {
    const accounts = [passkey('passkey-0')]
    if (scenario.axes.owner.includes('passkey:multiple')) {
      accounts.push(passkey('passkey-1'))
    }
    return {
      owners: {
        type: 'passkey' as const,
        accounts,
        threshold: accounts.length,
      },
      ownerAccounts: [] as Account[],
    }
  }
  if (fixtureId === 'safe-mfa') {
    const ecdsa = owner('mfa-ecdsa')
    return {
      owners: {
        type: 'multi-factor' as const,
        validators: [
          { type: 'ecdsa' as const, accounts: [ecdsa], threshold: 1 },
          {
            type: 'passkey' as const,
            accounts: [passkey('mfa-passkey')],
            threshold: 1,
          },
        ],
        threshold: 2,
      },
      ownerAccounts: [ecdsa],
    }
  }
  if (fixtureId === 'hca-ens') {
    const ens = owner('ens-owner')
    return {
      owners: {
        type: 'ens' as const,
        owners: [
          {
            account: ens,
            ...(scenario.axes.owner.includes('ens:expired')
              ? { expiration: new Date(1_000) }
              : {}),
          },
        ],
        threshold: 1,
      },
      ownerAccounts: [ens],
    }
  }

  const thresholdFixture = fixtureId === 'safe-threshold'
  const accounts = thresholdFixture
    ? [owner('owner-0'), owner('owner-1')]
    : [owner('owner-0')]
  const threshold = scenario.axes.owner.includes('ecdsa:multi-threshold-one')
    ? 1
    : accounts.length
  return {
    owners: {
      type: 'ecdsa' as const,
      accounts,
      threshold,
      ...(fixtureId === 'custom-validator'
        ? { module: CUSTOM_OWNABLE_VALIDATOR }
        : {}),
    },
    ownerAccounts: accounts,
  }
}

function createPolicyPermissions(scenario: IntentScenario, recipient: Address) {
  const sessionAxes = scenario.axes.session
  if (sessionAxes.includes('permission:sudo')) return undefined
  if (
    sessionAxes.includes('policy:universal-action') ||
    sessionAxes.includes('policy:argument-expression') ||
    sessionAxes.includes('calldata-offset:valid')
  ) {
    return [
      {
        abi: policyAbi,
        address: NOOP_TARGET,
        functions: {
          constrained: {
            params: {
              recipient: sessionAxes.includes('policy:argument-expression')
                ? { anyOf: [recipient, NOOP_TARGET] as const }
                : { condition: 'equal' as const, value: recipient },
              amount: { condition: 'lessThanOrEqual' as const, value: 10n },
            },
            ...(sessionAxes.includes('policy:usage') ? { maxUses: 5n } : {}),
          },
        },
      },
    ] as const
  }
  if (
    sessionAxes.includes('policy:timeframe') ||
    sessionAxes.includes('policy:value')
  ) {
    return [
      {
        abi: payableAbi,
        address: NOOP_TARGET,
        functions: {
          deposit: {
            validAfter: new Date('2020-01-01T00:00:00.000Z'),
            validUntil: new Date('2099-01-01T00:00:00.000Z'),
            valueLimit: 1n,
          },
        },
      },
    ] as const
  }
  if (
    sessionAxes.includes('policy:spending') ||
    sessionAxes.includes('policy:usage')
  ) {
    return [
      {
        abi: erc20Abi,
        address: getUsdcAddress(LEGACY_INTENT_SOURCE_CHAIN.id),
        functions: {
          transfer: {
            spendingLimit: {
              token: getUsdcAddress(LEGACY_INTENT_SOURCE_CHAIN.id),
              amount: 10n,
            },
            maxUses: 5n,
          },
        },
      },
    ] as const
  }
  return [
    {
      abi: noopAbi,
      address: NOOP_TARGET,
      functions: { noop: {} },
    },
  ] as const
}

function createSessions(
  scenario: IntentScenario,
  identityNamespace: string,
  invocations: LegacySignerInvocation[],
  recipient: Address,
) {
  if (!scenario.fixtureId.startsWith('session-')) return []
  const sessionOwner = (role: string) =>
    traceEcdsaOwner(identityNamespace, role, invocations)
  const useDevContracts = resolveUseDevContracts(scenario)
  const crossChainPermit = scenario.axes.session.includes('permit:cross-chain')
    ? [
        {
          from: {
            chain: LEGACY_INTENT_SOURCE_CHAIN,
            token: getUsdcAddress(LEGACY_INTENT_SOURCE_CHAIN.id),
            maxAmount: 1_000_000n,
          },
          to: {
            chain: LEGACY_INTENT_TARGET_CHAIN,
            token: getUsdcAddress(LEGACY_INTENT_TARGET_CHAIN.id),
            recipient: scenario.axes.session.includes('recipient:override')
              ? recipient
              : undefined,
          },
          allowRecipientNotAccount:
            scenario.axes.session.includes('recipient:override'),
          settlementLayers: scenario.axes.session.includes('settlement:subset')
            ? ['ECO' as const]
            : undefined,
        },
      ]
    : undefined
  const definitionFor = (
    chain: Chain,
    role: string,
  ): SessionDefinition<readonly Abi[]> => ({
    chain,
    owners: { type: 'ecdsa' as const, accounts: [sessionOwner(role)] },
    ...(scenario.fixtureId === 'session-policy'
      ? {
          permissions: createPolicyPermissions(
            scenario,
            recipient,
          ) as unknown as SessionDefinition['permissions'],
        }
      : scenario.axes.session.includes('permission:sudo')
        ? {}
        : {
            permissions: createPolicyPermissions(
              scenario,
              recipient,
            ) as unknown as SessionDefinition['permissions'],
          }),
    ...(crossChainPermit ? { crossChainPermits: crossChainPermit } : {}),
  })

  const source = toSession(
    definitionFor(LEGACY_INTENT_SOURCE_CHAIN, 'session-source'),
    {
      useDevContracts,
    },
  )
  if (
    scenario.fixtureId === 'session-per-chain' ||
    scenario.axes.session.includes('destination:explicit')
  ) {
    const target = toSession(
      definitionFor(LEGACY_INTENT_TARGET_CHAIN, 'session-target'),
      { useDevContracts },
    )
    return [source, target]
  }
  return [source]
}

async function createFixture(
  scenario: IntentScenario,
  identityNamespace: string,
): Promise<LegacyIntentFixture> {
  const invocations: LegacySignerInvocation[] = []
  // Fixtures (and their on-chain preconditions: deploy, session enable) are
  // always built with the legacy oracle. The paired rewrite subject swaps in a
  // public-facade account for the operations under test once preconditions are
  // satisfied — see runLegacyIntentScenario.
  const sdk = new RhinestoneSDK(createIntentSdkInput(scenario))
  const ownerConfig = ownerConfigFor(
    scenario.fixtureId,
    scenario,
    identityNamespace,
    invocations,
  )
  const accountConfig: RhinestoneAccountConfig = {
    account: accountProviderFor(scenario),
    owners: ownerConfig.owners,
    ...(scenario.fixtureId.startsWith('session-')
      ? { experimental_sessions: { enabled: true } }
      : {}),
    ...(scenario.axes.account.includes('state:eip7702')
      ? { eoa: traceEcdsaOwner(identityNamespace, 'eip7702-eoa', invocations) }
      : {}),
  }
  const account = await sdk.createAccount(accountConfig)
  const recipient = createDeterministicOwner(
    identityNamespace,
    'recipient',
  ).address
  const sessions = createSessions(
    scenario,
    identityNamespace,
    invocations,
    recipient,
  )
  return {
    scenario,
    identityNamespace,
    sdk,
    account,
    accountConfig,
    invocations,
    ownerAccounts: ownerConfig.ownerAccounts,
    sessions,
    recipient,
  }
}

export const LEGACY_INTENT_FIXTURE_HANDLERS = {
  'safe-ecdsa': createFixture,
  'safe-passkey': createFixture,
  'safe-threshold': createFixture,
  'hca-ens': createFixture,
  'safe-mfa': createFixture,
  'nexus-ecdsa': createFixture,
  'kernel-ecdsa': createFixture,
  'startale-ecdsa': createFixture,
  'hca-default': createFixture,
  'hca-custom-factory': createFixture,
  'eoa-configured': createFixture,
  'session-single': createFixture,
  'session-per-chain': createFixture,
  'session-cross-chain': createFixture,
  'session-policy': createFixture,
  'custom-validator': createFixture,
  'auth-jwt': createFixture,
  'custom-providers': createFixture,
} satisfies Record<IntentFixtureId, FixtureBuilder>

export function buildLegacyIntentFixture(
  scenario: IntentScenario,
  identityNamespace: string,
): Promise<LegacyIntentFixture> {
  return LEGACY_INTENT_FIXTURE_HANDLERS[scenario.fixtureId](
    scenario,
    identityNamespace,
  )
}

export function createSubjectSdk(
  subject: FixtureSubject,
  input: ConstructorParameters<typeof RhinestoneSDK>[0],
): RhinestoneSDK {
  return (subject === 'rewrite'
    ? new RewriteRhinestoneSDK(
        input as ConstructorParameters<typeof RewriteRhinestoneSDK>[0],
      )
    : new RhinestoneSDK(input)) as unknown as RhinestoneSDK
}

export function createNoopCall() {
  return {
    to: NOOP_TARGET,
    value: 0n,
    data: encodeFunctionData({ abi: noopAbi, functionName: 'noop' }),
  }
}

function sameChainTransaction(fixture: LegacyIntentFixture): Transaction {
  return {
    chain: LEGACY_INTENT_SOURCE_CHAIN,
    sponsored: true,
    calls: [createNoopCall()],
    ...(ownerSigners(fixture) ? { signers: ownerSigners(fixture) } : {}),
  }
}

function crossChainTransaction(fixture: LegacyIntentFixture): Transaction {
  return {
    sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
    targetChain: LEGACY_INTENT_TARGET_CHAIN,
    sponsored: true,
    calls: [createNoopCall()],
    ...(ownerSigners(fixture) ? { signers: ownerSigners(fixture) } : {}),
  }
}

function ownerSigners(fixture: LegacyIntentFixture): SignerSet | undefined {
  if (
    !fixture.scenario.axes.owner.includes('id:numeric') &&
    !fixture.scenario.axes.owner.includes('id:hex')
  )
    return undefined
  const owners = fixture.accountConfig.owners
  if (owners?.type !== 'multi-factor') return undefined
  const idFor = (index: number) =>
    fixture.scenario.axes.owner.includes('id:hex')
      ? (`0x${(index + 1).toString(16)}` as Hex)
      : index + 1
  return {
    type: 'owner' as const,
    kind: 'multi-factor' as const,
    validators: owners.validators.map((validator, index) =>
      validator.type === 'passkey'
        ? {
            type: 'passkey' as const,
            id: idFor(index),
            accounts: validator.accounts,
          }
        : {
            type: 'ecdsa' as const,
            id: idFor(index),
            accounts:
              validator.type === 'ens'
                ? validator.owners.map(({ account }) => account)
                : validator.accounts,
          },
    ),
  }
}

export async function buildSessionSigners(
  fixture: LegacyIntentFixture,
  includeEnableData: boolean,
) {
  const sessions = fixture.sessions
  if (sessions.length === 0) {
    throw new LegacyIntentFixtureError(
      fixture.scenario.id,
      `${fixture.scenario.caseId} requires a session fixture`,
    )
  }
  const details = includeEnableData
    ? await fixture.account.experimental_getSessionDetails([...sessions])
    : undefined
  const signature = details
    ? await fixture.account.experimental_signEnableSession(details)
    : undefined
  const entry = (session: (typeof sessions)[number], index: number) => ({
    session,
    ...(details && signature
      ? {
          enableData: {
            userSignature: signature,
            hashesAndChainIds: details.hashesAndChainIds,
            sessionToEnableIndex: index,
          },
        }
      : {}),
  })
  if (sessions.length === 1) {
    return {
      type: 'experimental_session' as const,
      ...entry(sessions[0], 0),
    }
  }
  return {
    type: 'experimental_session' as const,
    sessions: Object.fromEntries(
      sessions.map((session, index) => [
        session.chain.id,
        entry(session, index),
      ]),
    ),
  }
}

function getUsdcAddress(chainId: number): Address {
  if (chainId === LEGACY_INTENT_SOURCE_CHAIN.id) {
    return '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
  }
  if (chainId === LEGACY_INTENT_TARGET_CHAIN.id) {
    return '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
  }
  throw new Error(`No characterization USDC address for chain ${chainId}`)
}

export function createSessionCall(fixture: LegacyIntentFixture) {
  const axes = fixture.scenario.axes.session
  if (axes.includes('policy:spending') || axes.includes('policy:usage')) {
    return {
      to: getUsdcAddress(LEGACY_INTENT_SOURCE_CHAIN.id),
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [fixture.recipient, 1n],
      }),
    }
  }
  if (axes.includes('policy:timeframe') || axes.includes('policy:value')) {
    return {
      to: NOOP_TARGET,
      value: 0n,
      data: encodeFunctionData({ abi: payableAbi, functionName: 'deposit' }),
    }
  }
  if (
    axes.includes('policy:universal-action') ||
    axes.includes('policy:argument-expression') ||
    axes.includes('calldata-offset:valid')
  ) {
    return {
      to: NOOP_TARGET,
      value: 0n,
      data: encodeFunctionData({
        abi: policyAbi,
        functionName: 'constrained',
        args: [fixture.recipient, 1n],
      }),
    }
  }
  return createNoopCall()
}

async function sessionTransaction(
  fixture: LegacyIntentFixture,
  options: { crossChain?: boolean; enable?: boolean } = {},
): Promise<Transaction> {
  const base = {
    sponsored: true as const,
    calls: [createSessionCall(fixture)],
    signers: await buildSessionSigners(fixture, options.enable ?? false),
  }
  return options.crossChain
    ? {
        ...base,
        sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
        targetChain: LEGACY_INTENT_TARGET_CHAIN,
      }
    : { ...base, chain: LEGACY_INTENT_SOURCE_CHAIN }
}

const LEGACY_INTENT_CASE_HANDLERS = {
  'same-chain-noop': async (fixture) => ({
    transaction: sameChainTransaction(fixture),
    ...(fixture.scenario.axes.owner.includes('signing:independent')
      ? { signKind: 'independent' as const }
      : {}),
  }),
  'cross-chain-noop': async (fixture) => ({
    transaction: fixture.scenario.fixtureId.startsWith('session-')
      ? await sessionTransaction(fixture, { crossChain: true })
      : crossChainTransaction(fixture),
  }),
  'non-evm-destination': async () => ({
    transaction: {
      sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
      targetChain: solanaMainnet,
      sponsored: true,
      recipient: '11111111111111111111111111111111' as NonEvmAddress,
    },
  }),
  'native-transfer': async (fixture) => ({
    transaction: {
      chain: LEGACY_INTENT_SOURCE_CHAIN,
      sponsored: true,
      calls: [{ to: fixture.recipient, value: 1n }],
    },
    balance: {
      kind: 'native' as const,
      address: fixture.recipient,
      chainId: LEGACY_INTENT_SOURCE_CHAIN.id,
      expectedDelta: 1n,
    },
  }),
  'erc20-transfer': async (fixture) =>
    fixture.scenario.axes.operation.includes('sponsorship:unsponsored')
      ? {
          transaction: {
            chain: LEGACY_INTENT_SOURCE_CHAIN,
            sponsored: false,
            calls: [
              {
                to: getUsdcAddress(LEGACY_INTENT_SOURCE_CHAIN.id),
                value: 0n,
                data: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: 'transfer',
                  args: [fixture.recipient, 1n],
                }),
              },
            ],
          },
          balance: {
            kind: 'erc20' as const,
            address: fixture.recipient,
            chainId: LEGACY_INTENT_SOURCE_CHAIN.id,
            expectedDelta: 1n,
          },
        }
      : {
          transaction: {
            sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
            targetChain: LEGACY_INTENT_TARGET_CHAIN,
            sponsored: true,
            calls: [createNoopCall()],
            tokenRequests: [
              {
                address: getUsdcAddress(LEGACY_INTENT_TARGET_CHAIN.id),
                amount: 10_000n,
              },
            ],
          },
        },
  'symbol-request': async (fixture) => ({
    transaction: {
      sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
      targetChain: LEGACY_INTENT_TARGET_CHAIN,
      sponsored: true,
      calls: [],
      tokenRequests: [{ address: 'USDC', amount: 10_000n }],
    },
    balance: {
      kind: 'erc20' as const,
      address: fixture.account.getAddress(),
      chainId: LEGACY_INTENT_TARGET_CHAIN.id,
      expectedDelta: 10_000n,
    },
  }),
  'chain-token-request': async () => ({
    transaction: {
      sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
      targetChain: LEGACY_INTENT_TARGET_CHAIN,
      sponsored: true,
      calls: [],
      tokenRequests: [{ address: 'USDC', amount: 10_000n }],
      sourceAssets: [
        { chain: LEGACY_INTENT_SOURCE_CHAIN, address: 'USDC', amount: 10_000n },
      ],
    },
  }),
  'amount-omitted-request': async () => ({
    transaction: {
      sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
      targetChain: LEGACY_INTENT_TARGET_CHAIN,
      sponsored: true,
      calls: [],
      tokenRequests: [{ address: 'USDC' }],
    },
  }),
  'multiple-calls': async () => ({
    transaction: {
      chain: LEGACY_INTENT_SOURCE_CHAIN,
      sponsored: true,
      calls: [createNoopCall(), createNoopCall()],
    },
  }),
  'lazy-single-call': async () => ({
    transaction: {
      chain: LEGACY_INTENT_SOURCE_CHAIN,
      sponsored: true,
      calls: [{ resolve: async () => createNoopCall() }],
    },
  }),
  'lazy-multiple-calls': async (fixture) => ({
    transaction: fixture.scenario.axes.operation.includes('intent:cross-chain')
      ? {
          sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
          targetChain: LEGACY_INTENT_TARGET_CHAIN,
          sponsored: true,
          calls: [
            { resolve: async () => [createNoopCall(), createNoopCall()] },
          ],
        }
      : {
          chain: LEGACY_INTENT_SOURCE_CHAIN,
          sponsored: true,
          calls: [
            { resolve: async () => [createNoopCall(), createNoopCall()] },
          ],
        },
  }),
  'source-call-without-funds': async () => ({
    transaction: {
      sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
      targetChain: LEGACY_INTENT_TARGET_CHAIN,
      sponsored: true,
      calls: [],
      tokenRequests: [{ address: 'USDC', amount: 10_000n }],
      sourceCalls: { [LEGACY_INTENT_SOURCE_CHAIN.id]: [createNoopCall()] },
    },
  }),
  'source-call-with-funds': async (fixture) => {
    throw new LegacyIntentFixtureError(
      fixture.scenario.id,
      'no live source call that produces testnet USDC is configured',
    )
  },
  'alternate-recipient': async (fixture) => ({
    transaction: {
      sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
      targetChain: LEGACY_INTENT_TARGET_CHAIN,
      sponsored: true,
      calls: [],
      tokenRequests: [{ address: 'USDC', amount: 10_000n }],
      recipient: fixture.recipient,
    },
  }),
  'unsponsored-noop': async (fixture) => ({
    transaction: {
      chain: LEGACY_INTENT_SOURCE_CHAIN,
      sponsored: false,
      calls: [
        {
          to: getUsdcAddress(LEGACY_INTENT_SOURCE_CHAIN.id),
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [fixture.recipient, 1n],
          }),
        },
      ],
    },
    balance: {
      kind: 'erc20' as const,
      address: fixture.recipient,
      chainId: LEGACY_INTENT_SOURCE_CHAIN.id,
      expectedDelta: 1n,
    },
  }),
  'app-fee': async () => ({
    transaction: {
      sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
      targetChain: LEGACY_INTENT_TARGET_CHAIN,
      sponsored: true,
      calls: [],
      tokenRequests: [{ address: 'USDC', amount: 10_000n }],
      appFees: { feeBps: 25 },
    },
  }),
  'settlement-filter': async () => ({
    transaction: {
      sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
      targetChain: LEGACY_INTENT_TARGET_CHAIN,
      sponsored: true,
      calls: [],
      tokenRequests: [{ address: 'USDC', amount: 10_000n }],
      settlementLayers: { include: ['ACROSS'] },
    },
  }),
  'access-list': async () => ({
    transaction: {
      sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
      targetChain: LEGACY_INTENT_TARGET_CHAIN,
      sponsored: true,
      calls: [createNoopCall()],
      sourceAssets: { [LEGACY_INTENT_SOURCE_CHAIN.id]: ['USDC'] },
    },
  }),
  preclaim: async () => ({
    transaction: {
      sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
      targetChain: LEGACY_INTENT_TARGET_CHAIN,
      sponsored: true,
      calls: [createNoopCall()],
      tokenRequests: [{ address: 'USDC', amount: 10_000n }],
      sourceAssets: { [LEGACY_INTENT_SOURCE_CHAIN.id]: ['USDC'] },
      sourceCalls: { [LEGACY_INTENT_SOURCE_CHAIN.id]: [createNoopCall()] },
    },
  }),
  'send-convenience': async (fixture) => {
    throw new LegacyIntentFixtureError(
      fixture.scenario.id,
      'the release public facade has no intent convenience-send method',
    )
  },
  'enable-and-use-session': async (fixture) => ({
    transaction: await sessionTransaction(fixture, { enable: true }),
  }),
  'use-enabled-session': async (fixture) => ({
    transaction: await sessionTransaction(fixture),
  }),
  'claim-only-session': async (fixture) => ({
    transaction: await sessionTransaction(fixture),
  }),
  'disable-session': async (fixture) => ({
    transaction: {
      chain: fixture.sessions[0]?.chain ?? LEGACY_INTENT_SOURCE_CHAIN,
      sponsored: true,
      calls: [
        experimental_disableSession(
          fixture.sessions[0],
          new Date(Date.now() + 60 * 60_000),
        ),
      ],
    },
  }),
  'session-erc1271': async (fixture) => ({
    transaction: await sessionTransaction(fixture),
  }),
  'session-headless-sign': async (fixture) => ({
    transaction: {
      sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
      targetChain: hyperCoreMainnet,
      sponsored: true,
      recipient: fixture.recipient,
      signers: await buildSessionSigners(fixture, false),
    },
    signKind: 'headless' as const,
  }),
  'cross-chain-permit': async (fixture) => ({
    transaction: {
      ...(await sessionTransaction(fixture, { crossChain: true })),
      calls: [],
      tokenRequests: [{ address: 'USDC', amount: 10_000n }],
      recipient: fixture.scenario.axes.session.includes('recipient:override')
        ? fixture.recipient
        : undefined,
      ...(fixture.scenario.axes.session.includes('settlement:subset')
        ? { settlementLayers: { include: ['ECO' as const] } }
        : {}),
    },
  }),
  'invalid-policy': async (fixture) => ({
    transaction: await sessionTransaction(fixture),
  }),
  'tampered-signature': async (fixture) => ({
    transaction: await sessionTransaction(fixture, { enable: true }),
    tamperSigned: true,
  }),
  'tampered-prepared-payload': async () => {
    throw new LegacyIntentFixtureError(
      'tampered-prepared-payload',
      'offline quote vectors are owned by focused execution tests',
    )
  },
  'unsupported-route': async () => ({
    transaction: {
      sourceChains: [LEGACY_INTENT_SOURCE_CHAIN],
      targetChain: LEGACY_INTENT_TARGET_CHAIN,
      sponsored: true,
      calls: [createNoopCall()],
      tokenRequests: [{ address: UNSUPPORTED_TOKEN, amount: 1_000_000n }],
    },
  }),
  'unsupported-chain': async () => {
    throw new LegacyIntentFixtureError(
      'unsupported-chain',
      'offline registry vectors are owned by focused registry tests',
    )
  },
  'unsupported-token': async () => ({
    transaction: {
      chain: LEGACY_INTENT_SOURCE_CHAIN,
      sponsored: true,
      tokenRequests: [{ address: UNSUPPORTED_TOKEN, amount: 1n }],
    },
  }),
  'missing-authorization': async () => {
    throw new LegacyIntentFixtureError(
      'missing-authorization',
      'offline authorization rejection is owned by focused signing tests',
    )
  },
  'terminal-failure-fixture': async (fixture) => {
    throw new LegacyIntentFixtureError(
      fixture.scenario.id,
      'no stable live terminal-failure fixture is configured for the release lane',
    )
  },
  'server-failure-fixture': async (fixture) => ({
    transaction: sameChainTransaction(fixture),
  }),
} satisfies Record<IntentCaseId, CaseBuilder>

export { LEGACY_INTENT_CASE_HANDLERS }

export function buildLegacyIntentCasePlan(
  fixture: LegacyIntentFixture,
): Promise<LegacyIntentCasePlan> {
  return LEGACY_INTENT_CASE_HANDLERS[fixture.scenario.caseId](fixture)
}

export function observeLegacyAccount(fixture: LegacyIntentFixture) {
  const account = fixture.accountConfig.account
  const owners = fixture.accountConfig.owners
  return {
    address: fixture.account.getAddress(),
    account: account
      ? {
          type: account.type,
          ...('version' in account && account.version
            ? { version: account.version }
            : {}),
          ...('adapter' in account && account.adapter
            ? { adapter: account.adapter }
            : {}),
          ...('nonce' in account && account.nonce !== undefined
            ? { nonce: account.nonce }
            : {}),
          ...('salt' in account && account.salt ? { salt: account.salt } : {}),
          ...('factory' in account && account.factory
            ? { factory: account.factory }
            : {}),
        }
      : { type: 'nexus', version: 'default' },
    owners: owners
      ? {
          type: owners.type,
          threshold: owners.threshold ?? 1,
          count:
            owners.type === 'ens'
              ? owners.owners.length
              : owners.type === 'multi-factor'
                ? owners.validators.length
                : owners.accounts.length,
          ...('module' in owners && owners.module
            ? { module: owners.module }
            : {}),
        }
      : undefined,
    sessionsEnabled:
      fixture.accountConfig.experimental_sessions?.enabled ?? false,
    state:
      fixture.scenario.axes.account.find((axis) => axis.startsWith('state:')) ??
      'state:new',
    adopted: fixture.accountConfig.initData !== undefined,
  }
}

export function getLegacyUsdcAddress(chainId: number): Address {
  return getUsdcAddress(chainId)
}
