import { privateKeyToAccount } from 'viem/accounts'
import { mainnet, optimism } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { toEvmChainReference } from '../chains/caip2'
import type { LegacyAccountConfig } from '../config/legacy'
import { resolveAccountConfig, resolveSdkConfig } from '../config/resolve'
import type { AccountInvocationContext } from '../config/resolved'
import { QuoteNotInPreparedTransactionError } from '../errors/execution'
import type { RhinestoneAccountConfig } from '../index'
import { RhinestoneSDK } from '../index'
import { ecdsaSignerId } from '../modules/validators/signer-id'
import type { PreparedTransactionData } from '../transactions/intents/types'
import {
  adaptTransaction,
  authorizationChains,
  createAccountFacade,
} from './account'
import type { CoreComposition } from './compose-types'
import type { AdaptedSignerSelection } from './signer-selection'

const owner = privateKeyToAccount(`0x${'02'.repeat(32)}`)
const recipientAddress = '0x0000000000000000000000000000000000000010' as const

function invocationContext(): AccountInvocationContext<
  LegacyAccountConfig<unknown>
> {
  const sdk = resolveSdkConfig({ apiKey: 'offline' })
  return {
    method: 'prepare-intent',
    sdk,
    account: resolveAccountConfig(sdk, {
      owners: { type: 'ecdsa', accounts: [owner] },
    }),
    compatibilityConfig: {} as LegacyAccountConfig<unknown>,
  }
}

describe('account instance surface', () => {
  test('exposes sendUserOperation and no sendTransaction convenience method', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const account = await sdk.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [owner],
      },
    })

    expect(Reflect.has(account, 'sendUserOperation')).toBe(true)
    expect(Reflect.has(account, 'sendTransaction')).toBe(false)
  })
})

