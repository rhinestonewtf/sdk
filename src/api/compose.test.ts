import {
  type Account,
  type Address,
  concat,
  encodeAbiParameters,
  erc20Abi,
  type Hex,
  pad,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base as baseChain } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { SETTLEMENT_CATALOG } from '../../test/utils/settlement-catalog'
import { toEvmChainReference } from '../chains/caip2'
import { ChainCatalog } from '../clients/orchestrator/chain-catalog'
import type { OrchestratorPort } from '../clients/orchestrator/port'
import type { RpcReadPort } from '../clients/rpc/port'
import { resolveAccountConfig, resolveSdkConfig } from '../config/resolve'
import type { AccountInvocationContext } from '../config/resolved'
import { K1_DEFAULT_VALIDATOR_ADDRESS } from '../modules/validators/k1'
import { getSessionDetails } from '../modules/validators/smart-sessions/authorization'
import {
  UNIVERSAL_ACTION_POLICY_ADDRESS,
  UNIVERSAL_ACTION_POLICY_COPIES,
} from '../modules/validators/smart-sessions/policies/addresses'
import { toSession } from '../modules/validators/smart-sessions/resolve'
import { SWAP_EXACT_IN_SELECTOR } from '../modules/validators/smart-sessions/swap/rhinestone'
import { createCoreComposition } from './compose'
import type { CoreDependencies } from './compose-types'

const chain = toEvmChainReference(1)
const owner = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000001',
)
const target = '0x0000000000000000000000000000000000000010' as const
const userOperationHash = `0x${'22'.repeat(32)}` as const

