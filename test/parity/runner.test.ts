import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LocalAccount } from 'viem'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { LoadedBuild, SdkRoot } from './builds'
import { type ParityConfig, PROD_ORCHESTRATOR_URL } from './config'
import { getFault } from './faults'
import type { FundedEnv } from './funded/lifecycle'
import { goldenFile } from './golden'
import { createRecordingFetch } from './recorder'
import { formatSummary, writeReport } from './report'
import { runParity, type ScenarioResult } from './runner'
import { defineScenario, type Scenario } from './scenario'

const TOKEN = '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d'
let quoteCount = 0
let submitCount = 0
let rejectSubmits = false

// A stub orchestrator: every quote gets a fresh nonce and a slightly
// different price, like the real one.
async function stubOrchestrator(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input.toString())
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'x-trace-id': `t${quoteCount}` },
    })
  if (url.pathname === '/intents/route') {
    const body = JSON.parse(init?.body as string)
    if (!body.options.auxiliaryFunds) {
      return json(422, {
        errors: [
          {
            message: 'No balances available',
            context: { code: 'ZERO_BALANCE' },
          },
        ],
      })
    }
    quoteCount++
    return json(200, {
      intentOp: {
        nonce: String(1000 + quoteCount),
        expires: String(quoteCount),
      },
      intentCost: {
        tokensSpent: {
          84532: {
            [TOKEN]: { locked: '0', unlocked: String(200000 + quoteCount) },
          },
        },
        tokensReceived: [{ tokenAddress: TOKEN, destinationAmount: '100000' }],
        feeBreakdownUSD: { gasFeeUSD: 0.02, totalFeeUSD: 0.02 },
      },
    })
  }
  if (url.pathname === '/intent-operations') {
    submitCount++
    if (rejectSubmits) {
      return json(400, { errors: [{ message: 'Simulation failed' }] })
    }
    return json(201, { result: { id: String(submitCount), status: 'PENDING' } })
  }
  return json(404, { errors: [{ message: 'not found', context: {} }] })
}

function fakeRoot(options: { dropAuxiliaryFunds?: boolean }): SdkRoot {
  class RhinestoneSDK {
    constructor(private readonly config: { apiKey: string }) {}
    async createAccount(accountConfig: {
      owners: { accounts: LocalAccount[] }
    }) {
      const headers = {
        'x-api-key': this.config.apiKey,
        'x-api-version': '2026-01.alps',
      }
      const owner = accountConfig.owners.accounts[0]
      return {
        getAddress: () => owner.address,
        async prepareTransaction(transaction: { auxiliaryFunds?: unknown }) {
          const response = await fetch(
            `${PROD_ORCHESTRATOR_URL}/intents/route`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify(
                {
                  destinationChainId: 421614,
                  tokenRequests: [{ tokenAddress: TOKEN, amount: '100000' }],
                  account: {
                    address: owner.address,
                    accountType: 'ERC7579',
                    setupOps: [],
                  },
                  destinationExecutions: [],
                  options: options.dropAuxiliaryFunds
                    ? {}
                    : { auxiliaryFunds: transaction.auxiliaryFunds },
                },
                (_key, value) =>
                  typeof value === 'bigint' ? value.toString() : value,
              ),
            },
          )
          if (!response.ok) throw new Error(`quote failed: ${response.status}`)
          return { intentRoute: await response.json(), transaction }
        },
        getTransactionMessages: () => ({ origin: [], destination: {} }),
        async signTransaction(prepared: {
          intentRoute: { intentOp: { nonce: string } }
        }) {
          const signature = await owner.signTypedData({
            domain: { chainId: 84532 },
            types: { Op: [{ name: 'nonce', type: 'uint256' }] },
            primaryType: 'Op',
            message: { nonce: BigInt(prepared.intentRoute.intentOp.nonce) },
          })
          return {
            prepared,
            originSignatures: [signature],
            destinationSignature: signature,
          }
        },
        async submitTransaction(signed: {
          originSignatures: string[]
          destinationSignature: string
        }) {
          const response = await fetch(
            `${PROD_ORCHESTRATOR_URL}/intent-operations`,
            {
              method: 'POST',
              headers: { 'x-api-key': headers['x-api-key'] },
              body: JSON.stringify({
                signedIntentOp: {
                  nonce: '1',
                  originSignatures: signed.originSignatures,
                  destinationSignature: signed.destinationSignature,
                },
              }),
            },
          )
          const { result } = await response.json()
          return { type: 'intent', id: BigInt(result.id) }
        },
        waitForExecution: async () => ({}),
        getPortfolio: async () => [],
      }
    }
    getIntentStatus = async () => ({})
    splitIntents = async () => ({})
    getAppFeeBalances = async () => ({})
  }
  return { RhinestoneSDK, getTokenAddress: () => TOKEN } as unknown as SdkRoot
}

