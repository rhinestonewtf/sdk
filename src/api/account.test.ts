import { privateKeyToAccount } from 'viem/accounts'
import { mainnet, optimism } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import {
  quote as caucasusQuote,
  delegationRequest,
  eip712Request,
  personalSignRequest,
  publicQuote,
} from '../../test/utils/caucasus'
import { asSwigNamespace, locateSwig } from '../accounts/solana/address'
import { formatCaip2, parseCaip2, toEvmChainReference } from '../chains/caip2'
import {
  hyperCorePerp,
  solanaAddress,
  solanaDevnet,
  solanaMainnet,
} from '../chains/non-evm'
import type { NormalizedIntentInput } from '../clients/orchestrator/normalized'
import { projectCompatibleIntentInput } from '../clients/orchestrator/normalized'
import type {
  HyperCoreOrderAction,
  Quote,
  SigningRequest,
} from '../clients/orchestrator/public'
import type {
  OrchestratorIntentRequest,
  OrchestratorQuote,
} from '../clients/orchestrator/types'
import type { LegacyAccountConfig } from '../config/legacy'
import { resolveAccountConfig, resolveSdkConfig } from '../config/resolve'
import type { AccountInvocationContext } from '../config/resolved'
import {
  AccountVmNotConfiguredError,
  ManagedSolanaAccountNotSupportedError,
  UnsupportedAccountCapabilityError,
} from '../errors/capability'
import {
  InvalidPreparedTransactionError,
  InvalidSolanaTransactionArtifactError,
  QuoteNotInPreparedTransactionError,
  SignerNotSupportedError,
  UnsupportedSigningRequestError,
} from '../errors/execution'
import type { EvmAccountConfig, RhinestoneAccountConfig } from '../index'
import { RhinestoneSDK } from '../index'
import { ecdsaSignerId } from '../modules/validators/signer-id'
import { SOCIAL_RECOVERY_VALIDATOR_ADDRESS } from '../modules/validators/social-recovery'
import type { IntentRecipientProjection } from '../transactions/intents/account'
import { projectPreparedBinding } from '../transactions/intents/compatibility'
import {
  buildSolanaIntentRequest,
  reconstructSolanaIntent,
} from '../transactions/intents/solana'
import type {
  PreparedTransactionData,
  SignedTransactionData,
} from '../transactions/intents/types'
import {
  adaptTransaction,
  createAccountFacade,
  normalizeTransaction,
} from './account'
import type { CoreComposition } from './compose-types'
import type { AdaptedSignerSelection } from './signer-selection'

const owner = privateKeyToAccount(`0x${'02'.repeat(32)}`)
const guardian = privateKeyToAccount(`0x${'03'.repeat(32)}`)
const recipientAddress = '0x0000000000000000000000000000000000000010' as const
const normalizedIntentInput = {
  account: { address: recipientAddress, accountType: 'ERC7579' },
  destinationChainId: mainnet.id,
  destinationExecutions: [],
  tokenRequests: [],
  options: {},
} satisfies NormalizedIntentInput
const serializedIntentInput = projectCompatibleIntentInput(
  normalizedIntentInput,
)
// The Caucasus request a prepared artifact carries. Only its round trip through
// `PreparedTransactionData.request` matters here, so it stays minimal.
const intentRequest = {
  account: { evm: { type: 'erc7579', address: recipientAddress } },
  destination: {
    vm: 'evm',
    chainId: formatCaip2(mainnet.id),
    tokenRequests: [],
  },
} satisfies OrchestratorIntentRequest
const preparedRequest = projectPreparedBinding(intentRequest)

/** Narrows a projected recipient to the configured-account arm. */
function accountRecipient(recipient: IntentRecipientProjection | undefined) {
  return recipient?.kind === 'account' ? recipient : undefined
}

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
      evm: {
        owners: {
          type: 'ecdsa',
          accounts: [owner],
        },
      },
    })

    expect(Reflect.has(account, 'sendUserOperation')).toBe(true)
    expect(Reflect.has(account, 'sendTransaction')).toBe(false)
  })

  test('rejects guardians on the intent and ERC-1271 paths', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const account = await sdk.createAccount({
      evm: {
        owners: { type: 'ecdsa', accounts: [owner] },
        recovery: { guardians: [guardian] },
      },
    })
    const signers = { type: 'guardians' as const, guardians: [guardian] }

    // The social recovery validator only validates UserOperations, so these
    // must fail before any network call rather than produce a dead signature.
    await expect(
      account.prepareTransaction({
        chain: mainnet,
        calls: [{ to: guardian.address, value: 0n, data: '0x' }],
        signers,
      }),
    ).rejects.toThrow(SignerNotSupportedError)
    await expect(
      account.signMessage('hello', mainnet, signers),
    ).rejects.toThrow(SignerNotSupportedError)
  })

  // The declarative `hyperCore` option is resolved inside `prepareTransaction`
  // and nowhere else, because the quote's signing requests register an agent
  // derived from the action's bytes — so the action has to be concrete before
  // the quote, and this is the seam that makes it so.
  test('resolves a HyperCore option against Hyperliquid before quoting', async () => {
    // The stub is the synchronisation point: the quote that follows never
    // completes offline, and waiting on it would only measure a retry budget.
    let sawRead: (body: unknown) => void = () => {}
    const read = new Promise((resolve) => {
      sawRead = resolve
    })
    const sdk = new RhinestoneSDK({
      apiKey: 'offline',
      hyperliquid: {
        fetch: async (_url, init) => {
          sawRead(JSON.parse(String(init?.body ?? '{}')))
          return new Response(
            JSON.stringify([
              { universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }] },
              [{ markPx: '64250.5' }],
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        },
      },
    })
    const account = await sdk.createAccount({
      evm: {
        owners: { type: 'ecdsa', accounts: [owner] },
      },
    })

    account
      .prepareTransaction({
        sourceChains: [mainnet],
        targetChain: hyperCorePerp,
        hyperCore: {
          openPerp: { asset: 'BTC', direction: 'long', notionalUsd: 100 },
        },
      })
      .catch(() => {})

    expect(await read).toEqual({ type: 'metaAndAssetCtxs' })
  })
})

