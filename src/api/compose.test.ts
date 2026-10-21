import {
  type Account,
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  isAddressEqual,
  type TypedDataDefinition,
  zeroHash,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base as baseChain } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import {
  delegationRequest,
  eip712Request,
  personalSignRequest,
  plan,
  quote,
} from '../../test/utils/caucasus'
import { SETTLEMENT_CATALOG } from '../../test/utils/settlement-catalog'
import { toEvmChainReference } from '../chains/caip2'
import { solanaAddress, solanaDevnet } from '../chains/non-evm'
import { ChainCatalog } from '../clients/orchestrator/chain-catalog'
import type { OrchestratorPort } from '../clients/orchestrator/port'
import type { OrchestratorIntentRequest } from '../clients/orchestrator/types'
import type { RpcReadPort } from '../clients/rpc/port'
import { resolveAccountConfig, resolveSdkConfig } from '../config/resolve'
import type { AccountInvocationContext } from '../config/resolved'
import { UnsupportedAccountCapabilityError } from '../errors/capability'
import {
  Eip7702InitSignatureRequiredError,
  SolanaQuoteExpiredError,
} from '../errors/execution'
import { getIntentExecutorModule } from '../modules/intent-executor'
import { K1_DEFAULT_VALIDATOR_ADDRESS } from '../modules/validators/k1'
import { getSessionDetails } from '../modules/validators/smart-sessions/authorization'
import { oneTimeUseIdPolicyAbi } from '../modules/validators/smart-sessions/one-time-use'
import { toSession } from '../modules/validators/smart-sessions/resolve'
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

// A same-chain quote: the claim and the fill are authorised by the same
// payload, so the destination slot reuses the origin signature while staying
// its own authorisation.
function quoteFor(request: OrchestratorIntentRequest) {
  const account = request.account.evm?.address ?? target
  const typedData = {
    domain: { chainId: 1, verifyingContract: account },
    types: { Test: [{ name: 'value', type: 'uint256' }] },
    primaryType: 'Test',
    message: { value: '1' },
  } as unknown as TypedDataDefinition
  return quote({
    signingRequests: [
      eip712Request({ chainId: 1, account, typedData }),
      eip712Request({
        chainId: 1,
        account,
        purpose: 'destinationAuthorization',
        typedData,
      }),
    ],
  })
}