function loader(candidate: { dropAuxiliaryFunds?: boolean }) {
  return async (id: LoadedBuild['id']): Promise<LoadedBuild> => ({
    id,
    label: id,
    version: '0.0.0',
    root: fakeRoot(id === 'working-tree' ? candidate : {}),
    orchestrator: {
      getOrchestrator: () => {
        throw new Error('not used')
      },
    },
  })
}

const scenario = defineScenario({
  id: 'test/quote-sign-submit',
  description: 'fake quote, sign and captured submit',
  goldenLayers: [
    'quoteRequest',
    'typedData',
    'signatures',
    'submitRequest',
    'traffic',
  ],
  async run(ctx) {
    const account = await ctx.sdk().createAccount({
      owners: { type: 'ecdsa', accounts: [ctx.signer('ownerA')] },
    })
    const prepared = await ctx.step('prepare', 'prepare', () =>
      account.prepareTransaction({
        auxiliaryFunds: { 84532: { [TOKEN]: 5_000_000n } },
      }),
    )
    const signed = await ctx.step('sign', 'sign', () =>
      account.signTransaction(prepared),
    )
    await ctx.step('submit', 'submit', () => account.submitTransaction(signed))
  },
})

function layerDiffs(result: ScenarioResult) {
  return Object.values(result.layers).flatMap((layer) => layer.diffs)
}

let goldenDir: string
let originalFetch: typeof fetch

function config(overrides: Partial<ParityConfig> = {}): ParityConfig {
  return {
    apiKey: 'secret-api-key',
    env: 'prod',
    endpointUrl: undefined,
    baseline: 'published',
    candidate: 'working-tree',
    repeat: 1,
    fault: undefined,
    updateGoldens: false,
    funded: true,
    settleTimeoutMs: 1000,
    ...overrides,
  }
}

beforeAll(() => {
  goldenDir = mkdtempSync(join(tmpdir(), 'parity-'))
  originalFetch = globalThis.fetch
  globalThis.fetch = createRecordingFetch(stubOrchestrator as typeof fetch)
})

afterAll(() => {
  globalThis.fetch = originalFetch
  rmSync(goldenDir, { recursive: true, force: true })
})

describe('runParity', () => {
  test('a missing golden fails until it is written', async () => {
    const [missing] = await runParity(scenario, {
      config: config(),
      loadBuild: loader({}),
      goldenDir,
    })
    expect(missing.golden).toEqual({ status: 'missing' })
    expect(missing.verdict).toBe('diff')

    const [updated] = await runParity(scenario, {
      config: config({ updateGoldens: true }),
      loadBuild: loader({}),
      goldenDir,
    })
    expect(updated.golden.status).toBe('updated')
    const golden = readFileSync(goldenFile(scenario.id, goldenDir), 'utf8')
    expect(golden).toContain('<sig:Op@84532#0>')
    expect(golden).not.toContain('secret-api-key')
  })

  test('identical builds match across repeats despite per-quote variance', async () => {
    const results = await runParity(scenario, {
      config: config({ repeat: 2 }),
      loadBuild: loader({}),
      goldenDir,
    })
    expect(results.map((result) => result.verdict)).toEqual(['match', 'match'])
    expect(
      results[0].raw.candidate.http.find((r) => r.op === 'submit')?.captured,
    ).toBe(true)
    expect(results[0].baseline.apiVersions).toEqual([
      '2026-01.alps',
      'alps (no header)',
    ])
  })

  test('a dropped option in the candidate is a quoteRequest diff', async () => {
    const [result] = await runParity(scenario, {
      config: config(),
      loadBuild: loader({ dropAuxiliaryFunds: true }),
      goldenDir,
    })
    expect(result.verdict).toBe('diff')
    expect(result.layers.quoteRequest.diffs).toMatchObject([
      { path: '/prepare/options/auxiliaryFunds', kind: 'missing' },
    ])
    expect(result.layers.errors.diffs).toMatchObject([
      { path: '/prepare', kind: 'extra' },
    ])
    expect(formatSummary([result])).toContain(
      '/prepare/options/auxiliaryFunds [missing]',
    )
  })

  test('the built-in fault is reported on the candidate only', async () => {
    const [result] = await runParity(scenario, {
      config: config({ fault: getFault('quote.bump-token-amount') }),
      loadBuild: loader({}),
      goldenDir,
    })
    expect(result.layers.quoteRequest.diffs).toMatchObject([
      { path: '/prepare/tokenRequests/0/amount', a: '100000', b: '100001' },
    ])
    expect(result.golden.status).toBe('match')
  })

  test('golden drift is reported separately from parity diffs', async () => {
    const file = goldenFile(scenario.id, goldenDir)
    const golden = JSON.parse(readFileSync(file, 'utf8'))
    golden.traffic[0].ops = ['status']
    writeFileSync(file, JSON.stringify(golden))
    const [result] = await runParity(scenario, {
      config: config(),
      loadBuild: loader({}),
      goldenDir,
    })
    expect(result.verdict).toBe('diff')
    expect(result.layers.traffic).toMatchObject({ status: 'drift', diffs: [] })
    expect(formatSummary([result])).toContain('golden drift')
  })

  test('waiting for execution in capture mode is a harness error', async () => {
    const waiting = defineScenario({
      ...scenario,
      id: 'test/capture-wait',
      goldenLayers: [],
      async run(ctx) {
        await scenario.run(ctx)
        await ctx.step('wait', 'wait', () => ({}))
      },
    })
    const [result] = await runParity(waiting, {
      config: config({ updateGoldens: true }),
      loadBuild: loader({}),
      goldenDir,
    })
    expect(layerDiffs(result)).toEqual([])
    expect(result.verdict).toBe('error')
    expect(result.error?.kind).toBe('harness')
    expect(result.harnessErrors).toEqual([
      {
        role: 'baseline',
        step: 'wait',
        message: 'Step "wait" waits for execution, but submits are captured',
      },
      {
        role: 'candidate',
        step: 'wait',
        message: 'Step "wait" waits for execution, but submits are captured',
      },
    ])
    expect(
      result.raw.candidate.http.find((r) => r.op === 'submit')?.captured,
    ).toBe(true)
    expect(formatSummary([result])).toContain('harness errors')
  })

  test('the report contains no credential', async () => {
    const results = await runParity(scenario, {
      config: config(),
      loadBuild: loader({}),
      goldenDir,
    })
    const file = writeReport(join(goldenDir, 'report'), results)
    expect(readFileSync(file, 'utf8')).not.toContain('secret-api-key')
  })
})