describe('managed Solana account construction', () => {
  test('derives a stable development wallet offline beside the managed EVM account', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    try {
      const sdk = new RhinestoneSDK({
        apiKey: 'offline',
        endpointUrl: 'https://dev.v1.orchestrator.rhinestone.dev',
        useDevContracts: true,
      })
      const config = {
        evm: { owners: { type: 'ecdsa' as const, accounts: [owner] } },
        solana: { owner: { type: 'ecdsa' as const, account: owner } },
      }
      const first = await sdk.createAccount(config)
      const second = await sdk.createAccount(config)

      expect(first.getAddress('solana')).toBe(second.getAddress('solana'))
      expect(() => solanaAddress(first.getAddress('solana'))).not.toThrow()
      expect(first.getAddress('evm')).toMatch(/^0x[0-9a-fA-F]{40}$/u)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('rejects production, Solana-only, and widened unsupported owners', async () => {
    const managed = {
      owner: { type: 'ecdsa' as const, account: owner },
    }
    await expect(
      new RhinestoneSDK({ apiKey: 'offline' }).createAccount({
        evm: { owners: { type: 'ecdsa', accounts: [owner] } },
        solana: managed,
      }),
    ).rejects.toThrow(/useDevContracts/)
    await expect(
      new RhinestoneSDK({
        apiKey: 'offline',
        useDevContracts: true,
      }).createAccount({
        evm: { owners: { type: 'ecdsa', accounts: [owner] } },
        solana: managed,
      }),
    ).rejects.toThrow(/dev\.v1\.orchestrator\.rhinestone\.dev/)
    await expect(
      new RhinestoneSDK({
        apiKey: 'offline',
        endpointUrl: 'https://v1.orchestrator.rhinestone.dev',
        useDevContracts: true,
      }).createAccount({
        evm: { owners: { type: 'ecdsa', accounts: [owner] } },
        solana: managed,
      }),
    ).rejects.toThrow(/dev\.v1\.orchestrator\.rhinestone\.dev/)
    await expect(
      new RhinestoneSDK({
        apiKey: 'offline',
        endpointUrl: 'https://dev.v1.orchestrator.rhinestone.dev',
        useDevContracts: true,
      }).createAccount({ solana: managed } as never),
    ).rejects.toThrow(/paired with a managed EVM/)
    await expect(
      new RhinestoneSDK({
        apiKey: 'offline',
        useDevContracts: true,
      }).createAccount({
        evm: { owners: { type: 'ecdsa', accounts: [owner] } },
        solana: { owner: { type: 'passkey', account: {} }, nonce: 1n },
      } as never),
    ).rejects.toThrow(/unknown managed Solana field `nonce`/)
  })
})

describe('managed Solana account facade', () => {
  const mint = solanaAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
  const recipient = solanaAddress('11111111111111111111111111111112')
  const message = 'ab'.repeat(32)
  // The Swig the facade derives for the managed account, which every signing
  // request the quote carries has to name.
  const swig = locateSwig(asSwigNamespace('dev-v1'), owner.address)

  const swigLeg = {
    vm: 'svm' as const,
    chainId: solanaDevnet.caip2,
    account: {
      wallet: swig.wallet,
      swigAccount: swig.swig,
      authority: { kind: 'secp256k1' as const, address: owner.address },
    },
  }

  /** The one spend authorization a Solana-origin quote asks for. */
  function spendRequest(): SigningRequest {
    return personalSignRequest({
      chainId: solanaDevnet.caip2,
      wallet: swig.wallet,
      swigAccount: swig.swig,
      authority: owner.address,
      message,
      expiresAtSlot: '123',
    })
  }

  function quote(intentId: string): OrchestratorQuote {
    const costEntry = {
      chainId: solanaDevnet.caip2,
      tokenAddress: mint,
      symbol: 'USDC',
      decimals: 6,
      price: { usd: 1 },
      amount: 100n,
    }
    return {
      ...caucasusQuote({
        intentId,
        expiresAt: 2_000_000_000,
        signingRequests: [spendRequest()],
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
      estimatedFillTime: { seconds: 1 },
      plan: { source: [swigLeg], destination: swigLeg, deployments: [] },
    }
  }

  function fixture() {
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
      useDevContracts: true,
    }
    const best = quote('best')
    const alternate = quote('alternate')
    const prepareSolanaIntent = vi.fn(async (input) => ({
      traceId: 'prepare-trace',
      input,
      ...buildSolanaIntentRequest(input),
      quote: best,
      quotes: [best, alternate],
    }))
    const reconstruct = vi.fn(reconstructSolanaIntent)
    const signSolanaIntent = vi.fn(async ({ prepared, owner: signer }) => ({
      prepared,
      signature: await signer.signMessage({ message }),
    }))
    const submitSolanaIntent = vi.fn(async ({ prepared }) => ({
      type: 'intent' as const,
      traceId: 'submit-trace',
      intentId: prepared.quote.intentId,
      sourceChains: [792703810],
      targetChain: 792703810,
    }))
    const waitForIntentStatus = vi.fn(async (_context, intentId: string) => ({
      traceId: `status-${intentId}`,
      intentId,
      purpose: 'execution' as const,
      status: 'COMPLETED' as const,
      operations: [],
    }))
    const getAddress = vi.fn(() => owner.address)
    const getEligibleEvmSourceChains = vi.fn(async () => {
      throw new Error('catalog must not be read')
    })
    const workflows = {
      getAddress,
      getEligibleEvmSourceChains,
      prepareSolanaIntent,
      reconstructSolanaIntent: reconstruct,
      signSolanaIntent,
      submitSolanaIntent,
      waitForIntentStatus,
    }
    const facade = createAccountFacade(
      compatibilityConfig,
      {
        evm: compatibilityConfig as EvmAccountConfig,
        solana: { owner: { type: 'ecdsa', account: owner } },
      },
      {
        config: resolveSdkConfig({ apiKey: 'offline', useDevContracts: true }),
        project: {} as never,
        createAccount: (context) => ({
          context,
          workflows: workflows as never,
        }),
      },
    )
    return {
      facade,
      workflows,
      best,
      alternate,
      recipient: facade.getAddress('solana'),
    }
  }

  function transaction() {
    return {
      chain: solanaDevnet,
      tokenRequests: [{ address: mint, amount: 100n }] as [
        { address: typeof mint; amount: bigint },
      ],
      recipient,
      sponsored: false as const,
    }
  }

  test('dispatches prepare, messages, sign, submit, and status entirely through the Solana workflow', async () => {
    const { facade, workflows } = fixture()
    const prepared = await facade.prepareTransaction(transaction())

    expect(workflows.prepareSolanaIntent).toHaveBeenCalledOnce()
    expect(workflows.getEligibleEvmSourceChains).not.toHaveBeenCalled()
    expect(facade.getTransactionMessages(prepared)).toEqual([spendRequest()])
    const signed = await facade.signTransaction(prepared)
    expect(workflows.signSolanaIntent).toHaveBeenCalledOnce()
    const submitted = await facade.submitTransaction(signed)
    expect(submitted).toEqual({
      type: 'intent',
      id: 'best',
      traceId: 'submit-trace',
      sourceChains: [792703810],
      targetChain: 792703810,
    })
    await expect(facade.waitForExecution(submitted)).resolves.toMatchObject({
      traceId: 'status-best',
      status: 'COMPLETED',
    })
    expect(workflows.waitForIntentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'wait-for-execution' }),
      'best',
    )
  })

  test.each([solanaMainnet, solanaDevnet])(
    'defaults an existing EVM-origin Solana delivery to the managed wallet without mutating the request ($caip2)',
    async (targetChain) => {
      const { facade, workflows, recipient: managedWallet } = fixture()
      const request = {
        sourceChains: [mainnet],
        targetChain,
        tokenRequests: [{ address: mint, amount: 100n }],
      }
      const evmQuote = quoteFixture('evm')
      const prepareIntent = vi.fn(async (_context, input) => ({
        traceId: 'evm-trace',
        input,
        request: intentRequest,
        normalized: normalizedIntentInput,
        quote: evmQuote,
        quotes: [evmQuote],
        signing: {} as never,
        accountChain: toEvmChainReference(mainnet.id),
      }))
      Object.assign(workflows, { prepareIntent })

      const prepared = await facade.prepareTransaction(request)

      expect(request).not.toHaveProperty('recipient')
      expect(prepared.transaction).toMatchObject({ recipient: managedWallet })
      expect(prepareIntent.mock.calls[0]?.[1]).toMatchObject({
        recipient: { address: managedWallet },
      })
      expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
      expect(workflows.getEligibleEvmSourceChains).not.toHaveBeenCalled()
    },
  )

  test.each([solanaMainnet, solanaDevnet])(
    'lets an explicit recipient win over the managed wallet on $caip2',
    async (targetChain) => {
      const { facade, workflows, recipient: managedWallet } = fixture()
      const evmQuote = quoteFixture('evm')
      const prepareIntent = vi.fn(async (_context, input) => ({
        traceId: 'evm-trace',
        input,
        request: intentRequest,
        normalized: normalizedIntentInput,
        quote: evmQuote,
        quotes: [evmQuote],
        signing: {} as never,
        accountChain: toEvmChainReference(mainnet.id),
      }))
      Object.assign(workflows, { prepareIntent })

      await facade.prepareTransaction({
        sourceChains: [mainnet],
        targetChain,
        tokenRequests: [{ address: mint, amount: 100n }],
        recipient,
      })

      expect(prepareIntent.mock.calls[0]?.[1]).toMatchObject({
        destination: parseCaip2(targetChain.caip2),
        recipient: { address: recipient },
      })
      expect(recipient).not.toBe(managedWallet)
    },
  )

  test('selects an alternate quote consistently for messages, signing, and submission', async () => {
    const { facade, workflows } = fixture()
    const prepared = await facade.prepareTransaction(transaction())

    expect(
      facade.getTransactionMessages(prepared, { intentId: 'alternate' }),
    ).toEqual([spendRequest()])
    const signed = await facade.signTransaction(prepared, {
      intentId: 'alternate',
    })
    expect(signed.quote.intentId).toBe('alternate')
    await expect(facade.submitTransaction(signed)).resolves.toMatchObject({
      id: 'alternate',
    })
    expect(
      workflows.signSolanaIntent.mock.calls[0]?.[0].prepared.quote.intentId,
    ).toBe('alternate')
    expect(
      workflows.submitSolanaIntent.mock.calls[0]?.[0].prepared.quote.intentId,
    ).toBe('alternate')
  })

  test('snapshots the request before asynchronous preparation', async () => {
    const { facade, workflows } = fixture()
    let release = () => {}
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    workflows.prepareSolanaIntent.mockImplementationOnce(async (input) => {
      await paused
      return {
        traceId: 'prepare-trace',
        input,
        ...buildSolanaIntentRequest(input),
        quote: quote('best'),
        quotes: [quote('best')],
      }
    })
    const request = {
      ...transaction(),
      appFees: { feeBps: 25 },
      protocolFees: { feeBps: 50 },
    }
    const preparing = facade.prepareTransaction(request)
    request.tokenRequests[0]!.amount = 999n
    request.recipient = solanaAddress('11111111111111111111111111111113')
    request.appFees.feeBps = 75
    request.protocolFees.feeBps = 100
    release()

    const prepared = await preparing
    expect(prepared.transaction).toMatchObject({
      recipient,
      tokenRequests: [{ address: mint, amount: 100n }],
      appFees: { feeBps: 25 },
      protocolFees: { feeBps: 50 },
    })
    expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
      action: {
        kind: 'transfer',
        mint,
        amount: 100n,
        delivery: { kind: 'same-chain', recipient },
      },
      appFees: { feeBps: 25 },
      protocolFees: { feeBps: 50 },
    })
  })

  test.each([
    ['calls', []],
    ['sourceChains', [mainnet]],
    ['targetChain', mainnet],
    ['sourceAssets', { [mainnet.id]: [owner.address] }],
    ['signers', { type: 'owner', accounts: [owner] }],
    ['hyperCore', {}],
    ['gasLimit', 1n],
    ['nonce', 1n],
  ])(
    'rejects widened `%s` before quote, sign, or submit effects',
    async (field, value) => {
      const { facade, workflows } = fixture()
      const widened = { ...transaction(), [field]: value }

      await expect(facade.prepareTransaction(widened as never)).rejects.toThrow(
        UnsupportedAccountCapabilityError,
      )
      expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()

      const clean = await facade.prepareTransaction(transaction())
      const prepared = { ...clean, transaction: widened }
      await expect(facade.signTransaction(prepared as never)).rejects.toThrow(
        UnsupportedAccountCapabilityError,
      )
      expect(workflows.signSolanaIntent).not.toHaveBeenCalled()

      const signature = await owner.signMessage({ message })
      await expect(
        facade.submitTransaction({
          ...prepared,
          quote: clean.quotes.best,
          proofs: [{ kind: 'personalSign', signature }],
        } as never),
      ).rejects.toThrow(UnsupportedAccountCapabilityError)
      expect(workflows.submitSolanaIntent).not.toHaveBeenCalled()
    },
  )

  test.each([
    [
      'token request',
      { tokenRequests: [{ address: mint, amount: 100n, memo: 'x' }] },
    ],
    ['app fee', { appFees: { feeBps: 25, recipient: owner.address } }],
    ['protocol fee', { protocolFees: { feeBps: 25, sponsor: true } }],
  ])(
    'rejects unknown nested %s fields before effects',
    async (_name, patch) => {
      const { facade, workflows } = fixture()

      await expect(
        facade.prepareTransaction({ ...transaction(), ...patch } as never),
      ).rejects.toThrow(UnsupportedAccountCapabilityError)
      expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
    },
  )

  test('rejects owner-only, assembly, authorization, and EVM submission options before effects', async () => {
    const { facade, workflows } = fixture()
    const prepared = await facade.prepareTransaction(transaction())

    await expect(
      facade.signTransaction(prepared, { owner } as never),
    ).rejects.toThrow(/Independent owner signing/)
    await expect(facade.assembleTransaction(prepared, [])).rejects.toThrow(
      /Independent owner signing/,
    )
    await expect(facade.signAuthorizations(prepared)).rejects.toThrow(
      /unavailable for Solana-origin/,
    )
    const signed = await facade.signTransaction(prepared)
    await expect(
      facade.submitTransaction(signed, { internal_dryRun: true }),
    ).rejects.toThrow(/does not accept submission options/)
    await expect(
      facade.submitTransaction(signed, { internal_dryRun: false }),
    ).rejects.toThrow(/does not accept submission options/)
    await expect(
      facade.submitTransaction(signed, { futureOption: false } as never),
    ).rejects.toThrow(/does not accept submission options/)
    expect(workflows.submitSolanaIntent).not.toHaveBeenCalled()
  })

  // A Solana origin authorizes its spend with exactly one personal-sign proof:
  // an empty, doubled, or EVM-shaped proof vector is refused before submission.
  test.each([
    { proofs: [] },
    {
      proofs: [
        { kind: 'personalSign', signature: '0x12' },
        { kind: 'personalSign', signature: '0x34' },
      ],
    },
    { proofs: [{ kind: 'eip712', signature: '0x12' }] },
    {
      proofs: [
        {
          kind: 'eip7702',
          nonce: 0,
          signature: { r: '0x12', s: '0x34', yParity: 0 },
        },
      ],
    },
  ])(
    'rejects extra or misplaced proofs before submission %#',
    async (patch) => {
      const { facade, workflows } = fixture()
      const signed = await facade.signTransaction(
        await facade.prepareTransaction(transaction()),
      )

      await expect(
        facade.submitTransaction({ ...signed, ...patch } as never),
      ).rejects.toThrow(InvalidSolanaTransactionArtifactError)
      expect(workflows.submitSolanaIntent).not.toHaveBeenCalled()
    },
  )

  test.each([
    [
      'environment',
      (prepared: PreparedTransactionData) => ({
        ...prepared,
        execution: {
          ...prepared.execution!,
          endpoint: 'https://other.example',
        },
      }),
    ],
    [
      'account',
      (prepared: PreparedTransactionData) => ({
        ...prepared,
        execution: { ...prepared.execution!, accountAddress: guardian.address },
      }),
    ],
    [
      'recipient',
      (prepared: PreparedTransactionData) => ({
        ...prepared,
        transaction: {
          ...prepared.transaction,
          recipient: solanaAddress('11111111111111111111111111111113'),
        } as never,
      }),
    ],
    [
      'mint',
      (prepared: PreparedTransactionData) => ({
        ...prepared,
        transaction: {
          ...prepared.transaction,
          tokenRequests: [
            {
              address: solanaAddress('11111111111111111111111111111113'),
              amount: 100n,
            },
          ],
        } as never,
      }),
    ],
  ])(
    'rejects %s binding tampering for cached prepared artifacts',
    async (_name, tamper) => {
      const { facade, workflows } = fixture()
      const prepared = tamper(await facade.prepareTransaction(transaction()))

      expect(() => facade.getTransactionMessages(prepared)).toThrow(
        InvalidSolanaTransactionArtifactError,
      )
      await expect(facade.signTransaction(prepared)).rejects.toThrow(
        InvalidSolanaTransactionArtifactError,
      )
      expect(workflows.signSolanaIntent).not.toHaveBeenCalled()
    },
  )

  test('refuses a Solana prepared artifact from an earlier wire version', async () => {
    const { facade, workflows } = fixture()
    const prepared = await facade.prepareTransaction(transaction())
    const { request: _binding, ...legacy } = prepared

    expect(() =>
      facade.getTransactionMessages(legacy as PreparedTransactionData),
    ).toThrow(InvalidPreparedTransactionError)
    await expect(
      facade.signTransaction(legacy as PreparedTransactionData),
    ).rejects.toThrow(InvalidPreparedTransactionError)
    expect(workflows.signSolanaIntent).not.toHaveBeenCalled()
  })

  test('rejects tampering on same-instance prepared and signed artifacts despite warm caches', async () => {
    const { facade, workflows } = fixture()
    const prepared = await facade.prepareTransaction(transaction())
    ;(prepared.quotes.best as { expiresAt: number }).expiresAt = 1
    await expect(facade.signTransaction(prepared)).rejects.toThrow(
      InvalidSolanaTransactionArtifactError,
    )
    expect(workflows.signSolanaIntent).not.toHaveBeenCalled()

    const signedWithChangedQuote = await facade.signTransaction(
      await facade.prepareTransaction(transaction()),
    )
    ;(signedWithChangedQuote.quote as { expiresAt: number }).expiresAt = 1
    await expect(
      facade.submitTransaction(signedWithChangedQuote),
    ).rejects.toThrow(InvalidSolanaTransactionArtifactError)

    const signedWithChangedBinding = await facade.signTransaction(
      await facade.prepareTransaction(transaction()),
    )
    ;(signedWithChangedBinding.execution as { endpoint: string }).endpoint =
      'https://other.example'
    await expect(
      facade.submitTransaction(signedWithChangedBinding),
    ).rejects.toThrow(InvalidSolanaTransactionArtifactError)
    expect(workflows.submitSolanaIntent).not.toHaveBeenCalled()
  })

  test('translates sponsorship exactly as an EVM transaction does', async () => {
    const { facade, workflows } = fixture()
    const sponsored = {
      gas: true,
      bridging: false,
      swaps: false,
      protocolFees: true,
    } as const
    await facade.prepareTransaction({ ...transaction(), sponsored })

    const sponsorSettings =
      workflows.prepareSolanaIntent.mock.calls[0]?.[0].sponsorSettings
    expect(sponsorSettings).toEqual(
      adaptTransaction(invocationContext(), {
        chain: optimism,
        calls: [],
        sponsored,
      }).options?.sponsorSettings,
    )
    // Rides the sponsorship-signature surface, so absent is not false.
    expect(sponsorSettings).not.toHaveProperty('swapValue')
  })

  test('omits sponsorship entirely when none is asked for', async () => {
    const { facade, workflows } = fixture()
    await facade.prepareTransaction(transaction())

    expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).not.toHaveProperty(
      'sponsorSettings',
    )
  })

  test('freezes the sponsorship it prepared against', async () => {
    const { facade } = fixture()
    const prepared = await facade.prepareTransaction({
      ...transaction(),
      sponsored: { gas: true, bridging: false, swaps: false },
    })

    expect(Object.isFrozen(prepared.transaction.sponsored)).toBe(true)
  })

  test('retains the captured EVM account type when live compatibility fields mutate', async () => {
    const { facade, workflows } = fixture()
    ;(facade.config.evm as LegacyAccountConfig<unknown>).account = {
      type: 'hca',
    }

    await facade.prepareTransaction(transaction())
    expect(workflows.prepareSolanaIntent).toHaveBeenCalledWith(
      expect.objectContaining({ accountType: 'ERC7579' }),
    )
  })

  test('rejects a live config mutation that would leave the captured development endpoint', async () => {
    const { facade, workflows } = fixture()
    ;(facade.config.evm as LegacyAccountConfig<unknown>).useDevContracts = false

    await expect(facade.prepareTransaction(transaction())).rejects.toThrow(
      ManagedSolanaAccountNotSupportedError,
    )
    expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
  })

  test('rejects quote and intent-input tampering across facade instances before signing or submission', async () => {
    const first = fixture()
    const second = fixture()
    const prepared = await first.facade.prepareTransaction(transaction())
    const changedQuote = {
      ...prepared,
      quotes: {
        ...prepared.quotes,
        best: { ...prepared.quotes.best, expiresAt: 1 },
      },
    }
    await expect(second.facade.signTransaction(changedQuote)).rejects.toThrow(
      InvalidSolanaTransactionArtifactError,
    )

    const signed = await second.facade.signTransaction(prepared)
    const changedInput = {
      ...signed,
      intentInput: {
        ...signed.intentInput,
        recipient: {
          address: solanaAddress('11111111111111111111111111111113'),
        },
      },
    }
    await expect(first.facade.submitTransaction(changedInput)).rejects.toThrow(
      InvalidSolanaTransactionArtifactError,
    )
    expect(first.workflows.submitSolanaIntent).not.toHaveBeenCalled()
  })

  describe('instruction execution', () => {
    const program = solanaAddress('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')

    function instructionTransaction() {
      return {
        chain: solanaDevnet,
        instructions: [
          {
            programId: { toBase58: () => program },
            keys: [
              {
                pubkey: { toBase58: () => mint },
                isSigner: false,
                isWritable: true,
              },
            ],
            data: new Uint8Array([1, 2, 3]),
          },
        ],
      }
    }

    test('routes instructions to the Solana workflow in the canonical wire shape', async () => {
      const { facade, workflows } = fixture()
      const prepared = await facade.prepareTransaction(instructionTransaction())

      const normalized = [
        {
          programId: program,
          accounts: [{ pubkey: mint, isSigner: false, isWritable: true }],
          data: 'AQID',
        },
      ]
      expect(prepared.transaction).toMatchObject({ instructions: normalized })
      expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
        action: { kind: 'instructions', instructions: normalized },
      })
      expect(prepared.execution).toEqual({
        kind: 'solana-instructions',
        namespace: 'dev-v1',
        endpoint: expect.any(String),
        chain: 792703810,
        caip2: solanaDevnet.caip2,
        accountAddress: owner.address,
        accountType: 'ERC7579',
        authority: owner.address,
        swigAddress: expect.any(String),
        walletAddress: expect.any(String),
      })
      expect(prepared.intentInput).toMatchObject({
        tokenRequests: [],
        destinationInstructions: normalized,
      })
      expect(prepared.intentInput).not.toHaveProperty('recipient')
    })

    test('accepts sponsorship on a tokenless execution', async () => {
      const { facade, workflows } = fixture()
      await facade.prepareTransaction({
        ...instructionTransaction(),
        sponsored: { gas: true, bridging: false, swaps: false },
      } as never)

      expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
        sponsorSettings: {
          gas: true,
          bridgeFees: false,
          swapFees: false,
          protocolFees: false,
        },
      })
    })

    test.each([
      ['a recipient', { recipient }],
      ['token requests', { tokenRequests: [{ address: mint, amount: 1n }] }],
      ['EVM calls', { calls: [] }],
      ['app fees', { appFees: { feeBps: 10 } }],
      ['protocol fees', { protocolFees: { feeBps: 10 } }],
    ])('refuses instructions combined with %s', async (_name, patch) => {
      const { facade, workflows } = fixture()

      await expect(
        facade.prepareTransaction({
          ...instructionTransaction(),
          ...patch,
        } as never),
      ).rejects.toThrow(UnsupportedAccountCapabilityError)
      expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
    })

    test('refuses malformed instructions and lookup tables before quoting', async () => {
      const { facade, workflows } = fixture()

      await expect(
        facade.prepareTransaction({
          chain: solanaDevnet,
          instructions: [],
        } as never),
      ).rejects.toThrow(InvalidSolanaTransactionArtifactError)
      await expect(
        facade.prepareTransaction({
          ...instructionTransaction(),
          addressLookupTables: ['not-base58'],
        } as never),
      ).rejects.toThrow(InvalidSolanaTransactionArtifactError)
      expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
    })

    test('refuses lookup tables without instructions', async () => {
      const { facade } = fixture()

      await expect(
        facade.prepareTransaction({
          ...transaction(),
          addressLookupTables: [mint],
        } as never),
      ).rejects.toThrow(UnsupportedAccountCapabilityError)
    })
  })
})