function fixture() {
  const sdk = resolveSdkConfig({
    auth: { mode: 'apiKey' as const, apiKey: 'test' },
  })
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
    createQuote: vi.fn(async (request) => ({
      traceId: 'trace-prepare',
      routes: [quoteFor(request)],
    })),
    submitIntent: vi.fn(async () => ({
      traceId: 'trace-submit',
      intentId: 'intent-1',
    })),
    getIntentStatus: vi.fn(async (intentId) => ({
      traceId: 'trace-status',
      intentId,
      purpose: 'execution' as const,
      status: 'COMPLETED' as const,
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
      calls: [{ target, value: 0n, data: '0x' }],
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

  // A standalone Solana account has no EVM account to scope a composition, so
  // it reaches the same workflows through the project.
  test.each(['account', 'project'] as const)(
    'runs the managed Solana workflow from the %s scope without RPC or catalog reads and enforces expiry before effects',
    async (scope) => {
      const base = fixture()
      const mint = solanaAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
      const recipient = solanaAddress('11111111111111111111111111111112')
      const walletAddress = solanaAddress(
        'DfBX7Po1bmnXt4GuEF3Eg5UYUHAjs9m5n8nbb9WUqgw2',
      )
      const swigAddress = solanaAddress(
        '9fTE4gQnweN345EGzy6jnXNFW8VryvZ8QwLZqgBubmMs',
      )
      const message = 'ab'.repeat(32)
      const devnet = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
      const costEntry = {
        chainId: devnet,
        tokenAddress: mint,
        symbol: 'USDC',
        decimals: 6,
        price: { usd: 1 },
        amount: 100n,
      }
      const createQuote = vi.fn(async () => ({
        traceId: 'solana-prepare',
        routes: [
          {
            ...quote({
              intentId: 'solana-intent',
              expiresAt: 2_000_000_000,
              // A Solana origin authorises its spend with one opaque
              // personal-sign payload naming the Swig wallet and its authority.
              signingRequests: [
                personalSignRequest({
                  chainId: devnet,
                  wallet: walletAddress,
                  swigAccount: swigAddress,
                  authority: owner.address,
                  message,
                }),
              ],
              cost: {
                input: [costEntry],
                output: [costEntry],
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
            }),
            plan: plan(devnet),
          },
        ],
      }))
      const submitIntent = vi.fn(async () => ({
        traceId: 'solana-submit',
        intentId: 'solana-intent',
      }))
      const getChainCatalog = vi.fn(base.orchestrator.getChainCatalog)
      const forChain = vi.fn(base.dependencies.rpc.forChain)
      let now = 1_900_000_000_000
      const dependencies = {
        ...base.dependencies,
        orchestrator: {
          ...base.orchestrator,
          createQuote,
          submitIntent,
          getChainCatalog,
        },
        rpc: { forChain },
        clock: { ...base.dependencies.clock, now: () => now },
      }
      const composition = createCoreComposition(base.context.sdk, dependencies)
      const workflows =
        scope === 'account'
          ? composition.createAccount(base.context).workflows
          : composition.project.solana
      const transfer = {
        chain: solanaDevnet,
        action: {
          kind: 'transfer' as const,
          mint,
          amount: 100n,
          delivery: { kind: 'same-chain' as const, recipient },
        },
        accountAddress: target,
        accountType: 'ERC7579' as const,
        authority: { kind: 'secp256k1' as const, address: owner.address },
        walletAddress,
        swigAddress,
        namespace: 'dev-v1' as const,
        endpoint: 'https://dev.example',
      }
      const prepared = await workflows.prepareSolanaIntent(transfer)
      const signMessage = vi.fn(owner.signMessage)
      const signed = await workflows.signSolanaIntent({
        prepared,
        owner: { ...owner, signMessage },
      })
      await expect(workflows.submitSolanaIntent(signed)).resolves.toMatchObject(
        {
          intentId: 'solana-intent',
          targetChain: 792703810,
        },
      )
      expect(createQuote).toHaveBeenCalledOnce()
      expect(submitIntent).toHaveBeenCalledOnce()
      expect(forChain).not.toHaveBeenCalled()
      expect(getChainCatalog).not.toHaveBeenCalled()

      now = 2_000_000_000_000
      signMessage.mockClear()
      submitIntent.mockClear()
      await expect(
        workflows.signSolanaIntent({
          prepared,
          owner: { ...owner, signMessage },
        }),
      ).rejects.toThrow(SolanaQuoteExpiredError)
      await expect(workflows.submitSolanaIntent(signed)).rejects.toThrow(
        SolanaQuoteExpiredError,
      )
      expect(signMessage).not.toHaveBeenCalled()
      expect(submitIntent).not.toHaveBeenCalled()
    },
  )

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
    await expect(
      composition.project.waitForIntentStatus('intent-1'),
    ).resolves.toMatchObject({ intentId: 'intent-1', status: 'COMPLETED' })
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

    await expect(
      intentWorkflows.deploy(first.context, chain, { sourceToken: target }),
    ).resolves.toBe(true)
    expect(first.orchestrator.submitIntent).toHaveBeenCalledOnce()
    // Polling stays lean: the recorded detail block is not asked for.
    expect(first.orchestrator.getIntentStatus).toHaveBeenCalledWith(
      'intent-1',
      undefined,
    )

    const second = fixture()
    const customSdk = resolveSdkConfig({
      auth: { mode: 'apiKey' as const, apiKey: 'test' },
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

    await expect(
      workflows.deploy(adoptedContext, chain, { sponsored: true }),
    ).resolves.toBe(true)
    expect(base.orchestrator.createQuote).toHaveBeenCalledOnce()
    expect(base.dependencies.bundler.send).not.toHaveBeenCalled()
  })

  test('deploy sends no source and full sponsorship when sponsored', async () => {
    const base = fixture()
    const workflows = base.composition.createAccount(base.context).workflows

    await workflows.deploy(base.context, chain, { sponsored: true })

    const request = vi.mocked(base.orchestrator.createQuote).mock.calls[0]?.[0]
    expect(request).not.toHaveProperty('source')
    expect(request?.options?.sponsorship).toEqual({
      gas: true,
      bridgeFees: true,
      swapFees: true,
    })
  })

  test('unsponsored intent-path deploy without a source token throws before any RPC read', async () => {
    const base = fixture()
    const getCode = vi.fn(async () => ({ code: undefined }))
    const dependencies = {
      ...base.dependencies,
      rpc: {
        forChain: () => ({ ...base.dependencies.rpc.forChain(), getCode }),
      },
    }
    const workflows = createCoreComposition(
      base.context.sdk,
      dependencies,
    ).createAccount(base.context).workflows

    await expect(workflows.deploy(base.context, chain)).rejects.toThrow(
      UnsupportedAccountCapabilityError,
    )
    expect(getCode).not.toHaveBeenCalled()
    expect(base.orchestrator.createQuote).not.toHaveBeenCalled()
  })

  test('unsponsored intent-path deploy with a source token sends it as the source', async () => {
    const base = fixture()
    const workflows = base.composition.createAccount(base.context).workflows

    await workflows.deploy(base.context, chain, { sourceToken: target })

    const request = vi.mocked(base.orchestrator.createQuote).mock.calls[0]?.[0]
    expect(request?.source).toMatchObject({
      chainId: 'eip155:1',
      token: target,
    })
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
    const sdk = resolveSdkConfig({
      auth: { mode: 'apiKey' as const, apiKey: 'test' },
    })
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

  function missingModuleKernelContext(base: ReturnType<typeof fixture>) {
    const sdk = resolveSdkConfig({
      auth: { mode: 'apiKey' as const, apiKey: 'test' },
    })
    return {
      ...base.context,
      sdk,
      account: resolveAccountConfig(sdk, {
        account: { type: 'kernel' },
        owners: { type: 'ecdsa', accounts: [owner] },
        modules: [{ type: 'hook', address: `0x${'44'.repeat(20)}` }],
      }),
    }
  }

  // Installed except the intent executor, so the missing module list still
  // resolves to the intent path rather than the UserOperation one.
  function intentPathMulticall() {
    const intentExecutor = getIntentExecutorModule('production')
    return vi.fn(
      async (
        _context: unknown,
        requests: readonly { args: readonly unknown[] }[],
      ) =>
        requests.map(({ args }) => ({
          result: isAddressEqual(args[1] as Address, intentExecutor.address),
        })),
    )
  }

  test('setup intent path without a source token throws before the orchestrator is called', async () => {
    const base = fixture()
    const multicall = intentPathMulticall()
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
    const context = missingModuleKernelContext(base)
    const workflows = createCoreComposition(
      context.sdk,
      dependencies,
    ).createAccount(context).workflows

    await expect(workflows.setup(context, chain)).rejects.toThrow(
      UnsupportedAccountCapabilityError,
    )
    expect(base.orchestrator.createQuote).not.toHaveBeenCalled()
  })

  test('setup intent path with a source token sends it as the source', async () => {
    const base = fixture()
    const multicall = intentPathMulticall()
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
    const context = missingModuleKernelContext(base)
    const orchestrator = {
      ...base.orchestrator,
      createQuote: vi.fn(async (request) => ({
        traceId: 'trace-prepare',
        routes: [quoteFor(request)],
      })),
    }
    const workflows = createCoreComposition(context.sdk, {
      ...dependencies,
      orchestrator,
    }).createAccount(context).workflows

    await workflows.setup(context, chain, { sourceToken: target })

    const request = vi.mocked(orchestrator.createQuote).mock.calls[0]?.[0]
    expect(request?.source).toMatchObject({
      chainId: 'eip155:1',
      token: target,
    })
  })

  test('signs raw signing requests through the standalone signIntent path (no intent id)', async () => {
    const { composition, context } = fixture()
    const workflows = composition.createAccount(context).workflows
    const account = workflows.getAddress(context, chain)
    const typedData = {
      domain: { chainId: 1, verifyingContract: target },
      types: { Test: [{ name: 'value', type: 'uint256' }] },
      primaryType: 'Test',
      message: { value: 1n },
    } as unknown as TypedDataDefinition

    const signed = await workflows.signIntentFromRequests(context, {
      signingRequests: [
        eip712Request({ chainId: 1, account, typedData }),
        eip712Request({
          chainId: 1,
          account,
          purpose: 'destinationAuthorization',
          typedData,
        }),
      ],
      targetChain: chain,
    })

    // One proof per request, in the quoted order — the destination slot is its
    // own authorisation even though the same bytes satisfy it.
    expect(signed.proofs).toHaveLength(2)
    for (const proof of signed.proofs) {
      if (proof.kind !== 'eip712' || typeof proof.signature !== 'string') {
        throw new Error('Expected one plain EIP-712 signature per request')
      }
      expect(proof.signature).toMatch(/^0x/u)
    }
  })

  describe('cross-chain Smart Session destination routing', () => {
    const destination = toEvmChainReference(arbitrum.id)
    const signers = {
      kind: 'smart-session' as const,
      byChain: {
        1: {
          enableData: {
            userSignature: `0x${'11'.repeat(65)}` as Hex,
            hashesAndChainIds: [
              { chainId: 1n, sessionDigest: userOperationHash },
            ],
            sessionToEnableIndex: 0,
          },
          session: toSession({
            chain: { id: 1 } as never,
            owners: { type: 'ecdsa', accounts: [owner] },
          }),
        },
        [arbitrum.id]: {
          enableData: {
            userSignature: `0x${'22'.repeat(65)}` as Hex,
            hashesAndChainIds: [
              {
                chainId: BigInt(arbitrum.id),
                sessionDigest: userOperationHash,
              },
            ],
            sessionToEnableIndex: 0,
          },
          session: toSession({
            chain: arbitrum,
            owners: {
              type: 'ecdsa',
              accounts: [
                privateKeyToAccount(
                  '0x0000000000000000000000000000000000000000000000000000000000000002',
                ),
              ],
            },
          }),
        },
      },
    }
    test('restoring a prepared intent validates the destination slot on the destination chain', async () => {
      const { composition, context } = fixture()
      const workflows = composition.createAccount(context).workflows
      const account = workflows.getAddress(context, chain)
      const routed = quoteFor({
        account: { evm: { address: account } },
      } as never)

      const intentInput = {
        destination,
        source: { chain, token: target },
        recipient: { kind: 'bare' as const, address: target },
        calls: [],
        signers,
      }
      const original = await workflows.prepareIntent(context, intentInput)
      const prepared = await workflows.reconstructPreparedIntent(context, {
        traceId: 'trace-restore',
        quote: routed,
        quotes: [routed],
        request: original.request,
        approvalInput: original.intentInput,
        intentInput,
      })

      const slot = prepared.signing.requests[1]
      if (slot?.kind !== 'eip712') throw new Error('Expected EIP-712')
      expect(slot.payload.chain.id).toBe(1)
      expect(slot.validationChain.id).toBe(arbitrum.id)
      expect(slot.reuse).toBeUndefined()
    })

    function burnPayload() {
      const burn = {
        to: target,
        value: 0n,
        data: encodeFunctionData({
          abi: oneTimeUseIdPolicyAbi,
          functionName: 'consumeFor',
          args: [17n, 42n],
        }),
      }
      return {
        domain: { chainId: 1, verifyingContract: target },
        primaryType: 'PermitBatchWitnessTransferFrom',
        types: {
          PermitBatchWitnessTransferFrom: [
            { name: 'permitted', type: 'TokenPermissions[]' },
            { name: 'spender', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
            { name: 'mandate', type: 'Mandate' },
          ],
          TokenPermissions: [
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          Token: [
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          Ops: [
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' },
          ],
          Op: [
            { name: 'vt', type: 'bytes32' },
            { name: 'ops', type: 'Ops[]' },
          ],
          Target: [
            { name: 'recipient', type: 'address' },
            { name: 'tokenOut', type: 'Token[]' },
            { name: 'targetChain', type: 'uint256' },
            { name: 'fillExpiry', type: 'uint256' },
          ],
          Mandate: [
            { name: 'target', type: 'Target' },
            { name: 'minGas', type: 'uint128' },
            { name: 'originOps', type: 'Op' },
            { name: 'destOps', type: 'Op' },
            { name: 'q', type: 'bytes32' },
          ],
        },
        message: {
          permitted: [{ token: target, amount: 1n }],
          spender: target,
          nonce: 42n,
          deadline: 9999999999n,
          mandate: {
            target: {
              recipient: target,
              tokenOut: [{ token: target, amount: 1n }],
              targetChain: BigInt(arbitrum.id),
              fillExpiry: 9999999999n,
            },
            minGas: 0n,
            originOps: { vt: zeroHash, ops: [burn] },
            destOps: { vt: zeroHash, ops: [] as (typeof burn)[] },
            q: zeroHash,
          },
        },
      }
    }
    const sourceOnce = {
      ...signers,
      byChain: {
        ...signers.byChain,
        1: {
          ...signers.byChain[1],
          session: toSession({
            chain: { id: 1 } as never,
            owners: { type: 'ecdsa', accounts: [owner] },
            oneTimeUse: { id: 17n },
            policyAddresses: { oneTimeUseId: target },
          }),
        },
      },
    }

    test.each([false, true])(
      'direct signing preserves a committed source burn (same chain: %s)',
      async (sameChain) => {
        const { composition, context, dependencies } = fixture()
        const workflows = composition.createAccount(context).workflows
        const account = workflows.getAddress(context, chain)
        const typedData = burnPayload()
        const signingRequests = [
          eip712Request({ chainId: 1, account, typedData }),
          eip712Request({
            chainId: 1,
            account,
            purpose: 'destinationAuthorization',
            typedData,
          }),
        ]
        const before = structuredClone({
          signingRequests,
          session: sourceOnce.byChain[1].session.oneTimeUse,
        })
        const signed = await workflows.signIntentFromRequests(context, {
          signingRequests,
          targetChain: sameChain ? chain : destination,
          signers: sourceOnce,
        })
        expect(signed.proofs).toHaveLength(2)
        expect(signed.proofs[0]).toMatchObject({
          kind: 'eip712',
          signature: expect.any(Object),
        })
        expect({
          signingRequests,
          session: sourceOnce.byChain[1].session.oneTimeUse,
        }).toEqual(before)
        expect(dependencies.orchestrator.createQuote).not.toHaveBeenCalled()
        expect(dependencies.orchestrator.submitIntent).not.toHaveBeenCalled()
      },
    )

    test.each([
      'absent',
      'wrong policy',
      'wrong id',
      'wrong witness',
      'unstamped witness',
      'value',
      'executor burn',
      'malformed calldata',
      'destination ops only',
      'unsigned mandate',
      'unsigned ops',
    ])(
      'direct signing refuses source one-time use with %s evidence before signing',
      async (fault) => {
        const { composition, context, dependencies } = fixture()
        const workflows = composition.createAccount(context).workflows
        const account = workflows.getAddress(context, chain)
        const typedData = burnPayload()
        const burn = typedData.message.mandate.originOps.ops[0]!
        if (fault === 'absent') typedData.message.mandate.originOps.ops = []
        if (fault === 'wrong policy') burn.to = owner.address as typeof target
        if (fault === 'value') burn.value = 1n
        if (['wrong id', 'wrong witness', 'unstamped witness'].includes(fault))
          burn.data = encodeFunctionData({
            abi: oneTimeUseIdPolicyAbi,
            functionName: 'consumeFor',
            args: [
              fault === 'wrong id' ? 18n : 17n,
              fault === 'unstamped witness'
                ? 0n
                : fault === 'wrong witness'
                  ? 43n
                  : 42n,
            ],
          })
        if (fault === 'executor burn')
          burn.data = encodeFunctionData({
            abi: oneTimeUseIdPolicyAbi,
            functionName: 'consume',
            args: [17n],
          })
        if (fault === 'malformed calldata') burn.data = '0x1234'
        if (fault === 'destination ops only') {
          typedData.message.mandate.destOps.ops = [burn]
          typedData.message.mandate.originOps.ops = []
        }
        if (fault === 'unsigned mandate')
          typedData.types.PermitBatchWitnessTransferFrom =
            typedData.types.PermitBatchWitnessTransferFrom.filter(
              ({ name }) => name !== 'mandate',
            )
        if (fault === 'unsigned ops')
          typedData.types.Op = typedData.types.Op.filter(
            ({ name }) => name !== 'ops',
          )
        const signMessage = vi.spyOn(owner, 'signMessage')
        const signTypedData = vi.spyOn(owner, 'signTypedData')
        try {
          await expect(
            workflows.signIntentFromRequests(context, {
              signingRequests: [
                eip712Request({ chainId: 1, account, typedData }),
              ],
              targetChain: destination,
              signers: sourceOnce,
            }),
          ).rejects.toThrow(/oneTimeUse burn/)
          expect(signMessage).not.toHaveBeenCalled()
          expect(signTypedData).not.toHaveBeenCalled()
          expect(dependencies.orchestrator.createQuote).not.toHaveBeenCalled()
        } finally {
          signMessage.mockRestore()
          signTypedData.mockRestore()
        }
      },
    )

    test('direct signing never treats a repeated source burn as destination burn evidence', async () => {
      const { composition, context } = fixture()
      const workflows = composition.createAccount(context).workflows
      const account = workflows.getAddress(context, chain)
      const typedData = burnPayload()
      await expect(
        workflows.signIntentFromRequests(context, {
          signingRequests: [
            eip712Request({ chainId: 1, account, typedData }),
            eip712Request({
              chainId: 1,
              account,
              purpose: 'destinationAuthorization',
              typedData,
            }),
          ],
          targetChain: destination,
          signers: {
            ...sourceOnce,
            byChain: {
              ...sourceOnce.byChain,
              [arbitrum.id]: {
                ...signers.byChain[arbitrum.id],
                session: toSession({
                  chain: arbitrum,
                  owners: { type: 'ecdsa', accounts: [owner] },
                  oneTimeUse: { id: 17n },
                  policyAddresses: { oneTimeUseId: target },
                }),
              },
            },
          },
        }),
      ).rejects.toThrow(new RegExp(`chain ${arbitrum.id}.*oneTimeUse burn`))
    })

    test('headless signIntent signs both slots of a cross-chain session pair', async () => {
      const { composition, context } = fixture()
      const workflows = composition.createAccount(context).workflows
      const account = workflows.getAddress(context, chain)
      const routed = quoteFor({
        account: { evm: { address: account } },
      } as never)

      const signed = await workflows.signIntentFromRequests(context, {
        signingRequests: routed.signingRequests,
        targetChain: destination,
        signers,
      })

      expect(signed.proofs).toHaveLength(2)
      const [origin, destinationProof] = signed.proofs
      expect(destinationProof).not.toEqual(origin)
    })
  })

  describe('resolving a Solana-origin delivery’s destination calls', () => {
    const destination = toEvmChainReference(baseChain.id)
    const call = { target, value: 0n, data: '0xabcdef' as Hex }

    test('resolves lazy calls against the account and carries its deployment setup', async () => {
      const { composition, context } = fixture()
      const workflows = composition.createAccount(context).workflows
      const address = workflows.getAddress(context, destination)
      const resolve = vi.fn(async () => call)

      const resolved = await workflows.resolveSolanaEvmDestination(context, {
        chain: destination,
        calls: [call, { resolve }],
      })

      expect(resolve).toHaveBeenCalledWith({
        account: address,
        chain: destination,
        config: {},
      })
      expect(resolved.calls).toEqual([call, call])
      expect(resolved.account).toEqual({
        kind: 'erc7579',
        address,
        setupOps: [
          {
            to: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/u),
            data: expect.stringMatching(/^0x[0-9a-f]+$/u),
          },
        ],
      })
    })

    test('takes an EIP-7702 account’s init signature and names its delegation', async () => {
      const base = fixture()
      const context = {
        ...base.context,
        account: resolveAccountConfig(base.context.sdk, {
          account: { type: 'nexus', version: '1.2.0' },
          owners: { type: 'ecdsa', accounts: [owner] },
          eoa: owner,
        }),
      }
      const workflows = base.composition.createAccount(context).workflows

      await expect(
        workflows.resolveSolanaEvmDestination(context, {
          chain: destination,
          calls: [call],
        }),
      ).rejects.toThrow(Eip7702InitSignatureRequiredError)
      const resolved = await workflows.resolveSolanaEvmDestination(context, {
        chain: destination,
        calls: [call],
        eip7702InitSignature: `0x${'11'.repeat(65)}`,
      })
      expect(resolved.account).toEqual({
        kind: 'erc7579',
        address: owner.address,
        setupOps: [
          {
            to: owner.address,
            data: expect.stringMatching(/^0x[0-9a-f]+$/u),
          },
        ],
        delegationContract: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/u),
      })
    })

    // The child's SingleChainOps is an origin authorization with no destination
    // authorization beside it, followed by the delegation the child needs.
    test('signs the child authorization and its delegation with no destination request', async () => {
      const base = fixture()
      const context = {
        ...base.context,
        account: resolveAccountConfig(base.context.sdk, {
          account: { type: 'nexus', version: '1.2.0' },
          owners: { type: 'ecdsa', accounts: [owner] },
          eoa: owner,
        }),
      }
      const workflows = base.composition.createAccount(context).workflows

      const signed = await workflows.signIntentFromRequests(context, {
        signingRequests: [
          eip712Request({ chainId: baseChain.id, account: owner.address }),
          delegationRequest({
            chainId: baseChain.id,
            contract: `0x${'77'.repeat(20)}`,
            account: owner.address,
          }),
        ],
        targetChain: destination,
      })

      expect(signed.proofs).toEqual([
        {
          kind: 'eip712',
          signature: expect.stringMatching(/^0x[0-9a-f]+$/u),
        },
        {
          kind: 'eip7702',
          nonce: 0,
          signature: {
            r: expect.stringMatching(/^0x/u),
            s: expect.stringMatching(/^0x/u),
            yParity: expect.any(Number),
          },
        },
      ])
    })
  })

  test('validateSession records code mismatches before catalog refusals; creation fails first', async () => {
    const base = fixture()
    const canonical = '0x1111111111111111111111111111111111111111' as const
    const copy = '0x2222222222222222222222222222222222222222' as const
    const getCode = vi.fn(async (_context: unknown, address: Address) => ({
      code: address === canonical ? ('0x1234' as const) : ('0x5678' as const),
    }))
    const composition = createCoreComposition(base.context.sdk, {
      ...base.dependencies,
      rpc: {
        forChain: () => ({ ...base.dependencies.rpc.forChain(), getCode }),
      },
    })
    const definition = {
      chain: baseChain,
      owners: { type: 'ecdsa' as const, accounts: [owner] },
      policyAddresses: {
        universalAction: canonical,
        universalActionCopies: [copy],
      },
    }
    const result = await composition.project.validateSession(definition)
    expect(result.refusals.map(({ code }) => code)).toEqual([
      'UNIVERSAL_ACTION_COPY_CODE_MISMATCH',
      'WRAPPED_NATIVE_TOKEN_UNSERVED',
    ])
    expect(getCode).toHaveBeenCalledTimes(2)
    await expect(
      composition.project.createSession(definition),
    ).rejects.toMatchObject({ code: result.refusals[0].code })
  })

  test('online session creation and validation share served catalog and exact deployed-copy checks', async () => {
    const base = fixture()
    const getCode = vi.fn(async () => ({ code: '0x1234' as const }))
    const getChainCatalog = vi.fn(
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
            settlement: SETTLEMENT_CATALOG[baseChain.id],
          },
          [arbitrum.id]: {
            name: 'Arbitrum',
            testnet: false,
            supportedTokens: 'all',
            settlement: SETTLEMENT_CATALOG[arbitrum.id],
          },
        }),
    )
    const composition = createCoreComposition(base.context.sdk, {
      ...base.dependencies,
      rpc: {
        forChain: () => ({ ...base.dependencies.rpc.forChain(), getCode }),
      },
      orchestrator: { ...base.orchestrator, getChainCatalog },
    })
    const definition = {
      chain: baseChain,
      owners: { type: 'ecdsa' as const, accounts: [owner] },
      account: owner.address,
      crossChainPermits: [
        {
          from: {
            chain: baseChain,
            token: SETTLEMENT_CATALOG[baseChain.id].cctp!.usdc,
            maxAmount: 100n,
          },
          to: {
            chain: arbitrum,
            token: SETTLEMENT_CATALOG[arbitrum.id].cctp!.usdc,
          },
          settlementLayers: ['CCTP' as const],
        },
      ],
    }
    const session = await composition.project.createSession(definition)
    const validation = await composition.project.validateSession(definition)
    expect(validation.refusals).toEqual([])
    expect(validation.access).toEqual(session.access)
    expect(session.settlementLayers).toEqual(['CCTP'])
    expect(getCode).toHaveBeenCalled()
    expect(getChainCatalog).toHaveBeenCalledTimes(2)
    getCode.mockRejectedValueOnce(new Error('RPC unavailable'))
    await expect(
      composition.project.validateSession(definition),
    ).rejects.toThrow('RPC unavailable')
    expect(getChainCatalog).toHaveBeenCalledTimes(2)
  })

  test('session details use coherent reads and require budget-reset consent', async () => {
    const base = fixture()
    const readContract = vi.fn(async () => 7n)
    const multicall = vi.fn(async () => [{ result: 7n }, { result: true }])
    const composition = createCoreComposition(base.context.sdk, {
      ...base.dependencies,
      rpc: {
        forChain: () =>
          ({
            ...base.dependencies.rpc.forChain(),
            readContract,
            multicall,
          }) as RpcReadPort,
      },
    })
    const session = {
      ...toSession({
        chain: baseChain,
        owners: { type: 'ecdsa', accounts: [owner] },
      }),
      lifetimeBudget: true as const,
    }
    const workflows = composition.createAccount(base.context).workflows
    await expect(
      workflows.getSessionDetails(base.context, [session]),
    ).rejects.toThrow('already enabled')
    expect(multicall).toHaveBeenCalledOnce()
    expect(readContract).not.toHaveBeenCalled()
    const details = await workflows.getSessionDetails(base.context, [session], {
      allowBudgetReset: true,
    })
    expect(details.nonces).toEqual([7n])
    expect(readContract).toHaveBeenCalledOnce()
    multicall.mockResolvedValueOnce([])
    await expect(
      workflows.getSessionDetails(base.context, [session]),
    ).rejects.toThrow('Could not read')
    expect(readContract).toHaveBeenCalledOnce()
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
