import { type Account, encodeAbiParameters, erc20Abi, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base as baseChain } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { toEvmChainReference } from '../chains/caip2'
import { ChainCatalog } from '../clients/orchestrator/chain-catalog'
import type { OrchestratorPort } from '../clients/orchestrator/port'
import type { RpcReadPort } from '../clients/rpc/port'
import { resolveAccountConfig, resolveSdkConfig } from '../config/resolve'
import type { AccountInvocationContext } from '../config/resolved'
import { K1_DEFAULT_VALIDATOR_ADDRESS } from '../modules/validators/k1'
import { getSessionDetails } from '../modules/validators/smart-sessions/authorization'
import { toSession } from '../modules/validators/smart-sessions/resolve'
import { createCoreComposition } from './compose'
import type { CoreDependencies } from './compose-types'

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
            settlementLayer: 'SAME_CHAIN' as const,
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
      status: 'COMPLETED' as const,
      account: target,
      operations: [],
    })),
    splitIntents: vi.fn(async () => ({ traceId: 'trace-split', intents: [] })),
    getPortfolio: vi.fn(async () => ({ tokens: [] })),
    getAppFeeBalances: vi.fn(async () => ({
      withdrawableUsd: 1,
      pendingUsd: 2,
    })),
    getChainCatalog: vi.fn(
      async () =>
        new ChainCatalog({
          1: { name: 'Ethereum', testnet: false, supportedTokens: 'all' },
        }),
    ),
  }
  const dependencies = {
    orchestrator,
    rpc: {
      forChain: () => ({
        getCode: vi.fn(async () => ({ code: undefined })),
        getTransactionCount: vi.fn(async () => 0n),
        readContract: async <TResult>() => 0n as unknown as TResult,
        multicall: async <TResults extends readonly unknown[]>() =>
          [] as unknown as TResults,
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
      getReceipt: vi.fn(async () => ({ success: true }) as never),
    },
    clock: {
      now: () => 0,
      sleep: vi.fn(async () => undefined),
      timeout: <T>(promise: Promise<T>) => promise,
    },
  } as const satisfies CoreDependencies
  return {
    context,
    dependencies,
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

  test('reads HCA owners through the explicitly configured factory', async () => {
    const base = fixture()
    const factory = `0x${'33'.repeat(20)}` as const
    const initDataFactory = `0x${'44'.repeat(20)}` as const
    const validator = `0x${'55'.repeat(20)}` as const
    const readContract = vi.fn(async () => validator)
    const multicall = vi.fn(async () => [
      { result: [owner.address] },
      { result: 1n },
    ])
    const dependencies = {
      ...base.dependencies,
      rpc: {
        forChain: () => ({
          getCode: vi.fn(async () => ({ code: undefined })),
          getTransactionCount: vi.fn(async () => 0n),
          readContract: readContract as RpcReadPort['readContract'],
          multicall: multicall as RpcReadPort['multicall'],
        }),
      },
    } satisfies CoreDependencies
    const context = {
      ...base.context,
      method: 'get-owners' as const,
      account: resolveAccountConfig(base.context.sdk, {
        account: { type: 'hca', factory },
        owners: { type: 'ens', owners: [{ account: owner }] },
        initData: {
          address: target,
          factory: initDataFactory,
          factoryData: '0x',
          intentExecutorInstalled: false,
        },
      }),
    }
    const workflows = createCoreComposition(
      base.context.sdk,
      dependencies,
    ).createAccount(context).workflows

    await expect(workflows.getOwners(context, chain)).resolves.toEqual({
      accounts: [owner.address],
      threshold: 1,
    })
    expect(readContract).toHaveBeenCalledWith(
      { chain },
      expect.objectContaining({
        address: factory,
        functionName: 'initDataParser',
      }),
    )
    expect(multicall).toHaveBeenCalledWith(
      { chain },
      expect.arrayContaining([expect.objectContaining({ address: validator })]),
    )
  })

  test('signs messages and typed data with Smart Session owners', async () => {
    const { composition, context } = fixture()
    const workflows = composition.createAccount(context).workflows
    const session = toSession({
      chain: { id: 1 } as never,
      owners: { type: 'ecdsa', accounts: [owner] },
    })
    const signers = {
      kind: 'smart-session' as const,
      byChain: { 1: { session } },
    }
    const typedData = {
      domain: { chainId: 1, verifyingContract: target },
      types: { Test: [{ name: 'value', type: 'uint256' }] },
      primaryType: 'Test',
      message: { value: 1n },
    } as const

    const message = await workflows.signMessage(context, {
      message: 'hello',
      chain,
      signers,
    })
    const typed = await workflows.signTypedData(context, {
      typedData,
      chain,
      signers,
    })

    expect(message.signature).toMatch(/^0x/u)
    expect(typed.signature).toMatch(/^0x/u)
    expect(
      Object.keys(message.transcript.stages[0]?.results ?? {}),
    ).toHaveLength(1)
    expect(Object.keys(typed.transcript.stages[0]?.results ?? {})).toHaveLength(
      1,
    )
  })

  test('waits for intent and custom-bundler deployment execution', async () => {
    const first = fixture()
    const intentWorkflows = first.composition.createAccount(
      first.context,
    ).workflows

    await expect(intentWorkflows.deploy(first.context, chain)).resolves.toBe(
      true,
    )
    expect(first.orchestrator.submitIntent).toHaveBeenCalledOnce()
    expect(first.orchestrator.getIntentStatus).toHaveBeenCalledWith('intent-1')

    const second = fixture()
    const customSdk = resolveSdkConfig({
      apiKey: 'test',
      bundler: { type: 'custom', url: 'https://bundler.test' },
    })
    const customContext = {
      ...second.context,
      sdk: customSdk,
      account: resolveAccountConfig(customSdk, {
        account: { type: 'nexus', version: '1.2.0' },
        owners: { type: 'ecdsa', accounts: [owner] },
      }),
    }
    const userOperationWorkflows =
      second.composition.createAccount(customContext).workflows

    await expect(
      userOperationWorkflows.deploy(customContext, chain),
    ).resolves.toBe(true)
    expect(second.dependencies.bundler.send).toHaveBeenCalledOnce()
    expect(second.dependencies.bundler.getReceipt).toHaveBeenCalledWith(
      chain,
      userOperationHash,
    )
    expect(second.orchestrator.createQuote).not.toHaveBeenCalled()
  })

  test('deploys an undelegated Nexus adoption through the intent path', async () => {
    const base = fixture()
    const adoptedContext = {
      ...base.context,
      method: 'deploy' as const,
      account: resolveAccountConfig(base.context.sdk, {
        account: { type: 'nexus', version: '1.2.0' },
        owners: { type: 'ecdsa', accounts: [owner] },
        eoa: owner,
      }),
    }
    const workflows = base.composition.createAccount(adoptedContext).workflows

    await expect(workflows.deploy(adoptedContext, chain)).resolves.toBe(true)
    expect(base.orchestrator.createQuote).toHaveBeenCalledOnce()
    expect(base.dependencies.bundler.send).not.toHaveBeenCalled()
  })

  test('signs chainless Nexus init typed data without switching a wallet chain', async () => {
    const base = fixture()
    const request = vi.fn(async () => null)
    const signTypedData = vi.fn(async () => `0x${'11'.repeat(64)}1b` as Hex)
    const eoa = {
      address: owner.address,
      client: { transport: { request } },
      signTypedData,
    } as unknown as Account
    const signingContext = {
      ...base.context,
      method: 'sign-eip7702-init-data' as const,
      account: resolveAccountConfig(base.context.sdk, {
        account: { type: 'nexus', version: '1.2.0' },
        owners: { type: 'ecdsa', accounts: [owner] },
        eoa,
      }),
    }
    const workflows = base.composition.createAccount(signingContext).workflows

    await workflows.signEip7702InitData(signingContext)

    expect(signTypedData).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
  })

  test('uses the single session chain for Startale K1 enablement', async () => {
    const base = fixture()
    const invoke = vi.fn(async () => ({
      kind: 'ecdsa-signature' as const,
      signature: `0x${'11'.repeat(64)}1b` as Hex,
    }))
    const dependencies = {
      ...base.dependencies,
      signerInvoker: { invoke },
    } satisfies CoreDependencies
    const startaleContext = {
      ...base.context,
      method: 'sign-enable-session' as const,
      account: resolveAccountConfig(base.context.sdk, {
        account: { type: 'startale' },
        owners: {
          type: 'ecdsa',
          accounts: [owner],
          module: K1_DEFAULT_VALIDATOR_ADDRESS,
        },
      }),
    }
    const workflows = createCoreComposition(
      base.context.sdk,
      dependencies,
    ).createAccount(startaleContext).workflows
    const session = toSession({
      chain: baseChain,
      owners: { type: 'ecdsa', accounts: [owner] },
    })
    const details = await getSessionDetails({
      account: owner.address,
      sessions: [session],
      environment: 'production',
      readNonce: async () => 0n,
    })

    await workflows.signEnableSession(startaleContext, details)

    expect(invoke).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chain: expect.objectContaining({ id: baseChain.id }),
      }),
    )
  })

  test('rejects multi-chain Startale K1 enablement before signing', async () => {
    const base = fixture()
    const invoke = vi.fn()
    const dependencies = {
      ...base.dependencies,
      signerInvoker: { invoke },
    } satisfies CoreDependencies
    const startaleContext = {
      ...base.context,
      method: 'sign-enable-session' as const,
      account: resolveAccountConfig(base.context.sdk, {
        account: { type: 'startale' },
        owners: {
          type: 'ecdsa',
          accounts: [owner],
          module: K1_DEFAULT_VALIDATOR_ADDRESS,
        },
      }),
    }
    const workflows = createCoreComposition(
      base.context.sdk,
      dependencies,
    ).createAccount(startaleContext).workflows
    const details = await getSessionDetails({
      account: owner.address,
      sessions: [
        toSession({
          chain: baseChain,
          owners: { type: 'ecdsa', accounts: [owner] },
        }),
        toSession({
          chain: arbitrum,
          owners: { type: 'ecdsa', accounts: [owner] },
        }),
      ],
      environment: 'production',
      readNonce: async () => 0n,
    })

    await expect(
      workflows.signEnableSession(startaleContext, details),
    ).rejects.toThrow(
      'Startale accounts with K1 validator do not support multi-chain session enable',
    )
    expect(invoke).not.toHaveBeenCalled()
  })

  test('recognizes installed modules of every kind during Kernel setup', async () => {
    const base = fixture()
    const multicall = vi.fn(async (_context, requests: readonly unknown[]) =>
      requests.map(() => ({ result: true })),
    )
    const dependencies = {
      ...base.dependencies,
      rpc: {
        forChain: () => ({
          getCode: vi.fn(async () => ({ code: '0x01' as const })),
          getTransactionCount: vi.fn(async () => 0n),
          readContract: async <TResult>() => 0n as unknown as TResult,
          multicall: multicall as RpcReadPort['multicall'],
        }),
      },
    } satisfies CoreDependencies
    const sdk = resolveSdkConfig({ apiKey: 'test' })
    const context = {
      ...base.context,
      sdk,
      account: resolveAccountConfig(sdk, {
        account: { type: 'kernel' },
        owners: { type: 'ecdsa', accounts: [owner] },
        modules: [
          {
            type: 'fallback',
            address: `0x${'33'.repeat(20)}`,
            initData: encodeAbiParameters(
              [{ type: 'bytes4' }, { type: 'bytes1' }, { type: 'bytes' }],
              ['0x12345678', '0xfe', '0x'],
            ),
          },
          { type: 'hook', address: `0x${'44'.repeat(20)}` },
        ],
      }),
    }
    const composition = createCoreComposition(sdk, dependencies)

    await expect(
      composition.createAccount(context).workflows.setup(context, chain),
    ).resolves.toBe(false)
    const requests = multicall.mock.calls[0]?.[1] as readonly {
      args: readonly unknown[]
    }[]
    expect(requests.map(({ args }) => args[0])).toEqual(
      expect.arrayContaining([1n, 2n, 3n, 4n]),
    )
    expect(base.orchestrator.submitIntent).not.toHaveBeenCalled()
    expect(base.dependencies.bundler.send).not.toHaveBeenCalled()
  })

  test('signs raw SignData through the standalone signIntent path (no intent id)', async () => {
    const { composition, context } = fixture()
    const workflows = composition.createAccount(context).workflows
    const typedData = {
      domain: { chainId: 1, verifyingContract: target },
      types: { Test: [{ name: 'value', type: 'uint256' }] },
      primaryType: 'Test',
      message: { value: 1n },
    } as const

    const signed = await workflows.signIntentFromSignData(context, {
      signData: { origin: [typedData], destination: typedData },
      targetChain: chain,
    })

    expect(signed.originSignatures).toHaveLength(1)
    expect(signed.originSignatures[0]).toMatch(/^0x/u)
    expect(signed.destinationSignature).toMatch(/^0x/u)
  })

  test('createSession resolves the wrapped-native token from the chain catalog', async () => {
    const base = fixture()
    const weth = '0x4200000000000000000000000000000000000006'
    const composition = createCoreComposition(base.context.sdk, {
      ...base.dependencies,
      orchestrator: {
        ...base.orchestrator,
        getChainCatalog: vi.fn(
          async () =>
            new ChainCatalog({
              [baseChain.id]: {
                name: 'Base',
                testnet: false,
                supportedTokens: 'all',
                wrappedNativeToken: {
                  symbol: 'WETH',
                  address: weth,
                  decimals: 18,
                },
              },
            }),
        ),
      },
    })

    const session = await composition.project.createSession({
      chain: baseChain,
      owners: { type: 'ecdsa', accounts: [owner] },
      permissions: [
        {
          abi: erc20Abi,
          address: '0x1111111111111111111111111111111111111111',
          functions: { transfer: {} },
        },
      ],
    })

    // The resolved wrapped-native token drives the injected native-wrap action.
    expect(
      session.actions.some(
        (action) => action.actionTarget.toLowerCase() === weth,
      ),
    ).toBe(true)
  })

  test('createSession fails fast when the chain has no wrapped-native token', async () => {
    const base = fixture()
    const composition = createCoreComposition(base.context.sdk, {
      ...base.dependencies,
      orchestrator: {
        ...base.orchestrator,
        getChainCatalog: vi.fn(
          async () =>
            new ChainCatalog({
              [baseChain.id]: {
                name: 'Base',
                testnet: false,
                supportedTokens: 'all',
              },
            }),
        ),
      },
    })

    await expect(
      composition.project.createSession({
        chain: baseChain,
        owners: { type: 'ecdsa', accounts: [owner] },
      }),
    ).rejects.toThrow('no wrapped-native token')
  })
})