describe('managed Solana cross-chain delivery facade', () => {
  const mint = solanaAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
  const destinationToken = '0x0b2c639c533813f4aa9d7837caf62653d097ff85'
  const message = 'ab'.repeat(32)
  const swig = locateSwig(asSwigNamespace('dev-v1'), owner.address)
  // The spend is authorised on the Solana cluster; the delivery lands on the
  // EVM account, so the plan's two legs name different VMs.
  const sourceLeg = {
    vm: 'svm' as const,
    chainId: solanaDevnet.caip2,
    account: {
      wallet: swig.wallet,
      swigAccount: swig.swig,
      authority: { kind: 'secp256k1' as const, address: owner.address },
    },
  }
  const destinationLeg = {
    vm: 'evm' as const,
    chainId: formatCaip2(optimism.id),
    account: { address: owner.address, type: 'erc7579' as const },
  }

  function spendRequest(): SigningRequest {
    return personalSignRequest({
      chainId: solanaDevnet.caip2,
      wallet: swig.wallet,
      swigAccount: swig.swig,
      authority: owner.address,
      message,
      expiresAtSlot: '123',
    })
  }

  function quote(intentId: string): OrchestratorQuote {
    return {
      ...caucasusQuote({
        intentId,
        expiresAt: 2_000_000_000,
        settlementLayer: 'RELAY',
        signingRequests: [spendRequest()],
        cost: {
          input: [
            {
              chainId: solanaDevnet.caip2,
              tokenAddress: mint,
              symbol: 'USDC',
              decimals: 6,
              price: { usd: 1 },
              amount: 101n,
            },
          ],
          output: [
            {
              chainId: formatCaip2(optimism.id),
              tokenAddress: destinationToken,
              symbol: 'USDC',
              decimals: 6,
              price: { usd: 1 },
              amount: 100n,
            },
          ],
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
      estimatedFillTime: { seconds: 20 },
      plan: {
        source: [sourceLeg],
        destination: destinationLeg,
        deployments: [],
      },
      bridgeFill: {
        type: 'RELAY',
        destinationChainId: formatCaip2(optimism.id),
        fillStatusTimeout: 60,
        requestId: `0x${'ab'.repeat(32)}`,
      },
    }
  }

  function fixture() {
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
      useDevContracts: true,
    }
    const best = quote('best')
    const prepareSolanaIntent = vi.fn(async (input) => ({
      traceId: 'prepare-trace',
      input,
      ...buildSolanaIntentRequest(input),
      quote: best,
      quotes: [best],
    }))
    const signSolanaIntent = vi.fn(async ({ prepared, owner: signer }) => ({
      prepared,
      signature: await signer.signMessage({ message }),
    }))
    const submitSolanaIntent = vi.fn(async ({ prepared }) => ({
      type: 'intent' as const,
      traceId: 'submit-trace',
      intentId: prepared.quote.intentId,
      sourceChains: [792703810],
      targetChain: optimism.id,
    }))
    const waitForIntentStatus = vi.fn(async (_context, intentId: string) => ({
      traceId: `status-${intentId}`,
      intentId,
      purpose: 'execution' as const,
      status: 'FAILED' as const,
      operations: [
        {
          chainId: solanaDevnet.caip2,
          items: [
            {
              type: 'CLAIM' as const,
              status: 'COMPLETED' as const,
              transaction: {
                vm: 'svm' as const,
                chainId: solanaDevnet.caip2,
                signature: '5VERv8NM8A8f8hG1rjzAygzYwGwjBQD5rKpH8u8x2QfP',
              },
              timestamp: 1_700_000_000,
            },
          ],
        },
      ],
      refunds: [
        {
          transaction: {
            vm: 'svm' as const,
            chainId: solanaDevnet.caip2,
            signature: '3sP1t2VERv8NM8A8f8hG1rjzAygzYwGwjBQD5rKpH8u8',
          },
        },
      ],
    }))
    const workflows = {
      getAddress: vi.fn(() => owner.address),
      getEligibleEvmSourceChains: vi.fn(async () => {
        throw new Error('catalog must not be read')
      }),
      prepareSolanaIntent,
      reconstructSolanaIntent: vi.fn(reconstructSolanaIntent),
      signSolanaIntent,
      submitSolanaIntent,
      waitForIntentStatus,
    }
    const facade = createAccountFacade(
      compatibilityConfig,
      {
        evm: compatibilityConfig as EvmAccountConfig,
        solana: { owner: { type: 'ecdsa', account: owner } },
      },
      {
        config: resolveSdkConfig({ apiKey: 'offline', useDevContracts: true }),
        project: {} as never,
        createAccount: (context) => ({
          context,
          workflows: workflows as never,
        }),
      },
    )
    return { facade, workflows, best }
  }

  function transaction() {
    return {
      sourceChains: [solanaDevnet] as [typeof solanaDevnet],
      sourceTokens: [{ address: mint }] as [{ address: typeof mint }],
      targetChain: optimism,
      tokenRequests: [{ address: destinationToken, amount: 100n }] as [
        { address: `0x${string}`; amount: bigint },
      ],
    }
  }

  test('quotes an EVM delivery from the named cluster and mint, and reports the EVM target', async () => {
    const { facade, workflows } = fixture()
    const prepared = await facade.prepareTransaction(transaction())

    expect(workflows.getEligibleEvmSourceChains).not.toHaveBeenCalled()
    expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
      chain: solanaDevnet,
      action: {
        kind: 'transfer',
        mint,
        amount: 100n,
        delivery: {
          kind: 'cross-chain',
          chainId: optimism.id,
          token: destinationToken,
          // Defaulted to the account's own EVM identity.
          recipient: owner.address,
        },
      },
    })
    expect(prepared.execution).toMatchObject({
      kind: 'solana-cross-chain',
      chain: 792703810,
      mint,
      destinationChain: optimism.id,
      destinationToken,
      recipient: owner.address,
    })
    expect(facade.getTransactionMessages(prepared)).toEqual([spendRequest()])

    const submitted = await facade.submitTransaction(
      await facade.signTransaction(prepared),
    )
    expect(submitted).toEqual({
      type: 'intent',
      id: 'best',
      traceId: 'submit-trace',
      sourceChains: [792703810],
      targetChain: optimism.id,
    })
  })

  test('surfaces the Solana leg and its refund without reinterpretation', async () => {
    const { facade } = fixture()
    const submitted = await facade.submitTransaction(
      await facade.signTransaction(
        await facade.prepareTransaction(transaction()),
      ),
    )

    await expect(facade.waitForExecution(submitted)).resolves.toMatchObject({
      status: 'FAILED',
      operations: [
        {
          chainId: solanaDevnet.caip2,
          items: [
            {
              transaction: {
                vm: 'svm',
                signature: '5VERv8NM8A8f8hG1rjzAygzYwGwjBQD5rKpH8u8x2QfP',
              },
            },
          ],
        },
      ],
      refunds: [
        {
          transaction: {
            vm: 'svm',
            signature: '3sP1t2VERv8NM8A8f8hG1rjzAygzYwGwjBQD5rKpH8u8',
          },
        },
      ],
    })
  })

  test('sponsors a delivery the way an EVM transaction does', async () => {
    const { facade, workflows } = fixture()
    await facade.prepareTransaction({ ...transaction(), sponsored: true })

    expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
      sponsorSettings: adaptTransaction(invocationContext(), {
        chain: optimism,
        calls: [],
        sponsored: true,
      }).options?.sponsorSettings,
    })
  })

  test('prefers an explicit recipient and does not mutate the caller request', async () => {
    const { facade, workflows } = fixture()
    const request = {
      ...transaction(),
      recipient: guardian.address,
    }
    const prepared = await facade.prepareTransaction(request)

    expect(request.recipient).toBe(guardian.address)
    expect(Object.isFrozen(request)).toBe(false)
    expect(prepared.execution).toMatchObject({ recipient: guardian.address })
    expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
      action: { delivery: { recipient: guardian.address } },
    })
  })

  test.each([
    ['calls', { calls: [] }],
    ['instructions', { instructions: [] }],
    ['hyperCore', { hyperCore: { closePerp: { asset: 'ETH' } } }],
    ['a settlement layer filter', { settlementLayers: { include: ['RELAY'] } }],
    ['two source clusters', { sourceChains: [solanaDevnet, solanaMainnet] }],
    [
      'two source mints',
      { sourceTokens: [{ address: mint }, { address: mint }] },
    ],
    [
      'two delivery tokens',
      {
        tokenRequests: [
          { address: destinationToken, amount: 1n },
          { address: destinationToken, amount: 1n },
        ],
      },
    ],
    [
      'a base58 source mint amount',
      { sourceTokens: [{ address: mint, amount: 1n }] },
    ],
    ['a non-EVM destination', { targetChain: solanaMainnet }],
    ['a base58 recipient', { recipient: mint }],
    [
      'a zero delivery amount',
      { tokenRequests: [{ address: destinationToken, amount: 0n }] },
    ],
    [
      'a base58 delivery token',
      { tokenRequests: [{ address: mint, amount: 1n }] },
    ],
  ])('refuses %s before quoting', async (_name, patch) => {
    const { facade, workflows } = fixture()

    await expect(
      facade.prepareTransaction({ ...transaction(), ...patch } as never),
    ).rejects.toThrow(UnsupportedAccountCapabilityError)
    expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
  })

  test('refuses independent signing, assembly, authorizations, and EVM submission options', async () => {
    const { facade, workflows } = fixture()
    const prepared = await facade.prepareTransaction(transaction())

    await expect(
      facade.signTransaction(prepared, { owner } as never),
    ).rejects.toThrow(/Independent owner signing/)
    await expect(facade.assembleTransaction(prepared, [])).rejects.toThrow(
      /Independent owner signing/,
    )
    await expect(facade.signAuthorizations(prepared)).rejects.toThrow(
      /unavailable for Solana-origin/,
    )
    const signed = await facade.signTransaction(prepared)
    await expect(
      facade.submitTransaction(signed, { internal_dryRun: true }),
    ).rejects.toThrow(/does not accept submission options/)
    expect(workflows.submitSolanaIntent).not.toHaveBeenCalled()
  })

  test('rejects delivery binding tampering on a prepared artifact', async () => {
    const { facade, workflows } = fixture()
    const prepared = await facade.prepareTransaction(transaction())
    const tampered = {
      ...prepared,
      transaction: {
        ...prepared.transaction,
        recipient: guardian.address,
      } as never,
    }

    await expect(facade.signTransaction(tampered)).rejects.toThrow(
      InvalidSolanaTransactionArtifactError,
    )
    expect(workflows.signSolanaIntent).not.toHaveBeenCalled()
  })
})