// A funded variant: live submits, and the lifecycle reads faked.
function fundedScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    ...defineScenario({
      ...scenario,
      id: 'test/funded',
      funded: true,
      submitMode: 'live',
      fixtures: [
        { fixture: 'nexus-main', chainId: 84532, token: 'USDC', perSide: 10n },
      ],
      async run(ctx) {
        await scenario.run(ctx)
        await ctx.step('wait', 'wait', () => ({ fill: { hash: '0x01' } }))
      },
    }),
    ...overrides,
  }
}

function fakeEnv(options: {
  balance?: bigint
  steady?: string[][]
  status?: (intentId: string) => string
}) {
  const steady = [...(options.steady ?? [])]
  const calls = { steady: 0, statuses: [] as string[] }
  const env: FundedEnv = {
    async balances(uses, sides) {
      return uses.map((use) => ({
        fixture: use.fixture,
        address: '0x0000000000000000000000000000000000000001',
        chainId: use.chainId,
        token: use.token,
        required: use.perSide * BigInt(sides),
        balance: options.balance ?? 1000n,
      }))
    },
    async steady() {
      calls.steady += 1
      return steady.shift() ?? []
    },
    async intentStatus(intentId) {
      calls.statuses.push(intentId)
      return options.status?.(intentId) ?? 'COMPLETED'
    },
    async sdk() {
      throw new Error('unused')
    },
    settleIntervalMs: 1,
  }
  return { env, calls }
}