function catalogChain(name: string, testnet: boolean) {
  return { name, testnet, supportedTokens: 'all' as const }
}

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
                  gas: { usd: 0, sponsored: false },
                  bridge: { usd: 0, sponsored: false },
                  swap: { usd: 0, sponsored: false },
                  app: { usd: 0, sponsored: false },
                  protocol: { usd: 0, sponsored: false },
                  sponsorSurcharge: { usd: 0, sponsored: false },
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

  test('filters portfolio chains by network and EIP-155 namespace', async () => {
    const base = fixture()
    const portfolio = { tokens: [] }
    const getPortfolio = vi.fn(async () => portfolio)
    const orchestrator: OrchestratorPort = {
      ...base.orchestrator,
      getPortfolio,
      getChainCatalog: vi.fn(
        async () =>
          new ChainCatalog({
            1: catalogChain('Ethereum', false),
            1337: catalogChain('HyperCore', false),
            42161: catalogChain('Arbitrum', false),
            11155111: catalogChain('Sepolia', true),
            728126428: catalogChain('Tron', false),
            792703809: catalogChain('Solana', false),
          }),
      ),
    }
    const workflows = createCoreComposition(base.context.sdk, {
      ...base.dependencies,
      orchestrator,
    }).createAccount(base.context).workflows

    await expect(workflows.getPortfolio(base.context, false)).resolves.toBe(
      portfolio,
    )
    await expect(workflows.getPortfolio(base.context, true)).resolves.toBe(
      portfolio,
    )
    expect(getPortfolio).toHaveBeenCalledTimes(2)
    expect(getPortfolio).toHaveBeenNthCalledWith(1, {
      account: expect.any(String),
      chainIds: [1, 42161],
    })
    expect(getPortfolio).toHaveBeenNthCalledWith(2, {
      account: expect.any(String),
      chainIds: [11155111],
    })
  })

  test('rejects portfolio reads without an EIP-155 catalog chain', async () => {
    const base = fixture()
    const getPortfolio = vi.fn(async () => ({ tokens: [] }))
    const orchestrator: OrchestratorPort = {
      ...base.orchestrator,
      getPortfolio,
      getChainCatalog: vi.fn(
        async () =>
          new ChainCatalog({
            1337: catalogChain('HyperCore', false),
            728126428: catalogChain('Tron', false),
            792703809: catalogChain('Solana', false),
          }),
      ),
    }
    const workflows = createCoreComposition(base.context.sdk, {
      ...base.dependencies,
      orchestrator,
    }).createAccount(base.context).workflows

    await expect(workflows.getPortfolio(base.context, false)).rejects.toThrow(
      'No EVM chain is available for portfolio account resolution',
    )
    expect(getPortfolio).not.toHaveBeenCalled()
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

  test('reads ECDSA owners through the configured validator', async () => {
    const base = fixture()
    const validator = `0x${'66'.repeat(20)}` as const
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
          readContract: vi.fn() as RpcReadPort['readContract'],
          multicall: multicall as RpcReadPort['multicall'],
        }),
      },
    } satisfies CoreDependencies
    const context = {
      ...base.context,
      method: 'get-owners' as const,
      account: resolveAccountConfig(base.context.sdk, {
        account: { type: 'nexus', version: '1.2.1' },
        owners: { type: 'ecdsa', accounts: [owner], module: validator },
        initData: { address: target },
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

  test.each([
    {
      signing: { mode: 'disabled' as const },
      error: 'signing disabled',
    },
    {
      signing: {
        mode: 'scoped' as const,
        allowedContents: [
          {
            domain: { chainId: 1, verifyingContract: target },
            types: { Test: [{ name: 'value', type: 'uint256' }] },
            primaryType: 'Test',
          },
        ],
      },
      error: 'safe ERC-7739 emission',
    },
  ])(
    'rejects $signing.mode Smart Session direct signing before invoking a signer',
    async ({ signing, error }) => {
      const base = fixture()
      const invoke = vi.fn()
      const workflows = createCoreComposition(base.context.sdk, {
        ...base.dependencies,
        signerInvoker: { invoke },
      }).createAccount(base.context).workflows
      const session = toSession({
        chain: { id: 1 } as never,
        owners: { type: 'ecdsa', accounts: [owner] },
        signing,
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

      await expect(
        workflows.signMessage(base.context, {
          message: 'hello',
          chain,
          signers,
        }),
      ).rejects.toThrow(error)
      await expect(
        workflows.signTypedData(base.context, {
          typedData,
          chain,
          signers,
        }),
      ).rejects.toThrow(error)
      expect(invoke).not.toHaveBeenCalled()
    },
  )

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

  /** A settlement-scoped createSession on Base, reading code through `getCode`. */
  const createSettlementSession = (
    getCode: RpcReadPort['getCode'] = vi.fn(async () => ({
      code: '0x6080604052' as Hex,
    })),
  ) => {
    const base = fixture()
    const served = (id: number) => ({
      name: String(id),
      testnet: false,
      supportedTokens: 'all' as const,
      settlement: SETTLEMENT_CATALOG[id],
    })
    const composition = createCoreComposition(base.context.sdk, {
      ...base.dependencies,
      orchestrator: {
        ...base.orchestrator,
        getChainCatalog: vi.fn(
          async () =>
            new ChainCatalog({
              [baseChain.id]: {
                ...served(baseChain.id),
                wrappedNativeToken: {
                  symbol: 'WETH',
                  address: '0x4200000000000000000000000000000000000006',
                  decimals: 18,
                },
              },
              [arbitrum.id]: served(arbitrum.id),
            }),
        ),
      },
      rpc: {
        forChain: () => ({ ...base.dependencies.rpc.forChain(), getCode }),
      },
    })

    return composition.project.createSession({
      chain: baseChain,
      owners: { type: 'ecdsa', accounts: [owner] },
      account: '0x1111111111111111111111111111111111111111',
      crossChainPermits: [
        {
          from: {
            chain: baseChain,
            token: SETTLEMENT_CATALOG[baseChain.id].cctp!.usdc,
          },
          to: {
            chain: arbitrum,
            token: SETTLEMENT_CATALOG[arbitrum.id].cctp!.usdc,
          },
          settlementLayers: ['CCTP'],
        },
      ],
    })
  }

  test("createSession scopes an IntentExecutor-layer permit with /chains' settlement addresses", async () => {
    const session = await createSettlementSession()

    expect(session.actions[0].actionTarget).toBe(
      SETTLEMENT_CATALOG[baseChain.id].cctp!.tokenMessenger,
    )
  })

  test('createSession checks the deployed copies a settlement-scoped session defaults to', async () => {
    const UAP_CODE = '0x6080604052'
    const getCode = vi.fn(async (_: unknown, _address: Address) => ({
      code: UAP_CODE as Hex,
    }))
    await createSettlementSession(getCode)
    expect(getCode.mock.calls.map(([, address]) => address)).toEqual([
      UNIVERSAL_ACTION_POLICY_ADDRESS,
      ...UNIVERSAL_ACTION_POLICY_COPIES,
    ])

    const last = UNIVERSAL_ACTION_POLICY_COPIES[2]
    await expect(
      createSettlementSession(
        vi.fn(async (_: unknown, address: Address) => ({
          code: (address === last ? '0x' : UAP_CODE) as Hex,
        })),
      ),
    ).rejects.toThrow(
      `universalActionCopies ${last} does not hold the code of universalAction`,
    )
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

  // The default UniversalActionPolicy copies are checked first, as createSession does.
  const dryRun = (copyCode: () => Promise<Hex | undefined>) => {
    const base = fixture()
    const getCode = vi.fn(async (_: unknown, address: Address) => ({
      code:
        address.toLowerCase() === UNIVERSAL_ACTION_POLICY_ADDRESS.toLowerCase()
          ? ('0x6080604052' as Hex)
          : await copyCode(),
    }))
    const composition = createCoreComposition(base.context.sdk, {
      ...base.dependencies,
      rpc: {
        forChain: () => ({ ...base.dependencies.rpc.forChain(), getCode }),
      },
      orchestrator: {
        ...base.orchestrator,
        getChainCatalog: vi.fn(
          async () =>
            new ChainCatalog({
              [baseChain.id]: {
                name: 'Base',
                testnet: false,
                supportedTokens: 'all',
                settlement: SETTLEMENT_CATALOG[baseChain.id],
              },
              [arbitrum.id]: {
                name: 'Arbitrum',
                testnet: false,
                supportedTokens: 'all',
                settlement: SETTLEMENT_CATALOG[arbitrum.id],
              },
            }),
        ),
      },
    })
    const definition = {
      chain: baseChain,
      owners: { type: 'ecdsa' as const, accounts: [owner] },
      account: '0x1111111111111111111111111111111111111111' as const,
      crossChainPermits: [
        {
          from: {
            chain: baseChain,
            token: SETTLEMENT_CATALOG[baseChain.id].cctp!.usdc,
            maxAmount: 1n,
          },
          to: {
            chain: arbitrum,
            token: SETTLEMENT_CATALOG[arbitrum.id].cctp!.usdc,
          },
          settlementLayers: ['CCTP' as const],
        },
      ],
    }
    return {
      validate: () => composition.project.validateSession(definition),
      create: () => composition.project.createSession(definition),
    }
  }

  test.each([
    ['0x6080604052', []],
    [undefined, ['UNIVERSAL_ACTION_COPY_CODE_MISMATCH']],
  ] as const)(
    'validateSession reports what createSession throws, then the rest (copy code %s)',
    async (copyCode, first) => {
      const { validate, create } = dryRun(async () => copyCode)
      const { refusals } = await validate()
      const thrown = await create().catch((error: Error) => error.message)

      expect(refusals.map(({ code }) => code)).toEqual([
        ...first,
        'WRAPPED_NATIVE_TOKEN_UNSERVED',
        'INTENT_EXECUTOR_MAX_AMOUNT_REQUIRES_ONE_TIME_USE',
      ])
      expect(refusals[0].message).toBe(thrown)
    },
  )

  test('validateSession throws a failed code read, as createSession does', async () => {
    const outage = new Error('rpc unavailable')
    const { validate, create } = dryRun(async () => {
      throw outage
    })
    await expect(validate()).rejects.toBe(outage)
    await expect(create()).rejects.toBe(outage)
  })

  describe('createSession with universalActionCopies', () => {
    const uap = UNIVERSAL_ACTION_POLICY_ADDRESS
    const copies: Address[] = [
      '0x00000000000000000000000000000000000000c1',
      '0x00000000000000000000000000000000000000c2',
    ]
    const UAP_CODE = '0x6080604052'
    const withCode = (code: Record<string, Hex | undefined>) => {
      const base = fixture()
      const getCode = vi.fn(async (_: unknown, address: Address) => ({
        code: code[address.toLowerCase()],
      }))
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
                    address: '0x4200000000000000000000000000000000000006',
                    decimals: 18,
                  },
                },
              }),
          ),
        },
        rpc: {
          forChain: () => ({
            ...base.dependencies.rpc.forChain(),
            getCode,
          }),
        },
      })
      const create = (universalActionCopies?: Address[]) =>
        composition.project.createSession({
          chain: baseChain,
          owners: { type: 'ecdsa', accounts: [owner] },
          ...(universalActionCopies
            ? { policyAddresses: { universalActionCopies } }
            : {}),
        })
      return { create, getCode }
    }
    const codes = (copyCode: (i: number) => Hex | undefined) =>
      Object.fromEntries([
        [uap.toLowerCase(), UAP_CODE as Hex],
        ...copies.map((c, i) => [c.toLowerCase(), copyCode(i)]),
      ])

    test('accepts copies holding the UniversalActionPolicy code', async () => {
      const { create, getCode } = withCode(codes(() => UAP_CODE))
      await expect(create(copies)).resolves.toBeDefined()
      expect(getCode.mock.calls.map(([, address]) => address)).toEqual([
        uap,
        ...copies,
      ])
    })

    test('reads no code when no copy is configured', async () => {
      const { create, getCode } = withCode({})
      await expect(create()).resolves.toBeDefined()
      expect(getCode).not.toHaveBeenCalled()
    })

    test('refuses a copy with other code or none', async () => {
      for (const other of ['0x6080604053', undefined, '0x'] as const) {
        const { create } = withCode(
          codes((i) => (i === 1 ? (other as Hex | undefined) : UAP_CODE)),
        )
        await expect(create(copies)).rejects.toThrow(
          `universalActionCopies ${copies[1]} does not hold the code of universalAction`,
        )
      }
    })

    test('refuses when universalAction itself has no code', async () => {
      const { create } = withCode({})
      await expect(create(copies)).rejects.toThrow('has no code on chain')
    })
  })

  test('createSession hands the served USD stablecoins to a stableFloor swap scope', async () => {
    const usdc: Address = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
    const usdt: Address = '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2'
    const account: Address = '0x1111111111111111111111111111111111111111'
    // A swap chain: its catalog is 'all', so the floor must read the served list.
    const withServed = (
      usdStablecoins?: { symbol: string; address: Address; decimals: number }[],
    ) => {
      const base = fixture()
      return createCoreComposition(base.context.sdk, {
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
                    address: '0x4200000000000000000000000000000000000006',
                    decimals: 18,
                  },
                  ...(usdStablecoins ? { settlement: { usdStablecoins } } : {}),
                },
              }),
          ),
        },
      })
    }
    const definition = {
      chain: baseChain,
      owners: { type: 'ecdsa' as const, accounts: [owner] },
      swap: {
        sell: { token: usdc, maxTotal: 1_000_000n },
        buy: { token: usdt },
        to: account,
        stableFloor: true as const,
      },
    }

    const session = await withServed([
      { symbol: 'USDC', address: usdc, decimals: 6 },
      { symbol: 'USDT', address: usdt, decimals: 6 },
    ]).project.createSession(definition)
    const exactIn = session.actions.find(
      (action) => action.actionTargetSelector === SWAP_EXACT_IN_SELECTOR,
    )
    // The encoded rule (greaterThanOrEqual = 3, offset 96, not limited, 990000):
    // 1_000_000 USDC less 100 bps, pinned on minAmountOut.
    const floorRule = concat(
      [3n, 96n, 0n, 990_000n].map((word) => pad(toHex(word))),
    ).slice(2)
    expect(exactIn?.actionPolicies[0]?.initData).toContain(floorRule)
    await expect(
      withServed().project.createSession(definition),
    ).rejects.toThrow("needs the orchestrator's stablecoins")
  })
})