describe('account config compatibility snapshot', () => {
  test('retains account-config keys, nested aliasing, and auth exposure', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const owners: EvmAccountConfig['owners'] = {
      type: 'ecdsa',
      accounts: [owner],
    }
    const provider: EvmAccountConfig['account'] = {
      type: 'nexus',
      version: '1.2.0',
    }
    const input: EvmAccountConfig = { account: provider, owners }
    const account = await sdk.createAccount({ evm: input })

    // Account-config keys survive by value.
    expect(account.config.evm.account).toEqual(provider)
    expect(account.config.evm.owners).toEqual(owners)

    // Shallow copy: nested references are aliased, so later method calls (which
    // re-read the live config) observe post-construction mutations to them.
    expect(account.config.evm.owners).toBe(owners)
    expect(account.config.evm.account).toBe(provider)

    expect(Object.isFrozen(account.config)).toBe(true)
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
        if (url.includes('/chains')) {
          return new Response(
            JSON.stringify({
              'eip155:1': {
                name: 'Ethereum',
                testnet: false,
                supportedTokens: 'all',
              },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          )
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
        evm: { owners: { type: 'ecdsa', accounts: [owner] } },
      })
      const live = account.config.evm as LegacyAccountConfig<unknown>

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

describe('cross-VM transaction validation', () => {
  const solana = solanaAddress('11111111111111111111111111111111')
  const config = {
    evm: { owners: { type: 'ecdsa' as const, accounts: [owner] } },
    solana: { address: solana },
  } satisfies RhinestoneAccountConfig

  test('defaults Solana delivery to the configured receiver', () => {
    const normalized = normalizeTransaction(
      {
        sourceChains: [mainnet],
        targetChain: solanaMainnet,
        tokenRequests: [{ address: solana, amount: 1n }],
        sponsored: true,
      },
      config,
    )
    expect(normalized.recipient).toBe(solana)
    expect(normalized.sponsored).toBe(true)
  })

  test.each([
    [
      { sourceChains: [], targetChain: mainnet, calls: [] },
      /at least one managed source/,
    ],
    [
      { sourceChains: null, targetChain: mainnet, calls: [] },
      /must be an array/,
    ],
    [
      { sourceChains: [mainnet, mainnet], targetChain: mainnet, calls: [] },
      /duplicate chains/,
    ],
    [
      {
        sourceChains: [{ id: 1, kind: 'svm', caip2: 'solana:forged' }],
        targetChain: mainnet,
        calls: [],
      },
      /Solana-origin transfers do not support `calls`/,
    ],
    [
      {
        sourceChains: [{ id: 1, kind: 'svm', caip2: 'solana:forged' }],
        sourceTokens: [{ address: solana }],
        targetChain: mainnet,
        tokenRequests: [{ address: recipientAddress, amount: 1n }],
      },
      /managed Solana source is required/,
    ],
    [
      { sourceChains: [{ id: 1500148 }], targetChain: mainnet, calls: [] },
      /Only viem EVM chains/,
    ],
    [
      { sourceChains: [mainnet], targetChain: solanaMainnet },
      /at least one token request/,
    ],
    [
      {
        sourceChains: [mainnet],
        targetChain: solanaMainnet,
        tokenRequests: [{ address: solana, amount: 0n }],
      },
      /amounts must be positive/,
    ],
    [
      {
        sourceChains: [mainnet],
        targetChain: solanaMainnet,
        tokenRequests: [{ address: solana, amount: 1n }],
        instructions: [],
      },
      /custom instructions and HyperCore actions are unavailable/,
    ],
    [
      {
        sourceChains: [mainnet],
        targetChain: solanaMainnet,
        tokenRequests: [{ address: solana, amount: 1n }],
        hyperCore: { closePerp: { asset: 'ETH' } },
      },
      /custom instructions and HyperCore actions are unavailable/,
    ],
    [
      {
        sourceChains: [mainnet],
        targetChain: solanaMainnet,
        tokenRequests: [{ address: solana, amount: 1n }],
        recipient: null,
      },
      /recipient must be a Solana address/,
    ],
    [
      {
        sourceChains: [mainnet],
        targetChain: mainnet,
        recipient: recipientAddress,
        calls: [{ to: recipientAddress }],
      },
      /recipient cannot execute destination calls/,
    ],
  ])('rejects unsupported dynamic transaction %#', (transaction, message) => {
    expect(() => normalizeTransaction(transaction as never, config)).toThrow(
      message,
    )
  })

  test('rejects a synthetic non-EVM ID disguised as a viem destination', () => {
    expect(() =>
      normalizeTransaction(
        {
          sourceChains: [mainnet],
          targetChain: { ...mainnet, id: 1500148 },
          calls: [],
        } as never,
        config,
      ),
    ).toThrow(/eip155 chain ID/)
  })

  test.each([
    {
      sourceChains: [mainnet],
      targetChain: { ...mainnet, id: -1 },
      calls: [],
    },
    {
      sourceChains: [{ ...mainnet, id: -1 }],
      targetChain: mainnet,
      calls: [],
    },
  ])('wraps invalid chain IDs in a capability error', (transaction) => {
    expect(() => normalizeTransaction(transaction as never, config)).toThrow(
      UnsupportedAccountCapabilityError,
    )
    expect(() => normalizeTransaction(transaction as never, config)).toThrow(
      /Only viem EVM chains|eip155 chain ID/,
    )
  })

  test('reports non-EVM origins without calling them Solana', () => {
    expect(() =>
      adaptTransaction(invocationContext(), {
        chain: { id: 728126428, kind: 'tvm', caip2: 'tron:mainnet' },
      } as never),
    ).toThrow(/Non-EVM origin execution/)
  })

  test('rejects a forged non-EVM descriptor', () => {
    expect(() =>
      normalizeTransaction(
        {
          sourceChains: [mainnet],
          targetChain: { ...solanaMainnet, caip2: 'tron:mainnet' },
          tokenRequests: [{ address: solana, amount: 1n }],
        } as never,
        config,
      ),
    ).toThrow(/mismatched VM/)
  })
})

describe('prepareTransaction automatic source selection', () => {
  function fixture(eligibleChainIds: readonly number[] = [mainnet.id]) {
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
    }
    const quote = quoteFixture('best')
    const getEligibleEvmSourceChains = vi.fn(async () =>
      eligibleChainIds.map(toEvmChainReference),
    )
    const prepareIntent = vi.fn(async (_context, input) => ({
      traceId: 'trace',
      input,
      request: intentRequest,
      normalized: normalizedIntentInput,
      quote,
      quotes: [quote],
      signing: {} as never,
      accountChain: toEvmChainReference(mainnet.id),
    }))
    const facade = createAccountFacade(
      compatibilityConfig,
      {
        evm: compatibilityConfig as EvmAccountConfig,
        solana: { address: solanaAddress('11111111111111111111111111111111') },
      },
      {
        config: resolveSdkConfig({ apiKey: 'offline' }),
        project: {} as never,
        createAccount: (context) => ({
          context,
          workflows: {
            getAddress: vi.fn(() => owner.address),
            getEligibleEvmSourceChains,
            prepareIntent,
          } as never,
        }),
      },
    )
    return { facade, getEligibleEvmSourceChains, prepareIntent }
  }

  test('resolves and propagates automatic EVM sources for Solana delivery', async () => {
    const { facade, getEligibleEvmSourceChains, prepareIntent } = fixture([
      mainnet.id,
      optimism.id,
    ])
    const solana = solanaAddress('11111111111111111111111111111111')

    await facade.prepareTransaction({
      targetChain: solanaMainnet,
      tokenRequests: [{ address: solana, amount: 1n }],
    })

    expect(getEligibleEvmSourceChains).toHaveBeenCalledWith(
      parseCaip2(solanaMainnet.caip2),
    )
    expect(prepareIntent.mock.calls[0]?.[1]).toMatchObject({
      destination: parseCaip2(solanaMainnet.caip2),
      sourceChains: [
        toEvmChainReference(mainnet.id),
        toEvmChainReference(optimism.id),
      ],
      accountAccessList: { chainIds: [mainnet.id, optimism.id] },
    })
  })

  test.each([
    {
      sourceChains: [mainnet],
      targetChain: optimism,
      calls: [],
    },
    { chain: mainnet, calls: [] },
  ])(
    'does not read the catalog for explicit or same-chain sources',
    async (transaction) => {
      const { facade, getEligibleEvmSourceChains } = fixture()

      await facade.prepareTransaction(transaction)

      expect(getEligibleEvmSourceChains).not.toHaveBeenCalled()
    },
  )

  test('fails before quoting when no automatic source is eligible', async () => {
    const { facade, prepareIntent } = fixture([])
    const solana = solanaAddress('11111111111111111111111111111111')

    await expect(
      facade.prepareTransaction({
        targetChain: solanaMainnet,
        tokenRequests: [{ address: solana, amount: 1n }],
      }),
    ).rejects.toThrow(/No managed EVM source chains are eligible/)
    expect(prepareIntent).not.toHaveBeenCalled()
  })

  test('propagates catalog read failures before quoting', async () => {
    const { facade, getEligibleEvmSourceChains, prepareIntent } = fixture()
    getEligibleEvmSourceChains.mockRejectedValueOnce(
      new Error('catalog unavailable'),
    )
    const solana = solanaAddress('11111111111111111111111111111111')

    await expect(
      facade.prepareTransaction({
        targetChain: solanaMainnet,
        tokenRequests: [{ address: solana, amount: 1n }],
      }),
    ).rejects.toThrow(/catalog unavailable/)
    expect(prepareIntent).not.toHaveBeenCalled()
  })

  test('rejects source assets outside the automatic source scope', async () => {
    const { facade, getEligibleEvmSourceChains, prepareIntent } = fixture([
      mainnet.id,
    ])
    const solana = solanaAddress('11111111111111111111111111111111')

    await expect(
      facade.prepareTransaction({
        targetChain: solanaMainnet,
        tokenRequests: [{ address: solana, amount: 1n }],
        sourceAssets: { [optimism.id]: [recipientAddress] },
      }),
    ).rejects.toThrow(/outside the eligible source scope/)
    expect(getEligibleEvmSourceChains).toHaveBeenCalledOnce()
    expect(prepareIntent).not.toHaveBeenCalled()
  })

  // A Blanc-era artifact has role-keyed `signData` and no request binding.
  // It has to be refused with the typed error before anything reads its
  // quotes, so the caller is told to prepare afresh rather than tripping over
  // a missing field.
  test('refuses a prepared artifact from an earlier wire version', async () => {
    const { facade } = fixture()
    const prepared = await facade.prepareTransaction({
      sourceChains: [mainnet],
      targetChain: mainnet,
      calls: [],
      tokenRequests: [{ address: recipientAddress, amount: 1n }],
    })
    const { signingRequests: _requests, ...withoutRequests } =
      prepared.quotes.best
    const { request: _binding, ...withoutBinding } = prepared
    const legacy = {
      ...withoutBinding,
      quotes: {
        ...prepared.quotes,
        best: { ...withoutRequests, signData: { origin: [] } },
      },
    } as unknown as PreparedTransactionData

    expect(() => facade.getTransactionMessages(legacy)).toThrow(
      InvalidPreparedTransactionError,
    )
    await expect(facade.signTransaction(legacy)).rejects.toThrow(
      InvalidPreparedTransactionError,
    )
    await expect(
      facade.submitTransaction({
        ...legacy,
        quote: prepared.quotes.best,
        proofs: [],
      } as unknown as SignedTransactionData),
    ).rejects.toThrow(InvalidPreparedTransactionError)
  })

  // Fails closed here, naming the caller's own input: sent on, an empty
  // selection is a wire-schema rejection naming fields they never wrote.
  test.each([
    ['an empty list', [] as const],
    ['an empty map', {} as const],
    ['a chain with no tokens', { [mainnet.id]: [] } as const],
  ])('rejects source assets given as %s', async (_label, sourceAssets) => {
    const { facade, prepareIntent } = fixture([mainnet.id])
    const solana = solanaAddress('11111111111111111111111111111111')

    await expect(
      facade.prepareTransaction({
        targetChain: solanaMainnet,
        tokenRequests: [{ address: solana, amount: 1n }],
        sourceAssets: sourceAssets as never,
      }),
    ).rejects.toThrow(/sourceAssets/)
    expect(prepareIntent).not.toHaveBeenCalled()
  })
})

describe('EVM → Solana delivery', () => {
  const mint = solanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
  const receiver = solanaAddress('EEnKdeMRGrhKq1Z2rkRubkrkTxCZigLZ5QgUYqAMvPnU')
  const explicitRecipient = solanaAddress('11111111111111111111111111111112')
  const signature =
    '5KtPn1LGuxhFiKZ9xVLYBu9A2yBqX6gB4XzYGVxV9Dszgvn6YxrY3JQSMNJ4e6d7S5kJqY2LxA2nCE4BrVQCLH5m'

  function fixture() {
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
    }
    const quote = quoteFixture('best')
    const prepareIntent = vi.fn(async (_context, input) => ({
      traceId: 'trace',
      input,
      request: intentRequest,
      normalized: normalizedIntentInput,
      quote,
      quotes: [quote],
      signing: {} as never,
      accountChain: toEvmChainReference(mainnet.id),
    }))
    const waitForIntentStatus = vi.fn(async () => ({
      traceId: 'status-trace',
      intentId: 'best',
      status: 'COMPLETED' as const,
      account: owner.address,
      operations: [
        { chain: 792703809, status: 'COMPLETED' as const, txHash: signature },
      ],
    }))
    const facade = createAccountFacade(
      compatibilityConfig,
      {
        evm: compatibilityConfig as EvmAccountConfig,
        solana: { address: receiver },
      },
      {
        config: resolveSdkConfig({ apiKey: 'offline' }),
        project: {} as never,
        createAccount: (context) => ({
          context,
          workflows: {
            getAddress: vi.fn(() => owner.address),
            prepareIntent,
            waitForIntentStatus,
          } as never,
        }),
      },
    )
    return { facade, prepareIntent, waitForIntentStatus }
  }

  test('carries the base58 mint, configured receiver, and fee modes into the request', async () => {
    const { facade, prepareIntent } = fixture()

    const prepared = await facade.prepareTransaction({
      sourceChains: [mainnet, optimism],
      targetChain: solanaMainnet,
      tokenRequests: [{ address: mint, amount: 50_000n }],
      sponsored: true,
      appFees: { feeBps: 25 },
      protocolFees: { feeBps: 50 },
    })

    expect(prepareIntent.mock.calls[0]?.[1]).toMatchObject({
      destination: parseCaip2(solanaMainnet.caip2),
      sourceChains: [
        toEvmChainReference(mainnet.id),
        toEvmChainReference(optimism.id),
      ],
      calls: [],
      // Base58 is case-sensitive; the facade must not normalize either string.
      tokenRequests: [{ token: mint, amount: 50_000n }],
      recipient: { address: receiver },
      options: {
        appFees: { feeBps: 25 },
        protocolFees: { feeBps: 50 },
        sponsorSettings: {
          gas: true,
          bridgeFees: true,
          swapFees: true,
          protocolFees: true,
        },
      },
    })
    // `execution` is Solana-ORIGIN metadata; a delivery carries none.
    expect(prepared).not.toHaveProperty('execution')
  })

  test('lets an explicit recipient win over the configured receiver', async () => {
    const { facade, prepareIntent } = fixture()

    await facade.prepareTransaction({
      sourceChains: [mainnet],
      targetChain: solanaDevnet,
      tokenRequests: [{ address: mint, amount: 1n }],
      recipient: explicitRecipient,
    })

    expect(prepareIntent.mock.calls[0]?.[1]).toMatchObject({
      recipient: { address: explicitRecipient },
    })
  })

  test('refuses delivery with neither an explicit recipient nor a Solana branch', () => {
    expect(() =>
      normalizeTransaction(
        {
          sourceChains: [mainnet],
          targetChain: solanaMainnet,
          tokenRequests: [{ address: mint, amount: 1n }],
        } as never,
        { evm: { owners: { type: 'ecdsa', accounts: [owner] } } },
      ),
    ).toThrow(AccountVmNotConfiguredError)
  })

  test('surfaces the Solana fill with a native transaction reference', async () => {
    const { facade } = fixture()

    const status = await facade.waitForExecution({
      type: 'intent',
      id: 'best',
      traceId: 'trace',
      sourceChains: [mainnet.id],
      targetChain: 792703809,
    })

    // The base58 signature must survive the facade as-is: it is not a hex hash.
    expect(status.operations).toEqual([
      { chain: 792703809, status: 'COMPLETED', txHash: signature },
    ])
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
    const signIntentFromRequests = vi.fn(
      async (
        _context: unknown,
        _input: { signers?: AdaptedSignerSelection },
      ) => ({
        proofs: [{ kind: 'eip712' as const, signature: '0x56' as const }],
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
      slots: [],
    }))
    const prepareUserOperation = vi.fn(async (_context, input) => ({
      input,
      operation: {} as never,
      hash: `0x${'66'.repeat(32)}` as const,
      signing: {} as never,
    }))
    const sendUserOperation = vi.fn(async (_context, input) => ({
      type: 'userop' as const,
      chain: input.chain,
      hash: `0x${'77'.repeat(32)}` as const,
    }))
    const workflows = {
      signMessage,
      signTypedData,
      signIntentFromRequests,
      reconstructPreparedIntent,
      signIntentAsOwner,
      prepareUserOperation,
      sendUserOperation,
    }
    const facade = createAccountFacade(
      compatibilityConfig,
      { evm: compatibilityConfig as EvmAccountConfig },
      {
        config: sdk,
        project: {} as never,
        createAccount: (context) => ({
          context,
          workflows: workflows as never,
        }),
      } satisfies CoreComposition<LegacyAccountConfig<unknown>>,
    )
    const selected = privateKeyToAccount(`0x${'03'.repeat(32)}`)
    const signers = {
      type: 'owner' as const,
      kind: 'ecdsa' as const,
      accounts: [selected],
    }
    const typedData = {
      kind: 'eip712',
      domain: { chainId: 1 },
      types: { Test: [{ name: 'value', type: 'uint256' }] },
      primaryType: 'Test',
      message: { value: 1n },
    } as const

    await facade.signMessage('hello', mainnet, signers)
    await facade.signTypedData(typedData, mainnet, signers)
    await facade.signIntent(
      [eip712Request({ chainId: mainnet.id })],
      mainnet,
      signers,
    )

    for (const call of [
      signMessage.mock.calls[0]?.[1],
      signTypedData.mock.calls[0]?.[1],
      signIntentFromRequests.mock.calls[0]?.[1],
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
      intentInput: serializedIntentInput,
      request: preparedRequest,
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

    const userOperation = {
      chain: mainnet,
      calls: [],
      signers,
    }
    await facade.prepareUserOperation(userOperation)
    await facade.sendUserOperation(userOperation)
    for (const call of [
      prepareUserOperation.mock.calls[0]?.[1],
      sendUserOperation.mock.calls[0]?.[1],
    ]) {
      expect(call?.signers).toMatchObject({
        kind: 'owner',
        signerIds: [`ecdsa:${selected.address.toLowerCase()}`],
      })
    }
    await expect(
      facade.prepareUserOperation({
        chain: mainnet,
        calls: [],
        signers: {
          type: 'session',
          session: { chain: mainnet } as never,
        },
      }),
    ).rejects.toThrow('No account found')
  })

  test('rejects an intent id that is not in the prepared transaction', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const account = await sdk.createAccount({
      evm: {
        owners: { type: 'ecdsa', accounts: [owner] },
      },
    })
    const quote = quoteFixture('best')
    const prepared = {
      quotes: { traceId: 'trace', best: quote, all: [quote] },
      intentInput: serializedIntentInput,
      request: preparedRequest,
      transaction: { chain: mainnet, calls: [] },
    } satisfies PreparedTransactionData

    expect(() =>
      account.getTransactionMessages(prepared, { intentId: 'missing' }),
    ).toThrowError(QuoteNotInPreparedTransactionError)
  })

  // A quote may ask for a payload this SDK cannot produce. The refusal belongs
  // to the returned promise, not to the call, because `signTransaction` is
  // async — but it lands before any account state is read.
  test('rejects unsupported signing data asynchronously', async () => {
    const account = await new RhinestoneSDK({
      apiKey: 'offline',
    }).createAccount({
      evm: { owners: { type: 'ecdsa', accounts: [owner] } },
    })
    const quote = publicQuote(
      caucasusQuote({
        intentId: 'unsupported',
        signingRequests: [
          eip712Request({ chainId: mainnet.id }),
          {
            ...eip712Request({
              chainId: mainnet.id,
              purpose: 'destinationAuthorization',
            }),
            payload: { kind: 'webauthn', challenge: '0x12' },
          },
        ],
      }),
    )
    const prepared = {
      quotes: { traceId: 'trace', best: quote, all: [quote] },
      intentInput: serializedIntentInput,
      request: preparedRequest,
      transaction: { chain: mainnet, calls: [] },
    } satisfies PreparedTransactionData

    let signing: Promise<unknown> | undefined
    expect(() => {
      signing = account.signTransaction(prepared)
    }).not.toThrow()
    await expect(signing).rejects.toThrow(UnsupportedSigningRequestError)
  })

  test('preserves the selected quote when submitting uncached signed data', async () => {
    const sdk = resolveSdkConfig({ apiKey: 'offline' })
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
    }
    const reconstructPreparedIntent = vi.fn(async (_context, input) => ({
      ...input,
      input: input.intentInput,
      accountChain: toEvmChainReference(1),
      signing: {} as never,
    }))
    const submitIntent = vi.fn(async (_context, signed) => ({
      type: 'intent' as const,
      traceId: signed.prepared.traceId,
      intentId: signed.prepared.quote.intentId,
      targetChain: 1,
    }))
    const facade = createAccountFacade(
      compatibilityConfig,
      { evm: compatibilityConfig as EvmAccountConfig },
      {
        config: sdk,
        project: {} as never,
        createAccount: (context) => ({
          context,
          workflows: { reconstructPreparedIntent, submitIntent } as never,
        }),
      },
    )
    const best = quoteFixture('best')
    const alternate = quoteFixture('alternate')
    const signed = {
      quotes: { traceId: 'trace', best, all: [best, alternate] },
      intentInput: serializedIntentInput,
      request: preparedRequest,
      transaction: { chain: mainnet, calls: [] },
      quote: alternate,
      proofs: [{ kind: 'eip712', signature: '0x12' }],
    } satisfies SignedTransactionData

    await expect(facade.submitTransaction(signed)).resolves.toMatchObject({
      id: 'alternate',
    })
    expect(reconstructPreparedIntent.mock.calls[0]?.[1].quote.intentId).toBe(
      'alternate',
    )
    expect(submitIntent.mock.calls[0]?.[1].prepared.quote.intentId).toBe(
      'alternate',
    )
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
    const facade = createAccountFacade(
      compatibilityConfig,
      { evm: compatibilityConfig as EvmAccountConfig },
      {
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
      },
    )
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

  // The orchestrator reads the action from `options.hyperCore`, and the agent
  // that may place the order is derived from its bytes — so a field-by-field
  // rebuild that forgets it here quotes an intent that authorises nothing.
  test('carries a HyperCore action into the intent options', () => {
    const action: HyperCoreOrderAction = {
      type: 'order',
      orders: [
        {
          a: 0,
          b: true,
          p: '64572',
          s: '0.00155',
          r: false,
          t: { limit: { tif: 'Ioc' } },
        },
      ],
      grouping: 'na',
    }

    // `prepareTransaction` resolves the declarative form; by this point the
    // action is already concrete and arrives as its own argument.
    const transaction = adaptTransaction(
      invocationContext(),
      {
        sourceChains: [mainnet],
        targetChain: hyperCorePerp,
        hyperCore: {
          openPerp: { asset: 'BTC', direction: 'long', notionalUsd: 100 },
        },
      },
      action,
    )

    expect(transaction.options?.hyperCore).toEqual({ action })
  })

  test('leaves hyperCore off the options when nothing resolved', () => {
    const transaction = adaptTransaction(invocationContext(), {
      chain: mainnet,
      calls: [],
    })

    expect(transaction.options && 'hyperCore' in transaction.options).toBe(
      false,
    )
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
      kind: 'account',
      accountKind: 'erc7579',
      setupOps: [expect.objectContaining({ to: expect.any(String) })],
    })
    expect(transaction.recipient?.address).not.toBe(recipientAddress)

    // A bare address is a payee and nothing more: it gets no account kind and
    // no setup ops, which on the wire would read as "this recipient executes".
    expect(
      adaptTransaction(invocationContext(), {
        chain: mainnet,
        calls: [],
        recipient: recipientAddress,
      }).recipient,
    ).toEqual({ kind: 'bare', address: recipientAddress })
  })

  test('carries recipient recovery config into setup and address derivation', () => {
    const base: EvmAccountConfig = {
      account: { type: 'nexus', version: '1.2.0' },
      owners: { type: 'ecdsa', accounts: [owner] },
    }
    const project = (recipient: EvmAccountConfig) =>
      accountRecipient(
        adaptTransaction(invocationContext(), {
          chain: mainnet,
          calls: [],
          recipient,
        }).recipient,
      )

    const plain = project(base)
    const withRecovery = project({
      ...base,
      recovery: { guardians: [guardian] },
    })

    // Dropping `recovery` here would deploy the recipient without the validator
    // and derive a different address than the caller configured.
    const setupData = withRecovery?.setupOps?.[0]?.data?.toLowerCase() ?? ''
    expect(setupData).toContain(SOCIAL_RECOVERY_VALIDATOR_ADDRESS.slice(2))
    expect(setupData).toContain(guardian.address.slice(2).toLowerCase())
    expect(withRecovery?.address).not.toBe(plain?.address)
  })

  // Which chains an intent takes EIP-7702 delegations on is no longer derived
  // from the transaction's source and destination chains: the quote names each
  // delegation it needs, so the facade returns exactly those contributions,
  // bound to the request slots they answer, and synthesises no chain list.
  test('returns the delegations the selected quote asked for', async () => {
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
    }
    const delegated = publicQuote(
      caucasusQuote({
        intentId: 'best',
        signingRequests: [
          eip712Request({ chainId: mainnet.id }),
          delegationRequest({
            chainId: mainnet.id,
            contract: guardian.address,
          }),
          delegationRequest({
            chainId: optimism.id,
            contract: guardian.address,
          }),
        ],
      }),
    )
    const contributions = [1, 2].map((requestIndex) => ({
      intentId: 'best',
      requestSetId: `0x${'aa'.repeat(32)}` as const,
      requestIndex,
      proof: {
        kind: 'eip7702' as const,
        nonce: requestIndex,
        signature: {
          r: '0x12' as const,
          s: '0x34' as const,
          yParity: 0 as const,
        },
      },
    }))
    const signRequestedDelegations = vi.fn(async () => contributions)
    const reconstructPreparedIntent = vi.fn(async (_context, input) => ({
      ...input,
      input: input.intentInput,
      accountChain: toEvmChainReference(mainnet.id),
      signing: {} as never,
    }))
    const facade = createAccountFacade(
      compatibilityConfig,
      { evm: compatibilityConfig as EvmAccountConfig },
      {
        config: resolveSdkConfig({ apiKey: 'offline' }),
        project: {} as never,
        createAccount: (context) => ({
          context,
          workflows: {
            reconstructPreparedIntent,
            signRequestedDelegations,
          } as never,
        }),
      },
    )
    const prepared = {
      quotes: { traceId: 'trace', best: delegated, all: [delegated] },
      intentInput: serializedIntentInput,
      request: preparedRequest,
      transaction: {
        sourceChains: [mainnet, optimism],
        targetChain: optimism,
        calls: [],
      },
    } satisfies PreparedTransactionData

    await expect(facade.signAuthorizations(prepared)).resolves.toEqual(
      contributions,
    )
    expect(reconstructPreparedIntent.mock.calls[0]?.[1].quote.intentId).toBe(
      'best',
    )
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

  // RHI-5510: the delivery venue is the destination chain, not a field on the
  // token request, so `adaptTransaction` carries nothing venue-specific. This
  // pins that no stray venue field is synthesised onto a request — the previous
  // `balance` flag was dropped by this very mapping, which is what silently
  // routed spot deliveries into perp margin.
  test('synthesises no venue field onto token requests', () => {
    const transaction = adaptTransaction(invocationContext(), {
      chain: mainnet,
      calls: [],
      tokenRequests: [
        {
          address: '0x0000000000000000000000000000000000000020',
          amount: 1_000_000n,
        },
      ],
    })

    expect(transaction.tokenRequests?.[0]).toMatchObject({ amount: 1_000_000n })
    expect(transaction.tokenRequests?.[0]).not.toHaveProperty('balance')
  })

  test('forwards protocolFees into intent options (RHI-4904)', () => {
    const transaction = adaptTransaction(invocationContext(), {
      chain: mainnet,
      calls: [],
      protocolFees: { feeBps: 35 },
    })

    expect(transaction.options?.protocolFees).toEqual({ feeBps: 35 })
    expect(transaction.options?.appFees).toBeUndefined()
  })

  test('maps sponsored.protocolFees onto sponsorSettings (RHI-4904)', () => {
    const transaction = adaptTransaction(invocationContext(), {
      chain: mainnet,
      calls: [],
      sponsored: {
        gas: false,
        bridging: false,
        swaps: false,
        protocolFees: true,
      },
    })

    expect(transaction.options?.sponsorSettings).toEqual({
      gas: false,
      bridgeFees: false,
      swapFees: false,
      protocolFees: true,
    })
  })

  test('sponsored object without protocolFees defaults it to false (RHI-4904)', () => {
    const transaction = adaptTransaction(invocationContext(), {
      chain: mainnet,
      calls: [],
      sponsored: { gas: true, bridging: true, swaps: true },
    })

    expect(transaction.options?.sponsorSettings?.protocolFees).toBe(false)
  })

  test('maps sponsored.swapValue onto sponsorSettings (RHI-7257)', () => {
    const transaction = adaptTransaction(invocationContext(), {
      chain: mainnet,
      calls: [],
      sponsored: {
        gas: true,
        bridging: false,
        swaps: false,
        swapValue: true,
      },
    })

    expect(transaction.options?.sponsorSettings).toEqual({
      gas: true,
      bridgeFees: false,
      swapFees: false,
      protocolFees: false,
      swapValue: true,
    })
  })

  test('omits swapValue entirely when it is not asked for (RHI-7257)', () => {
    // Absent, not false. The field rides the server-signature surface, so a
    // present-but-false key is different canonical bytes from an absent one —
    // which breaks sponsored quotes across a rolling deploy.
    const transaction = adaptTransaction(invocationContext(), {
      chain: mainnet,
      calls: [],
      sponsored: { gas: true, bridging: true, swaps: true },
    })

    expect(transaction.options?.sponsorSettings).not.toHaveProperty('swapValue')
  })

  test('boolean sponsored: true does NOT imply swapValue (RHI-7257)', () => {
    // Par moves real tokens out of the integrator's balance at the exchange
    // rate, not a fee we chose to waive. "Sponsor everything" must not opt into
    // it silently.
    const transaction = adaptTransaction(invocationContext(), {
      chain: mainnet,
      calls: [],
      sponsored: true,
    })

    expect(transaction.options?.sponsorSettings).not.toHaveProperty('swapValue')
  })

  test('boolean sponsored: true enables protocolFees too (RHI-4904)', () => {
    const transaction = adaptTransaction(invocationContext(), {
      chain: mainnet,
      calls: [],
      sponsored: true,
    })

    expect(transaction.options?.sponsorSettings).toEqual({
      gas: true,
      bridgeFees: true,
      swapFees: true,
      protocolFees: true,
    })
  })
})

// A same-chain EVM quote carrying the one origin authorization the account
// signs. The chain has to be readable from the payload's domain: that is where
// the signing account runtime is resolved from.
function quoteFixture(intentId: string): Quote {
  return publicQuote(caucasusQuote({ intentId, chainId: mainnet.id }))
}
