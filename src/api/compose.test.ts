import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test, vi } from 'vitest'
import { toEvmChainReference } from '../chains/caip2'
import type { OrchestratorPort } from '../clients/orchestrator/port'
import { resolveAccountConfig, resolveSdkConfig } from '../config/resolve'
import type { AccountInvocationContext } from '../config/resolved'
import { createCoreComposition } from './compose'

const chain = toEvmChainReference(1)
const owner = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000001',
)
const target = '0x0000000000000000000000000000000000000010' as const
const userOperationHash = `0x${'22'.repeat(32)}` as const

function fixture() {
  const sdk = resolveSdkConfig({ apiKey: 'test' })
  const account = resolveAccountConfig(sdk, {
    account: { type: 'nexus', version: '1.2.0' },
    owners: { type: 'ecdsa', accounts: [owner] },
  })
  const context: AccountInvocationContext<Record<string, never>> = {
    method: 'prepare-intent',
    sdk,
    account,
    compatibilityConfig: {},
  }
  const orchestrator: OrchestratorPort = {
    createQuote: vi.fn(async (request) => {
      const typedData = {
        domain: {
          chainId: 1,
          verifyingContract: request.account.address,
        },
        types: { Test: [{ name: 'value', type: 'uint256' }] },
        primaryType: 'Test',
        message: { value: '1' },
      } as const
      return {
        traceId: 'trace-prepare',
        routes: [
          {
            intentId: 'intent-1',
            expiresAt: 1,
            estimatedFillTime: { seconds: 1 },
            settlementLayer: 'SAME_CHAIN',
            signData: { origin: [typedData], destination: typedData },
            cost: {
              input: [],
              output: [],
              fees: {
                total: { usd: 0 },
                breakdown: {
                  gas: { usd: 0 },
                  bridge: { usd: 0 },
                  swap: { usd: 0 },
                  app: { usd: 0 },
                },
              },
            },
          },
        ],
      }
    }),
    submitIntent: vi.fn(async () => ({
      traceId: 'trace-submit',
      intentId: 'intent-1',
    })),
    getIntentStatus: vi.fn(async (intentId) => ({
      traceId: 'trace-status',
      intentId,
      status: 'COMPLETED',
      account: target,
      operations: [],
    })),
    splitIntents: vi.fn(async () => ({ traceId: 'trace-split', intents: [] })),
    getPortfolio: vi.fn(async () => ({ tokens: [] })),
    getAppFeeBalances: vi.fn(async () => ({
      withdrawableUsd: 1,
      pendingUsd: 2,
    })),
  }
  const dependencies = {
    orchestrator,
    rpc: {
      forChain: () => ({
        getCode: vi.fn(async () => ({ code: undefined })),
        getTransactionCount: vi.fn(async () => 0n),
        readContract: vi.fn(async () => 0n),
        multicall: vi.fn(async () => []),
      }),
    },
    bundler: {
      estimateGas: vi.fn(async () => ({
        callGasLimit: 100n,
        verificationGasLimit: 200n,
        preVerificationGas: 300n,
      })),
      getGasPrice: vi.fn(async () => ({
        maxFeePerGas: 10n,
        maxPriorityFeePerGas: 2n,
      })),
      send: vi.fn(async () => userOperationHash),
      getReceipt: vi.fn(async () => undefined),
    },
    clock: { now: () => 0, sleep: vi.fn(async () => undefined) },
  } as const
  return {
    context,
    orchestrator,
    composition: createCoreComposition(sdk, dependencies),
  }
}

describe('internal core composition', () => {
  test('runs an intent through real account and signing implementations', async () => {
    const { composition, context, orchestrator } = fixture()
    const workflows = composition.createAccount(context).workflows
    const prepared = await workflows.prepareIntent(context, {
      destination: chain,
      sourceChains: [chain],
      calls: [{ target, value: 0n, data: '0x' }],
      tokenRequests: [],
    })
    const { intent: signed } = await workflows.signIntent(context, prepared)
    const submitted = await workflows.submitIntent(context, signed)

    expect(signed.transcript.planKind).toBe('intent-full')
    expect(submitted).toMatchObject({
      type: 'intent',
      traceId: 'trace-submit',
      intentId: 'intent-1',
    })
    expect(orchestrator.createQuote).toHaveBeenCalledOnce()
  })

  test('runs a UserOperation and project/account queries', async () => {
    const { composition, context } = fixture()
    const workflows = composition.createAccount(context).workflows
    const prepared = await workflows.prepareUserOperation(context, {
      chain,
      calls: [{ target, value: 0n, data: '0x' }],
    })
    const signed = await workflows.signUserOperation(context, prepared)
    await expect(
      workflows.submitUserOperation(context, signed),
    ).resolves.toMatchObject({ type: 'userop', hash: userOperationHash })
    await expect(composition.project.getAppFeeBalances()).resolves.toEqual({
      withdrawableUsd: 1,
      pendingUsd: 2,
    })
    await expect(workflows.getPortfolio(context)).resolves.toEqual({
      tokens: [],
    })
  })
})
