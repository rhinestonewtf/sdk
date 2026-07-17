import type { Hex, TypedDataDefinition } from 'viem'
import { baseSepolia } from 'viem/chains'
import type {
  PreparedTransactionData,
  RhinestoneAccount,
  RhinestoneAccountConfig,
  Session,
} from '../../../src/index'
import { toSession } from '../../../src/modules/validators/smart-sessions'
import type { Quote, SignData } from '../../../src/orchestrator'
import { createFakeRpc } from '../../fakes/rpc'
import type { ScenarioHandlerKey } from '../catalog'
import { createDeterministicOwner } from '../identity'
import {
  createModeObservation,
  failedOutcome,
  type ObservationContext,
  successfulOutcome,
} from '../observe'
import { stableStringify } from '../serialization'
import type { DirectSigningCaseId, DirectSigningScenario } from '../types'
import { createSubjectSdk, type FixtureSubject } from './legacy-intent-fixtures'

export type LegacyDirectSigningContext = ObservationContext & {
  readonly identityNamespace: string
}

export const LEGACY_DIRECT_SIGNING_HANDLER_KEYS = [
  'direct-signing:eip7702-signing:eip7702-authorization',
  'direct-signing:eip7702-signing:typed-data',
  'direct-signing:independent-signing:independent-contribution',
  'direct-signing:kernel-signing:nested-typed-data',
  'direct-signing:nexus-signing:typed-data',
  'direct-signing:safe-signing:erc6492-verification',
  'direct-signing:safe-signing:plain-message',
  'direct-signing:session-signing:session-independent-rejection',
  'direct-signing:startale-signing:erc7739-verification',
] as const satisfies readonly Extract<
  ScenarioHandlerKey,
  `direct-signing:${string}`
>[]

type DirectSigningArtifact = {
  readonly kind: DirectSigningCaseId
  readonly value: unknown
  readonly rpcMethods: readonly string[]
}

export async function runLegacyDirectSigning(
  scenario: DirectSigningScenario,
  context: LegacyDirectSigningContext,
) {
  const deployed = scenario.axes.account.some((axis) =>
    ['state:deployed', 'state:adopted', 'state:eip7702'].includes(axis),
  )
  const rpc = await createFakeRpc({
    chainId: baseSepolia.id,
    code: deployed ? '0x6000' : '0x',
  })

  try {
    const { identityNamespace, ...observationContext } = context
    const owner = createDeterministicOwner(identityNamespace, 'owner-0')
    const secondaryOwner = createDeterministicOwner(
      identityNamespace,
      'owner-1',
    )
    const eoa = createDeterministicOwner(identityNamespace, 'eoa')
    const sessionOwner = createDeterministicOwner(
      identityNamespace,
      'session-owner',
    )
    const session = createSession(sessionOwner)
    const sdk = createSubjectSdk(context.subject as FixtureSubject, {
      apiKey: 'offline-characterization',
      provider: { type: 'custom', urls: { [baseSepolia.id]: rpc.url } },
    })
    const account = await sdk.createAccount(
      accountConfiguration(scenario, owner, secondaryOwner, eoa),
    )

    try {
      const value = await executeCase({
        scenario,
        account,
        owner,
        secondaryOwner,
        session,
      })
      return createModeObservation(
        observationContext,
        {
          mode: 'sign',
          sign: {
            account: { address: account.getAddress() },
            signing: { caseId: scenario.caseId },
            artifacts: {
              kind: scenario.caseId,
              value,
              rpcMethods: rpc.requests.map(({ method }) => method),
            } satisfies DirectSigningArtifact,
          },
        },
        successfulOutcome(),
      )
    } catch (error) {
      return createModeObservation(
        observationContext,
        {
          mode: 'sign',
          sign: {
            account: { address: account.getAddress() },
            signing: { caseId: scenario.caseId },
          },
        },
        failedOutcome(error, 'sign'),
      )
    }
  } finally {
    await rpc.close()
  }
}

function accountConfiguration(
  scenario: DirectSigningScenario,
  owner: ReturnType<typeof createDeterministicOwner>,
  secondaryOwner: ReturnType<typeof createDeterministicOwner>,
  eoa: ReturnType<typeof createDeterministicOwner>,
): RhinestoneAccountConfig {
  const common = {
    owners: { type: 'ecdsa' as const, accounts: [owner] },
  }
  switch (scenario.fixtureId) {
    case 'safe-signing':
      return { ...common, account: { type: 'safe' } }
    case 'nexus-signing':
      return { ...common, account: { type: 'nexus' } }
    case 'kernel-signing':
      return { ...common, account: { type: 'kernel' } }
    case 'startale-signing':
      return { ...common, account: { type: 'startale' } }
    case 'session-signing':
      return {
        ...common,
        account: { type: 'safe' },
        experimental_sessions: { enabled: true },
      }
    case 'eip7702-signing':
      return { ...common, account: { type: 'nexus' }, eoa }
    case 'independent-signing':
      return {
        account: { type: 'safe' },
        owners: {
          type: 'ecdsa',
          accounts: [owner, secondaryOwner],
          threshold: 2,
        },
      }
  }
}

