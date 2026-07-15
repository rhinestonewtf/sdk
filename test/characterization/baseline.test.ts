import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  type BaselineEnvironmentIdentity,
  type BaselineScenarioResult,
  compareBaselineObservation,
  loadBaselineSet,
  writeBaselineSet,
} from './baseline'
import {
  characterizationScenarios,
  isExecutableCharacterizationScenario,
} from './catalog'
import type { CharacterizationObservation } from './observe'
import type { CharacterizationScenario } from './types'

const BASE_SHA = '49efb8b8d957b2eea2b24c11ac56d6c4d80478d6'
const ENVIRONMENT = {
  id: 'testnet-v2',
  attributes: {
    chains: ['84532', '421614'],
    contracts: 'production',
    orchestrator: 'production',
  },
} as const satisfies BaselineEnvironmentIdentity

const directories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('characterization baselines', () => {
  test('loads the committed dev calibration with valid digests', async () => {
    const loaded = await loadBaselineSet({
      directory: path.resolve('test/characterization/baselines'),
      baseSha: BASE_SHA,
      environment: {
        id: 'development',
        attributes: {
          sourceChainId: 84532,
          targetChainId: 421614,
          useDevContracts: true,
        },
      },
    })
    const executableCount = characterizationScenarios.filter(
      isExecutableCharacterizationScenario,
    ).length

    expect(loaded.scenarios.size).toBe(executableCount)
  })

  test('writes a full legacy calibration and loads only a selected subset', async () => {
    const directory = await temporaryDirectory()
    const catalog = [makeScenario('intents/a'), makeScenario('intents/b')]
    const verifyCommit = vi.fn(async () => BASE_SHA)
    const verifyEnvironment = vi.fn(async () => undefined)

    const manifest = await writeBaselineSet({
      directory,
      subject: 'legacy',
      updateRequested: true,
      baseSha: BASE_SHA,
      environment: ENVIRONMENT,
      catalog,
      scenarioResults: catalog.map((scenario, index) =>
        makeResult(scenario.id, `request-${index}`, `0xlegacy${index}`),
      ),
      verifyCommit,
      verifyEnvironment,
      now: () => new Date('2026-07-15T00:00:00.000Z'),
    })

    expect(verifyCommit).toHaveBeenCalledWith(BASE_SHA)
    expect(verifyEnvironment).toHaveBeenCalledWith(ENVIRONMENT)
    expect(manifest).toMatchObject({
      baseSha: BASE_SHA,
      catalogVersion: 1,
      normalizerVersion: 2,
      environment: ENVIRONMENT,
      generatedAt: '2026-07-15T00:00:00.000Z',
      secretScan: 'passed',
    })
    expect(manifest.scenarios).toHaveLength(2)

    const loaded = await loadBaselineSet({
      directory,
      baseSha: BASE_SHA,
      environment: ENVIRONMENT,
      scenarioIds: ['intents/b'],
    })

    expect([...loaded.scenarios.keys()]).toEqual(['intents/b'])
    const artifact = loaded.scenarios.get('intents/b')
    expect(artifact?.observation).toMatchObject({
      subject: 'legacy',
      sign: { account: { address: '0xlegacy1' } },
    })
    expect(artifact?.normalizedObservation).not.toHaveProperty('runId')
    expect(artifact?.normalizedObservation).toMatchObject({
      sign: {
        prepared: {
          requestId: { $characterizationNormalized: 'generated-id' },
        },
      },
    })
  })

  test('refuses implicit, non-legacy, unresolved, partial, and failed updates', async () => {
    const directory = await temporaryDirectory()
    const scenario = makeScenario('intents/a')
    const valid = {
      directory,
      subject: 'legacy' as const,
      updateRequested: true,
      baseSha: BASE_SHA,
      environment: ENVIRONMENT,
      catalog: [scenario],
      scenarioResults: [makeResult(scenario.id)],
      verifyCommit: async () => BASE_SHA,
    }

    await expect(
      writeBaselineSet({ ...valid, updateRequested: false }),
    ).rejects.toThrow('SDK_ITEST_UPDATE_BASELINE=1')
    await expect(
      writeBaselineSet({ ...valid, subject: 'rewrite' }),
    ).rejects.toThrow('only be written by legacy')
    await expect(
      writeBaselineSet({
        ...valid,
        verifyCommit: async () => 'f'.repeat(40),
      }),
    ).rejects.toThrow('expected exact commit')
    await expect(
      writeBaselineSet({ ...valid, scenarioResults: [] }),
    ).rejects.toThrow('full executable catalog')
    await expect(
      writeBaselineSet({
        ...valid,
        scenarioResults: [{ ...makeResult(scenario.id), status: 'failed' }],
      }),
    ).rejects.toThrow('Cannot calibrate failed scenario')
  })

  test('publishes no manifest when secret scanning or an exclusive lock fails', async () => {
    const directory = await temporaryDirectory()
    const scenario = makeScenario('intents/a')
    const options = {
      directory,
      subject: 'legacy' as const,
      updateRequested: true,
      baseSha: BASE_SHA,
      environment: ENVIRONMENT,
      catalog: [scenario],
      verifyCommit: async () => BASE_SHA,
      now: () => new Date('2026-07-15T00:00:00.000Z'),
    }

    await expect(
      writeBaselineSet({
        ...options,
        scenarioResults: [
          makeResult(scenario.id, 'request-a', '0xlegacy', {
            headers: { authorization: 'Bearer do-not-persist' },
          }),
        ],
      }),
    ).rejects.toThrow('auth-header')
    await expect(
      readFile(path.join(directory, 'manifest.json')),
    ).rejects.toThrow()

    await writeFile(path.join(directory, '.update.lock'), 'occupied')
    await expect(
      writeBaselineSet({
        ...options,
        scenarioResults: [makeResult(scenario.id)],
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' })
  })

  test('validates environment identity and artifact digests when loading', async () => {
    const directory = await temporaryDirectory()
    const scenario = makeScenario('intents/a')
    const manifest = await writeBaselineSet({
      directory,
      subject: 'legacy',
      updateRequested: true,
      baseSha: BASE_SHA,
      environment: ENVIRONMENT,
      catalog: [scenario],
      scenarioResults: [makeResult(scenario.id)],
      verifyCommit: async () => BASE_SHA,
    })

    await expect(
      loadBaselineSet({
        directory,
        baseSha: BASE_SHA,
        environment: {
          ...ENVIRONMENT,
          attributes: { ...ENVIRONMENT.attributes, contracts: 'development' },
        },
      }),
    ).rejects.toThrow('environment does not match')

    const entry = manifest.scenarios[0]
    if (!entry) throw new Error('test baseline entry missing')
    await writeFile(path.join(directory, entry.file), '{}\n')
    await expect(
      loadBaselineSet({
        directory,
        baseSha: BASE_SHA,
        environment: ENVIRONMENT,
      }),
    ).rejects.toThrow('digest mismatch')
  })

  test('compares normalized observations with structured identity evidence', async () => {
    const directory = await temporaryDirectory()
    const scenario = makeScenario('intents/isolated', 'isolated-state')
    await writeBaselineSet({
      directory,
      subject: 'legacy',
      updateRequested: true,
      baseSha: BASE_SHA,
      environment: ENVIRONMENT,
      catalog: [scenario],
      scenarioResults: [makeResult(scenario.id, 'legacy-request', '0xlegacy')],
      verifyCommit: async () => BASE_SHA,
    })
    const loaded = await loadBaselineSet({
      directory,
      baseSha: BASE_SHA,
      environment: ENVIRONMENT,
      scenarioIds: [scenario.id],
    })
    const baseline = loaded.scenarios.get(scenario.id)
    if (!baseline) throw new Error('test baseline missing')
    const mapping = {
      path: '/sign/account/address',
      identity: 'scenario-account',
      values: ['0xlegacy', '0xrewrite'],
      reason: 'execute subjects use isolated state',
    } as const

    const equal = compareBaselineObservation({
      baseline,
      scenario,
      actualObservation: makeObservation(
        scenario.id,
        'rewrite-request',
        '0xrewrite',
        'rewrite',
      ),
      identityMappings: [mapping],
    })
    expect(equal).toMatchObject({
      equal: true,
      deltas: [],
      baselineEvidence: {
        appliedIdentities: [{ original: '0xlegacy' }],
      },
      actualEvidence: {
        appliedIdentities: [{ original: '0xrewrite' }],
      },
    })

    const changed = compareBaselineObservation({
      baseline,
      scenario,
      actualObservation: {
        ...makeObservation(
          scenario.id,
          'rewrite-request',
          '0xrewrite',
          'rewrite',
        ),
        sign: {
          account: { address: '0xrewrite' },
          prepared: { requestId: 'rewrite-request', chainId: 10 },
        },
      },
      identityMappings: [mapping],
    })
    expect(changed).toMatchObject({
      equal: false,
      deltas: [
        {
          path: '/sign/prepared/chainId',
          kind: 'unexpected-actual',
          actual: 10,
        },
      ],
    })
  })
})

function makeScenario(
  id: string,
  comparison: CharacterizationScenario['comparison'] = 'shared-inputs',
): CharacterizationScenario {
  return {
    id,
    workflow: 'intent',
    mode: 'sign',
    fixtureId: 'safe-ecdsa',
    caseId: 'same-chain-noop',
    primaryCategory: 'intents',
    axes: {
      account: ['safe'],
      owner: ['ecdsa:single'],
      session: ['none'],
      operation: ['intent:same-chain'],
      infrastructure: ['auth:current'],
    },
    tags: [],
    support: { level: 'live' },
    expected: { kind: 'success' },
    setup: {
      identity: 'deterministic',
      preconditions: ['none'],
      funding: 'none',
      uniqueness: 'scenario-id',
      cleanup: 'none',
    },
    comparison,
    observations: ['prepared-payload'],
    normalization: ['request-id'],
    terminalAssertions: [],
    timeoutMs: 180_000,
  }
}

function makeResult(
  scenarioId: string,
  requestId = 'request-a',
  accountAddress = '0xlegacy',
  extraPrepared: Record<string, unknown> = {},
): BaselineScenarioResult {
  return {
    scenarioId,
    status: 'passed',
    observation: makeObservation(
      scenarioId,
      requestId,
      accountAddress,
      'legacy',
      extraPrepared,
    ),
  }
}

function makeObservation(
  scenarioId: string,
  requestId: string,
  accountAddress: string,
  subject: 'legacy' | 'rewrite',
  extraPrepared: Record<string, unknown> = {},
): CharacterizationObservation {
  return {
    schemaVersion: 1,
    scenarioId,
    workflow: 'intent',
    subject,
    runId: `${subject}-run`,
    comparisonGroup: 'comparison-group',
    mode: 'sign',
    sign: {
      account: { address: accountAddress },
      prepared: { requestId, ...extraPrepared },
    },
    outcome: { status: 'success' },
  }
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sdk-baseline-'))
  directories.push(directory)
  return directory
}