describe('runParity, funded', () => {
  test('both intents completing is a match, with execution records', async () => {
    const { env } = fakeEnv({})
    const [result] = await runParity(fundedScenario(), {
      config: config({ updateGoldens: true }),
      loadBuild: loader({}),
      goldenDir,
      funded: env,
    })
    expect(result.error).toBeUndefined()
    expect(result.verdict).toBe('match')
    expect(
      result.execution?.map((record) => [record.role, record.status]),
    ).toEqual([
      ['baseline', 'COMPLETED'],
      ['candidate', 'COMPLETED'],
    ])
    expect(
      result.raw.candidate.http.find((r) => r.op === 'submit')?.captured,
    ).toBe(false)
    expect(result.funded?.fixtures[0]).toMatchObject({
      balance: '1000',
      required: '20',
    })
  })

  test('a failure on both sides is an execution error, not a match', async () => {
    const { env } = fakeEnv({ status: () => 'FAILED' })
    const results = await runParity(fundedScenario(), {
      config: config({ repeat: 2 }),
      loadBuild: loader({}),
      goldenDir,
      funded: env,
    })
    expect(results).toHaveLength(1)
    expect(results[0].verdict).toBe('error')
    expect(results[0].error?.kind).toBe('execution')
    expect(formatSummary(results)).toContain('error (execution)')
  })

  test('a refused submit is an execution error', async () => {
    rejectSubmits = true
    try {
      const { env } = fakeEnv({})
      const [result] = await runParity(fundedScenario(), {
        config: config(),
        loadBuild: loader({}),
        goldenDir,
        funded: env,
      })
      expect(result.error?.kind).toBe('execution')
      expect(result.execution?.map((record) => record.status)).toEqual([
        'REJECTED',
        'REJECTED',
      ])
    } finally {
      rejectSubmits = false
    }
  })

  test('a scenario expecting a refusal passes only when nothing completes', async () => {
    rejectSubmits = true
    try {
      const { env } = fakeEnv({})
      const [refused] = await runParity(
        fundedScenario({ execution: 'reject' }),
        { config: config(), loadBuild: loader({}), goldenDir, funded: env },
      )
      expect(refused.error).toBeUndefined()
    } finally {
      rejectSubmits = false
    }
    const { env } = fakeEnv({})
    const [completed] = await runParity(
      fundedScenario({ execution: 'reject' }),
      {
        config: config(),
        loadBuild: loader({}),
        goldenDir,
        funded: env,
      },
    )
    expect(completed.error?.kind).toBe('execution')
  })

  test('an unsettled baseline skips the candidate and later iterations', async () => {
    const { env } = fakeEnv({ status: () => 'PENDING' })
    const results = await runParity(fundedScenario(), {
      config: config({ repeat: 3, settleTimeoutMs: 5 }),
      loadBuild: loader({}),
      goldenDir,
      funded: env,
    })
    expect(results).toHaveLength(1)
    expect(results[0].skippedSides).toEqual(['candidate'])
    expect(results[0].raw.candidate.http).toEqual([])
    expect(results[0].error?.message).toContain('candidate skipped')
  })

  test('a funding shortfall stops before any side runs', async () => {
    const { env } = fakeEnv({ balance: 5n })
    const before = submitCount
    const results = await runParity(fundedScenario(), {
      config: config({ repeat: 3 }),
      loadBuild: loader({}),
      goldenDir,
      funded: env,
    })
    expect(results).toHaveLength(1)
    expect(results[0].error?.kind).toBe('funding')
    expect(results[0].error?.message).toContain('Fixtures cannot cover 6 sides')
    expect(results[0].funded?.topUps).toEqual([
      'chain=base-sepolia token=USDC amount=0.01 recipient=0x0000000000000000000000000000000000000001',
    ])
    expect(submitCount).toBe(before)
  })

  test('a warm-up runs only when the fixture is not steady, and is never compared', async () => {
    const steady = fakeEnv({ steady: [[]] })
    const [settled] = await runParity(fundedScenario(), {
      config: config(),
      loadBuild: loader({}),
      goldenDir,
      funded: steady.env,
    })
    expect(settled.funded?.warmUp).toBeUndefined()
    expect(steady.calls.statuses).toHaveLength(2)

    const unsteady = fakeEnv({ steady: [['not deployed'], []] })
    const [warmed] = await runParity(fundedScenario(), {
      config: config(),
      loadBuild: loader({}),
      goldenDir,
      funded: unsteady.env,
    })
    expect(warmed.verdict).toBe('match')
    expect(warmed.funded?.warmUp).toMatchObject({
      reasons: ['not deployed'],
      remaining: [],
    })
    expect(warmed.funded?.warmUp?.execution.map((r) => r.role)).toEqual([
      'warmup',
    ])
    // Three submits settled: the warm-up's and one per side.
    expect(unsteady.calls.statuses).toHaveLength(3)
    expect(
      warmed.raw.baseline.http.filter((r) => r.op === 'submit'),
    ).toHaveLength(1)

    const stuck = fakeEnv({ steady: [['not deployed'], ['not deployed']] })
    const [failed] = await runParity(fundedScenario(), {
      config: config(),
      loadBuild: loader({}),
      goldenDir,
      funded: stuck.env,
    })
    expect(failed.error?.kind).toBe('fixture')
    expect(failed.skippedSides).toEqual(['baseline', 'candidate'])
  })

  test('funded scenarios refuse to run against dev', async () => {
    const { env } = fakeEnv({})
    const [result] = await runParity(fundedScenario(), {
      config: config({ env: 'dev' }),
      loadBuild: loader({}),
      goldenDir,
      funded: env,
    })
    expect(result.error).toEqual({
      kind: 'harness',
      message: 'Funded scenarios run only against prod',
    })
  })
})
