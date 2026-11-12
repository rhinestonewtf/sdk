import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LocalAccount } from 'viem'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { LoadedBuild, SdkRoot } from './builds'
import { type ParityConfig, PROD_ORCHESTRATOR_URL } from './config'
import { getFault } from './faults'
import { goldenFile } from './golden'
import { createRecordingFetch } from './recorder'
import { formatSummary, writeReport } from './report'
import { runParity, type ScenarioResult } from './runner'
import { defineScenario } from './scenario'

const TOKEN = '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d'
let quoteCount = 0

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
    expect(result.verdict).toBe('diff')
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
