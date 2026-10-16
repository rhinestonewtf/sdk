import type { Connection } from '@solana/web3.js'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { solanaDevnet } from '../../../../src/solana/index'
import { emptyCost } from '../../../utils/caucasus'
import { createSolanaFixture } from './fixture'
import { DEVNET_GENESIS } from './rpc'

// No SDK or facade mocks: invocation-time composition must capture this port.
async function setup(
  options: {
    onEvidence?: Parameters<
      typeof createSolanaFixture
    >[0]['onDeploymentEvidence']
    quoteGate?: () => Promise<void>
  } = {},
) {
  let deployed = false
  const events: string[] = []
  const network = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.endsWith('/quotes')) {
        events.push('quote')
        const { account } = JSON.parse(String(init?.body))
        const svm = account.svm
        await options.quoteGate?.()
        if (deployed)
          return Response.json(
            {
              code: 'UNPROCESSABLE_CONTENT',
              message: 'exists',
              traceId: 'trace',
              details: [
                {
                  message: 'exists',
                  context: {
                    code: 'ACCOUNT_ALREADY_DEPLOYED',
                    destinationChainId: solanaDevnet.caip2,
                    swig: svm.swigAccount,
                    wallet: svm.address,
                  },
                },
              ],
            },
            { status: 422 },
          )
        const leg = {
          vm: 'svm',
          chainId: solanaDevnet.caip2,
          account: {
            wallet: svm.address,
            swigAccount: svm.swigAccount,
            authority: svm.authorization,
          },
        }
        return Response.json({
          status: 'quoted',
          routes: [
            {
              intentId: 'deployment',
              purpose: 'deployment',
              expiresAt: 4_000_000_000,
              estimatedFillTime: { seconds: 2 },
              settlementLayer: 'SAME_CHAIN',
              plan: { source: [], destination: leg, deployments: [leg] },
              cost: emptyCost(),
              deploymentCosts: [
                {
                  vm: 'svm',
                  chainId: solanaDevnet.caip2,
                  rent: { amount: '1869440', usd: 0.3, sponsored: true },
                },
              ],
              requirements: [],
              signingRequests: [],
            },
          ],
        })
      }
      if (url.endsWith('/intents')) {
        events.push('submit')
        deployed = true
        return Response.json({ intentId: 'deployment' }, { status: 201 })
      }
      if (url.endsWith('/intents/deployment')) {
        events.push('status')
        return Response.json({
          intentId: 'deployment',
          purpose: 'deployment',
          status: 'COMPLETED',
          operations: [],
        })
      }
      throw new Error('Unexpected fake-network request')
    },
  )
  const fixture = await createSolanaFixture({
    sdkConfig: {
      auth: { mode: 'apiKey', apiKey: 'fake-test-key' },
      useDevContracts: true,
      endpointUrl: 'https://dev.v1.orchestrator.rhinestone.dev',
    },
    connection: {
      getGenesisHash: async () => DEVNET_GENESIS,
    } as unknown as Connection,
    evmClient: { getChainId: async () => 84532 },
    fetcher: network as unknown as typeof fetch,
    onDeploymentEvidence: options.onEvidence,
  })
  return { fixture, network, events }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('fixture invocation transport (real composite SDK)', () => {
  test('observes quotes and persists evidence before submission; idempotency does not resubmit', async () => {
    const outside = vi.fn(async () => {
      throw new Error('Unscoped transport')
    })
    vi.stubGlobal('fetch', outside)
    const persisted: unknown[] = []
    const { fixture, events } = await setup({
      onEvidence: async (evidence) => {
        await Promise.resolve()
        if (evidence.submissions) expect(events).toEqual(['quote'])
        persisted.push(evidence)
      },
    })
    expect(globalThis.fetch).toBe(outside)
    await fixture.withRequests(async () => {
      await Promise.resolve()
      await fixture.withRequests(() =>
        fixture.account.deploy('solana', solanaDevnet),
      )
    })
    expect(globalThis.fetch).toBe(outside)
    expect(events).toEqual(['quote', 'submit', 'status'])
    expect(fixture.deploymentEvidence).toEqual([
      { intentId: 'deployment', quotedAmounts: ['1869440'], submissions: 1 },
    ])
    expect(persisted).toEqual([
      { intentId: 'deployment', quotedAmounts: ['1869440'], submissions: 0 },
      { intentId: 'deployment', quotedAmounts: ['1869440'], submissions: 1 },
    ])
    const snapshot = structuredClone(fixture.deploymentEvidence)
    await fixture.withRequests(() =>
      fixture.account.deploy('solana', solanaDevnet),
    )
    expect(events).toEqual(['quote', 'submit', 'status', 'quote'])
    expect(fixture.deploymentEvidence).toEqual(snapshot)
    expect(globalThis.fetch).toBe(outside)
    expect(outside).not.toHaveBeenCalled()
  })

  test('persistence failure restores fetch and prevents submission', async () => {
    const previous = globalThis.fetch
    const { fixture, events } = await setup({
      onEvidence: async (evidence) => {
        if (evidence.submissions) throw new Error('Persistence unavailable')
      },
    })
    await expect(
      fixture.withRequests(() =>
        fixture.account.deploy('solana', solanaDevnet),
      ),
    ).rejects.toThrow('Persistence unavailable')
    expect(events).toEqual(['quote'])
    expect(globalThis.fetch).toBe(previous)
    await expect(fixture.withRequests(async () => {})).rejects.toThrow(
      'revoked',
    )
  })

  test.each(['quote', 'persistence'])(
    'timeout during %s restores fetch and revokes late submission',
    async (stage) => {
      const previous = globalThis.fetch
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let entered!: () => void
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const pause = async () => {
        entered()
        await gate
      }
      const { fixture, events, network } = await setup({
        quoteGate: stage === 'quote' ? pause : undefined,
        onEvidence:
          stage === 'persistence'
            ? async (evidence) => {
                if (evidence.submissions) await pause()
              }
            : undefined,
      })
      vi.useFakeTimers()
      let deployment!: Promise<boolean>
      const run = fixture.withRequests(() => {
        deployment = fixture.account.deploy('solana', solanaDevnet)
        return deployment
      }, 100)
      const rejected = expect(run).rejects.toThrow('timeout')
      await started
      await vi.advanceTimersByTimeAsync(101)
      await rejected
      expect(globalThis.fetch).toBe(previous)
      const late = expect(deployment).rejects.toThrow('revoked')
      release()
      await late
      expect(events).toEqual(['quote'])
      expect(network).toHaveBeenCalledTimes(1)
      await expect(
        fixture.withRequests(() =>
          fixture.account.deploy('solana', solanaDevnet),
        ),
      ).rejects.toThrow('revoked')
      expect(globalThis.fetch).toBe(previous)
    },
  )

  test('overlapping fixtures fail closed without replacing the active transport', async () => {
    const previous = globalThis.fetch
    const first = await setup()
    const second = await setup()
    await first.fixture.withRequests(async () => {
      const active = globalThis.fetch
      await expect(second.fixture.withRequests(async () => {})).rejects.toThrow(
        'must not overlap',
      )
      expect(globalThis.fetch).toBe(active)
    })
    expect(globalThis.fetch).toBe(previous)
  })
})
