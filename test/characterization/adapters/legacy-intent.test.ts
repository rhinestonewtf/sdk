import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
} from 'node:crypto'
import { concat, hexToBytes } from 'viem'
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest'
import {
  characterizationScenarios,
  EXECUTABLE_CHARACTERIZATION_HANDLER_KEYS,
  getScenarioHandlerKey,
  isExecutableCharacterizationScenario,
} from '../catalog'
import {
  INTENT_CASE_IDS,
  INTENT_FIXTURE_IDS,
  type IntentScenario,
} from '../types'
import {
  assertLegacyIntentHandlerCoverage,
  LEGACY_INTENT_HANDLER_KEYS,
  runLegacyIntentScenario,
} from './legacy-intent'
import {
  createLegacyDeterministicPasskey,
  LEGACY_INTENT_CASE_HANDLERS,
  LEGACY_INTENT_FIXTURE_HANDLERS,
  LEGACY_INTENT_SOURCE_CHAIN,
} from './legacy-intent-fixtures'

const fixtureMocks = vi.hoisted(() => ({
  buildFixture: vi.fn(),
  buildCasePlan: vi.fn(),
}))

vi.mock('./legacy-intent-fixtures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./legacy-intent-fixtures')>()),
  buildLegacyIntentFixture: fixtureMocks.buildFixture,
  buildLegacyIntentCasePlan: fixtureMocks.buildCasePlan,
}))

const executableIntents = characterizationScenarios.filter(
  (scenario): scenario is IntentScenario =>
    scenario.workflow === 'intent' &&
    isExecutableCharacterizationScenario(scenario),
)

function executableIntent(id: string): IntentScenario {
  const scenario = executableIntents.find((candidate) => candidate.id === id)
  if (!scenario) throw new Error(`Missing executable intent scenario ${id}`)
  return scenario
}

class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN'
  readonly status = 403
}

class UnprocessableContentError extends Error {
  readonly code = 'UNPROCESSABLE_CONTENT'
  readonly status = 422
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('legacy intent characterization adapter', () => {
  test('accepts only unchanged legacy and public facade subjects', () => {
    type Subject = NonNullable<
      Parameters<typeof runLegacyIntentScenario>[0]['subject']
    >
    expectTypeOf<Subject>().toEqualTypeOf<'legacy' | 'public'>()
  })

  test('has fixture and case handlers for every executable intent scenario', () => {
    expect(() =>
      assertLegacyIntentHandlerCoverage(executableIntents),
    ).not.toThrow()
    expect([...LEGACY_INTENT_HANDLER_KEYS].sort()).toEqual(
      [...new Set(executableIntents.map(getScenarioHandlerKey))].sort(),
    )
    expect([...LEGACY_INTENT_HANDLER_KEYS].sort()).toEqual(
      EXECUTABLE_CHARACTERIZATION_HANDLER_KEYS.filter((key) =>
        key.startsWith('intent:'),
      ).sort(),
    )
  })

  test('preserves setup error identity instead of wrapping it', async () => {
    const error = new ForbiddenError('Insufficient permissions')
    fixtureMocks.buildFixture.mockRejectedValueOnce(error)

    const observation = await runLegacyIntentScenario({
      scenario: executableIntent('intents/multiple-destination-calls'),
      baseSha: 'a'.repeat(40),
      runId: 'error-semantics',
    })

    expect(observation.outcome).toEqual({
      status: 'failure',
      error: {
        phase: 'construction',
        class: 'ForbiddenError',
        name: 'Error',
        message: 'Insufficient permissions',
        code: 'FORBIDDEN',
        status: 403,
      },
    })
  })

  test('preserves an expected failure when its message mismatches the catalog', async () => {
    const scenario = executableIntent('failures/unsupported-route-token')
    const error = new UnprocessableContentError(
      'Token is not a valid ERC-20 or is not supported',
    )
    fixtureMocks.buildFixture.mockResolvedValueOnce({
      scenario,
      identityNamespace: 'error-semantics',
      invocations: [],
      sdk: {},
      account: {
        getAddress: () => '0x1111111111111111111111111111111111111111',
        prepareTransaction: async () => {
          throw error
        },
      },
      accountConfig: { account: { type: 'nexus' } },
      ownerAccounts: [],
      sessions: [],
      recipient: '0x2222222222222222222222222222222222222222',
    })
    fixtureMocks.buildCasePlan.mockResolvedValueOnce({
      transaction: {
        chain: LEGACY_INTENT_SOURCE_CHAIN,
        sponsored: true,
        calls: [],
      },
    })

    const observation = await runLegacyIntentScenario({
      scenario,
      baseSha: 'a'.repeat(40),
      runId: 'error-semantics',
    })

    expect(observation.outcome).toEqual({
      status: 'failure',
      error: {
        phase: 'prepare',
        class: 'UnprocessableContentError',
        name: 'Error',
        message: 'Token is not a valid ERC-20 or is not supported',
        code: 'UNPROCESSABLE_CONTENT',
        status: 422,
      },
    })
  })

  test('keeps the fixture registry exhaustive as the vocabulary changes', () => {
    expect(Object.keys(LEGACY_INTENT_FIXTURE_HANDLERS).sort()).toEqual(
      [...INTENT_FIXTURE_IDS].sort(),
    )
  })

  test('keeps the case registry exhaustive as the vocabulary changes', () => {
    expect(Object.keys(LEGACY_INTENT_CASE_HANDLERS).sort()).toEqual(
      [...INTENT_CASE_IDS].sort(),
    )
  })

  test('creates reproducible cryptographically valid P-256 signatures', async () => {
    const first = createLegacyDeterministicPasskey('namespace', 'passkey')
    const second = createLegacyDeterministicPasskey('namespace', 'passkey')
    const hash = `0x${'42'.repeat(32)}` as const
    const result = await first.sign({ hash })
    const repeated = await second.sign({ hash })

    expect(first.publicKey).toBe(second.publicKey)
    expect(result.signature).toBe(repeated.signature)
    expect(JSON.parse(result.webauthn.clientDataJSON).challenge).toBe(
      Buffer.from(hexToBytes(hash)).toString('base64url'),
    )

    const publicKey = hexToBytes(first.publicKey)
    const key = createPublicKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: Buffer.from(publicKey.slice(0, 32)).toString('base64url'),
        y: Buffer.from(publicKey.slice(32, 64)).toString('base64url'),
      },
    })
    const clientHash = createHash('sha256')
      .update(result.webauthn.clientDataJSON)
      .digest('hex')
    const payload = concat([
      result.webauthn.authenticatorData,
      `0x${clientHash}`,
    ])
    expect(
      cryptoVerify(
        'sha256',
        hexToBytes(payload),
        {
          key,
          dsaEncoding: 'ieee-p1363',
        },
        hexToBytes(result.signature),
      ),
    ).toBe(true)
  })
})