async function executeCase({
  scenario,
  account,
  owner,
  secondaryOwner,
  session,
}: {
  scenario: DirectSigningScenario
  account: RhinestoneAccount
  owner: ReturnType<typeof createDeterministicOwner>
  secondaryOwner: ReturnType<typeof createDeterministicOwner>
  session: Session
}): Promise<unknown> {
  switch (scenario.caseId) {
    case 'plain-message':
    case 'erc1271-verification':
    case 'erc6492-verification':
      return account.signMessage(
        'SDK characterization message',
        baseSepolia,
        getSessionSigners(scenario, session),
      )
    case 'typed-data':
      return account.signTypedData(
        simpleTypedData(),
        baseSepolia,
        getSessionSigners(scenario, session),
      )
    case 'nested-typed-data':
      return account.signTypedData(nestedTypedData(), baseSepolia, undefined)
    case 'numeric-coercion':
      return account.signTypedData(
        numericCoercionTypedData(),
        baseSepolia,
        undefined,
      )
    case 'erc7739-verification':
      return account.signTypedData(simpleTypedData(), baseSepolia, undefined)
    case 'eip7702-init':
      return account.signEip7702InitData()
    case 'eip7702-authorization': {
      const initSignature = await account.signEip7702InitData()
      const authorizations = await account.signAuthorizations(
        makePrepared({ eip7702InitSignature: initSignature }),
      )
      return { initSignature, authorizations }
    }
    case 'independent-contribution': {
      const prepared = makePrepared()
      const full = await account.signTransaction(prepared)
      const first = await account.signTransaction(prepared, { owner })
      const second = await account.signTransaction(prepared, {
        owner: secondaryOwner,
      })
      const assembled = await account.assembleTransaction(prepared, [
        second,
        first,
      ])
      const assembledArtifact = signedTransactionArtifact(assembled)
      const fullArtifact = signedTransactionArtifact(full)
      return {
        first,
        second,
        assembled: assembledArtifact,
        matchesFull:
          stableStringify(assembledArtifact) === stableStringify(fullArtifact),
      }
    }
    case 'session-independent-rejection': {
      const prepared = makePrepared({
        signers: { type: 'experimental_session', session },
      })
      return account.signTransaction(prepared, { owner })
    }
  }
}

function getSessionSigners(scenario: DirectSigningScenario, session: Session) {
  return scenario.fixtureId === 'session-signing'
    ? ({ type: 'experimental_session', session } as const)
    : undefined
}

function createSession(
  owner: ReturnType<typeof createDeterministicOwner>,
): Session {
  return toSession({
    chain: baseSepolia,
    owners: { type: 'ecdsa', accounts: [owner] },
  })
}

function simpleTypedData(): TypedDataDefinition {
  return {
    domain: {
      name: 'SDK Characterization',
      version: '1',
      chainId: baseSepolia.id,
      verifyingContract: '0x0000000000000000000000000000000000000001',
    },
    types: { Message: [{ name: 'contents', type: 'string' }] },
    primaryType: 'Message',
    message: { contents: 'deterministic' },
  }
}

function nestedTypedData(): TypedDataDefinition {
  return {
    domain: {
      name: 'SDK Characterization',
      version: '1',
      chainId: baseSepolia.id,
      verifyingContract: '0x0000000000000000000000000000000000000001',
    },
    types: {
      Person: [
        { name: 'wallet', type: 'address' },
        { name: 'score', type: 'uint256' },
      ],
      Group: [
        { name: 'members', type: 'Person[]' },
        { name: 'weights', type: 'uint256[]' },
      ],
    },
    primaryType: 'Group',
    message: {
      members: [
        {
          wallet: '0x0000000000000000000000000000000000000002',
          score: 7n,
        },
      ],
      weights: [1n, 2n, 3n],
    },
  }
}

function numericCoercionTypedData(): TypedDataDefinition {
  return {
    ...simpleTypedData(),
    types: { Numeric: [{ name: 'value', type: 'uint256' }] },
    primaryType: 'Numeric',
    message: { value: '42' },
  }
}

function makePrepared(options?: {
  readonly eip7702InitSignature?: Hex
  readonly signers?: {
    readonly type: 'experimental_session'
    readonly session: Session
  }
}): PreparedTransactionData {
  const signData: SignData = {
    origin: [simpleTypedData()],
    destination: simpleTypedData(),
  }
  const quote = { intentId: 'characterization-intent', signData } as Quote
  return {
    quotes: { traceId: 'characterization-trace', best: quote, all: [quote] },
    intentInput: { characterization: true },
    transaction: {
      chain: baseSepolia,
      calls: [],
      ...(options?.eip7702InitSignature
        ? { eip7702InitSignature: options.eip7702InitSignature }
        : {}),
      ...(options?.signers ? { signers: options.signers } : {}),
    },
  }
}

function signedTransactionArtifact(
  signed: Awaited<ReturnType<RhinestoneAccount['assembleTransaction']>>,
) {
  return {
    intentId: signed.quote.intentId,
    originSignatures: signed.originSignatures,
    destinationSignature: signed.destinationSignature,
    targetExecutionSignature: signed.targetExecutionSignature,
  }
}