describe('account config compatibility snapshot', () => {
  test('retains account-config keys, nested aliasing, and auth exposure', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const owners: RhinestoneAccountConfig['owners'] = {
      type: 'ecdsa',
      accounts: [owner],
    }
    const provider: RhinestoneAccountConfig['account'] = {
      type: 'nexus',
      version: '1.2.0',
    }
    const input: RhinestoneAccountConfig = { account: provider, owners }
    const account = await sdk.createAccount(input)

    // Account-config keys survive by value.
    expect(account.config.account).toEqual(provider)
    expect(account.config.owners).toEqual(owners)

    // Shallow copy: nested references are aliased, so later method calls (which
    // re-read the live config) observe post-construction mutations to them.
    expect(account.config.owners).toBe(owners)
    expect(account.config.account).toBe(provider)

    // SDK-scoped auth is exposed on the account config snapshot.
    expect('_authProvider' in account.config).toBe(true)
  })

  test('rebuilds configured clients from live SDK compatibility fields', async () => {
    const requests: { url: string; headers: Headers }[] = []
    const fetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString()
        const headers = new Headers(
          input instanceof Request ? input.headers : init?.headers,
        )
        requests.push({ url, headers })
        if (url.includes('/portfolio')) {
          return new Response(JSON.stringify({ portfolio: [] }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const body = JSON.parse(String(init?.body)) as { id: number }
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x' }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      },
    )
    vi.stubGlobal('fetch', fetch)
    try {
      const sdk = new RhinestoneSDK({
        apiKey: 'offline',
        provider: {
          type: 'custom',
          urls: { 1: 'https://provider-one.test' },
        },
      })
      const account = await sdk.createAccount({
        owners: { type: 'ecdsa', accounts: [owner] },
      })
      const live = account.config as unknown as LegacyAccountConfig<unknown>

      await account.isDeployed(mainnet)
      live.provider = {
        type: 'custom',
        urls: { 1: 'https://provider-two.test' },
      }
      await account.isDeployed(mainnet)

      live.endpointUrl = 'https://orchestrator-two.test/base'
      live.headers = { 'x-live-config': 'true' }
      await account.getPortfolio()

      expect(requests.map(({ url }) => url)).toEqual(
        expect.arrayContaining([
          'https://provider-one.test/',
          'https://provider-two.test/',
        ]),
      )
      const orchestratorRequest = requests.find(({ url }) =>
        url.startsWith('https://orchestrator-two.test/base/accounts/'),
      )
      expect(orchestratorRequest?.headers.get('x-live-config')).toBe('true')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('account boundary adapters', () => {
  test('forwards signer and independent quote/factor selections', async () => {
    const sdk = resolveSdkConfig({ apiKey: 'offline' })
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
    }
    const signMessage = vi.fn(
      async (
        _context: unknown,
        _input: { signers?: AdaptedSignerSelection },
      ) => ({
        signature: '0x12' as const,
        transcript: {
          planKind: 'account-message' as const,
          payloadId: '0x' as const,
          stages: [],
        },
      }),
    )
    const signTypedData = vi.fn(
      async (
        _context: unknown,
        _input: { signers?: AdaptedSignerSelection },
      ) => ({
        signature: '0x34' as const,
        transcript: {
          planKind: 'account-typed-data' as const,
          payloadId: '0x' as const,
          stages: [],
        },
      }),
    )
    const signIntentFromSignData = vi.fn(
      async (
        _context: unknown,
        _input: { signers?: AdaptedSignerSelection },
      ) => ({
        originSignatures: [],
        destinationSignature: '0x56' as const,
        targetExecutionSignature: undefined,
        transcript: {
          planKind: 'intent-full' as const,
          payloadId: '0x' as const,
          stages: [],
        },
      }),
    )
    const reconstructPreparedIntent = vi.fn(async (_context, input) => ({
      ...input,
      input: input.intentInput,
      accountChain: toEvmChainReference(1),
      signing: {} as never,
    }))
    const signIntentAsOwner = vi.fn(async () => ({
      intentId: 'alternate',
      kind: 'ecdsa' as const,
      signer: owner.address,
      origin: [],
    }))
    const prepareUserOperation = vi.fn(async (_context, input) => ({
      input,
      operation: {} as never,
      hash: `0x${'66'.repeat(32)}` as const,
      signing: {} as never,
    }))
    const workflows = {
      signMessage,
      signTypedData,
      signIntentFromSignData,
      reconstructPreparedIntent,
      signIntentAsOwner,
      prepareUserOperation,
    }
    const facade = createAccountFacade(compatibilityConfig, {
      config: sdk,
      project: {} as never,
      createAccount: (context) => ({
        context,
        workflows: workflows as never,
      }),
    } satisfies CoreComposition<LegacyAccountConfig<unknown>>)
    const selected = privateKeyToAccount(`0x${'03'.repeat(32)}`)
    const signers = {
      type: 'owner' as const,
      kind: 'ecdsa' as const,
      accounts: [selected],
    }
    const typedData = {
      domain: { chainId: 1 },
      types: { Test: [{ name: 'value', type: 'uint256' }] },
      primaryType: 'Test',
      message: { value: 1n },
    } as const

    await facade.signMessage('hello', mainnet, signers)
    await facade.signTypedData(typedData, mainnet, signers)
    await facade.signIntent(
      { origin: [typedData], destination: typedData },
      mainnet,
      signers,
    )

    for (const call of [
      signMessage.mock.calls[0]?.[1],
      signTypedData.mock.calls[0]?.[1],
      signIntentFromSignData.mock.calls[0]?.[1],
    ]) {
      expect(call?.signers).toMatchObject({
        kind: 'owner',
        signerIds: [`ecdsa:${selected.address.toLowerCase()}`],
      })
    }

    const best = quoteFixture('best')
    const alternate = quoteFixture('alternate')
    const prepared = {
      quotes: {
        traceId: 'trace',
        best,
        all: [best, alternate],
      },
      intentInput: {},
      transaction: { chain: mainnet, calls: [] },
    } satisfies PreparedTransactionData
    await facade.signTransaction(prepared, {
      owner,
      intentId: 'alternate',
      validatorId: 7,
    })

    expect(reconstructPreparedIntent.mock.calls[0]?.[1].quote.intentId).toBe(
      'alternate',
    )
    expect(signIntentAsOwner).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        signerId: `ecdsa:${owner.address.toLowerCase()}`,
        validatorId: 7,
      },
    )

    await facade.prepareUserOperation({
      chain: mainnet,
      calls: [],
      signers,
    })
    expect(prepareUserOperation.mock.calls[0]?.[1]).not.toHaveProperty(
      'signers',
    )
    await expect(
      facade.prepareUserOperation({
        chain: mainnet,
        calls: [],
        signers: {
          type: 'experimental_session',
          session: { chain: mainnet } as never,
        },
      }),
    ).rejects.toThrow('No account found')
  })

  test('rejects an intent id that is not in the prepared transaction', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
    })
    const quote = {
      intentId: 'best',
      expiresAt: 1,
      estimatedFillTime: { seconds: 1 },
      settlementLayer: 'SAME_CHAIN' as const,
      signData: {
        origin: [],
        destination: {
          domain: {},
          types: {},
          primaryType: 'Test',
          message: {},
        },
      },
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
    }
    const prepared = {
      quotes: { traceId: 'trace', best: quote, all: [quote] },
      intentInput: {},
      transaction: { chain: mainnet, calls: [] },
    } satisfies PreparedTransactionData

    expect(() =>
      account.getTransactionMessages(prepared, { intentId: 'missing' }),
    ).toThrowError(QuoteNotInPreparedTransactionError)
  })

  test('rebuilds UserOperations from current public data and live owners', async () => {
    const sdk = resolveSdkConfig({ apiKey: 'offline' })
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
    }
    const replacementOwner = privateKeyToAccount(`0x${'03'.repeat(32)}`)
    const initialHash = `0x${'44'.repeat(32)}` as const
    const rebuiltHash = `0x${'55'.repeat(32)}` as const
    const submittedHash = `0x${'66'.repeat(32)}` as const
    const signedValue = `0x${'77'.repeat(64)}1b` as const
    const replacementSignature = `0x${'88'.repeat(64)}1b` as const
    const operation = {
      sender: owner.address,
      nonce: 0n,
      callData: '0x' as const,
      callGasLimit: 1n,
      verificationGasLimit: 2n,
      preVerificationGas: 3n,
      maxFeePerGas: 4n,
      maxPriorityFeePerGas: 5n,
      signature: '0x' as const,
    }
    const prepareUserOperation = vi.fn(async (_context, input) => ({
      input,
      operation,
      hash: initialHash,
      signing: {} as never,
    }))
    const reconstructPreparedUserOperation = vi.fn(
      async (invocationContext, input) => {
        expect(invocationContext.account.owners).toMatchObject({
          owners: [{ signerId: ecdsaSignerId(replacementOwner) }],
        })
        return {
          input: { chain: input.chain, calls: [] },
          operation: input.operation,
          hash: rebuiltHash,
          signing: { owner: ecdsaSignerId(replacementOwner) } as never,
        }
      },
    )
    const signUserOperation = vi.fn(async (_context, prepared) => ({
      prepared,
      operation: { ...prepared.operation, signature: signedValue },
      signature: signedValue,
      transcript: {
        planKind: 'user-operation' as const,
        payloadId: prepared.hash,
        stages: [],
      },
    }))
    const reconstructSignedUserOperation = vi.fn(async (_context, input) => ({
      prepared: {
        input: { chain: input.chain, calls: [] },
        operation: input.operation,
        hash: rebuiltHash,
        signing: {} as never,
      },
      operation: input.operation,
      signature: input.signature,
      transcript: {
        planKind: 'user-operation' as const,
        payloadId: rebuiltHash,
        stages: [],
      },
    }))
    const submitUserOperation = vi.fn(async (_context, signed) => ({
      type: 'userop' as const,
      chain: signed.prepared.input.chain,
      hash: submittedHash,
    }))
    const facade = createAccountFacade(compatibilityConfig, {
      config: sdk,
      project: {} as never,
      createAccount: (context) => ({
        context,
        workflows: {
          prepareUserOperation,
          reconstructPreparedUserOperation,
          signUserOperation,
          reconstructSignedUserOperation,
          submitUserOperation,
        } as never,
      }),
    })
    const prepared = await facade.prepareUserOperation({
      chain: mainnet,
      calls: [],
    })

    prepared.userOperation.callGasLimit = 99n
    compatibilityConfig.owners = {
      type: 'ecdsa',
      accounts: [replacementOwner],
    }
    const signed = await facade.signUserOperation(prepared)

    expect(reconstructPreparedUserOperation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: expect.objectContaining({ callGasLimit: 99n }),
      }),
    )
    expect(signUserOperation.mock.calls[0]?.[1]).toMatchObject({
      hash: rebuiltHash,
      signing: { owner: ecdsaSignerId(replacementOwner) },
    })
    expect(signed.hash).toBe(initialHash)
    expect(signed.userOperation.signature).toBe('0x')

    signed.userOperation.callGasLimit = 100n
    signed.signature = replacementSignature
    await facade.submitUserOperation(signed)

    expect(reconstructSignedUserOperation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: expect.objectContaining({ callGasLimit: 100n }),
        signature: replacementSignature,
      }),
    )
    expect(submitUserOperation).toHaveBeenCalledOnce()
  })

  test('projects smart-account recipients instead of dropping them', () => {
    const transaction = adaptTransaction(invocationContext(), {
      chain: mainnet,
      calls: [],
      recipient: {
        account: { type: 'nexus', version: '1.2.0' },
        owners: { type: 'ecdsa', accounts: [owner] },
      },
    })

    expect(transaction.recipient).toMatchObject({
      accountType: 'ERC7579',
      setupOps: [expect.objectContaining({ to: expect.any(String) })],
    })
    expect(transaction.recipient?.address).not.toBe(recipientAddress)

    expect(
      adaptTransaction(invocationContext(), {
        chain: mainnet,
        calls: [],
        recipient: recipientAddress,
      }).recipient,
    ).toEqual({
      address: recipientAddress,
      accountType: 'EOA',
      setupOps: [],
    })
  })

  test('includes source and destination authorization chains once', () => {
    const transaction = adaptTransaction(invocationContext(), {
      sourceChains: [mainnet, optimism],
      targetChain: optimism,
      calls: [],
    })

    expect(authorizationChains(transaction)).toEqual([
      toEvmChainReference(mainnet.id),
      toEvmChainReference(optimism.id),
    ])
  })

  test('forwards customDeadline for same-chain intents', () => {
    const customDeadline = 9_999_999_999
    const transaction = adaptTransaction(invocationContext(), {
      chain: mainnet,
      calls: [],
      customDeadline,
    })

    expect(transaction.options?.customDeadline).toBe(customDeadline)
  })
})

function quoteFixture(intentId: string) {
  return {
    intentId,
    expiresAt: 1,
    estimatedFillTime: { seconds: 1 },
    settlementLayer: 'SAME_CHAIN' as const,
    signData: {
      origin: [],
      destination: {
        domain: {},
        types: {},
        primaryType: 'Test',
        message: {},
      },
    },
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
  }
}
