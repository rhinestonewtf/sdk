import { type Account, bytesToHex, type Hex, hexToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet, optimism } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import {
  quote as caucasusQuote,
  costEntry,
  delegationRequest,
  eip712Request,
  emptyCost,
  personalSignRequest,
  publicQuote,
} from '../../test/utils/caucasus'
import { signingPasskey } from '../../test/utils/passkeys'
import {
  asSwigNamespace,
  locateSwig,
  locateSwigById,
} from '../accounts/solana/address'
import { formatCaip2, parseCaip2, toEvmChainReference } from '../chains/caip2'
import type { SolanaAddress } from '../chains/non-evm'
import {
  hyperCorePerp,
  solanaAddress,
  solanaDevnet,
  solanaMainnet,
  tronMainnet,
} from '../chains/non-evm'
import {
  parseErrorEnvelope,
  SolanaAccountAlreadyCreatedError,
} from '../clients/orchestrator/errors'
import type {
  HyperCoreOrderAction,
  Quote,
  SerializedIntentInput,
  SigningRequest,
  SwigAuthority,
} from '../clients/orchestrator/public'
import { serializeBigInts } from '../clients/orchestrator/serialization'
import {
  projectSponsorshipApproval,
  toSponsorshipApprovalInput,
} from '../clients/orchestrator/sponsorship-approval'
import type {
  OrchestratorDeploymentQuote,
  OrchestratorExecutionQuote,
  OrchestratorIntentRequest,
  OrchestratorQuote,
  OrchestratorQuoteContext,
} from '../clients/orchestrator/types'
import type { SolanaManagedAccountConfig, SolanaOwner } from '../config/account'
import type { LegacyAccountConfig } from '../config/legacy'
import { resolveAccountConfig, resolveSdkConfig } from '../config/resolve'
import type { AccountInvocationContext } from '../config/resolved'
import {
  AccountVmNotConfiguredError,
  ManagedSolanaAccountNotSupportedError,
  UnsupportedAccountCapabilityError,
} from '../errors/capability'
import {
  IntentFailedError,
  InvalidPreparedTransactionError,
  InvalidSolanaTransactionArtifactError,
  QuoteNotInPreparedTransactionError,
  SignerNotSupportedError,
  UnsupportedSigningRequestError,
} from '../errors/execution'
import type { EvmAccountConfig } from '../evm/index'
import type { RhinestoneAccountConfig } from '../index'
import { RhinestoneSDK } from '../index'
import { ecdsaSignerId } from '../modules/validators/signer-id'
import { SOCIAL_RECOVERY_VALIDATOR_ADDRESS } from '../modules/validators/social-recovery'
import type { IntentRecipientProjection } from '../transactions/intents/account'
import { projectPreparedBinding } from '../transactions/intents/compatibility'
import {
  buildSolanaIntentRequest,
  reconstructSolanaIntent,
  signSolanaIntent,
} from '../transactions/intents/solana'
import {
  type PreparedSolanaDeployment,
  prepareSolanaDeployment,
  type SolanaDeploymentInput,
  submitSolanaDeployment,
} from '../transactions/intents/solana-deployment'
import { submitIntent } from '../transactions/intents/submit'
import type {
  PreparedTransactionData,
  SignedTransactionData,
} from '../transactions/intents/types'
import {
  adaptTransaction,
  createAccountFacade,
  createSolanaAccountFacade,
} from './account'
import type { CoreComposition } from './compose-types'
import type { AdaptedSignerSelection } from './signer-selection'
import { normalizeTransaction } from './transaction-input'

const DEV_ORCHESTRATOR_URL = 'https://dev.v1.orchestrator.rhinestone.dev'
const PROD_ORCHESTRATOR_URL = 'https://v1.orchestrator.rhinestone.dev'
const owner = privateKeyToAccount(`0x${'02'.repeat(32)}`)
const guardian = privateKeyToAccount(`0x${'03'.repeat(32)}`)
const managedSwigLocation = locateSwig(asSwigNamespace('dev-v1'), owner.address)
const managedSwig = managedSwigLocation.swig
const prodSwigLocation = locateSwig(asSwigNamespace('prod-v1'), owner.address)
const recipientAddress = '0x0000000000000000000000000000000000000010' as const
const mainnetUsdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
const optimismUsdc = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' as const
// The Caucasus request a prepared artifact carries. Only its round trip through
// `PreparedTransactionData.request` matters here, so it stays minimal.
const intentRequest = {
  account: { evm: { type: 'erc7579', address: recipientAddress } },
  destination: { vm: 'evm', chainId: formatCaip2(mainnet.id) },
} satisfies OrchestratorIntentRequest
// The approval input that request projects to.
const serializedIntentInput = {
  contractVersion: 'sdk-caucasus-singular-2026-09-v1',
  account: { evm: { type: 'erc7579', address: recipientAddress } },
  destination: { vm: 'evm', chainId: formatCaip2(mainnet.id) },
  options: {},
} satisfies SerializedIntentInput
const preparedRequest = projectPreparedBinding(intentRequest)
// The simplest EVM transaction a prepared artifact can carry.
const sameChainTransaction = {
  source: { token: mainnetUsdc },
  destination: { chain: mainnet },
}

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
        source: { token: mainnetUsdc },
        destination: {
          chain: mainnet,
          calls: [{ to: guardian.address, value: 0n, data: '0x' }],
        },
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
        source: { chain: mainnet, token: mainnetUsdc },
        destination: {
          chain: hyperCorePerp,
          hyperCore: {
            openPerp: { asset: 'BTC', direction: 'long', notionalUsd: 100 },
          },
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
        endpointUrl: DEV_ORCHESTRATOR_URL,
        useDevContracts: true,
      })
      const config = {
        evm: { owners: { type: 'ecdsa' as const, accounts: [owner] } },
        solana: {
          owner: { type: 'ecdsa' as const, account: owner },
          swig: managedSwig,
        },
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

  test('accepts a passkey owner on the same Swig and refuses malformed ones', async () => {
    const sdk = new RhinestoneSDK({
      apiKey: 'offline',
      endpointUrl: DEV_ORCHESTRATOR_URL,
      useDevContracts: true,
    })
    const evm = { owners: { type: 'ecdsa' as const, accounts: [owner] } }
    const { account: passkey } = signingPasskey()
    const passkeyOwned = await sdk.createAccount({
      evm,
      solana: {
        owner: { type: 'passkey', account: passkey },
        swig: managedSwig,
      },
    })
    const ecdsaOwned = await sdk.createAccount({
      evm,
      solana: { owner: { type: 'ecdsa', account: owner }, swig: managedSwig },
    })

    expect(passkeyOwned.config.solana).toEqual({
      owner: { type: 'passkey', account: passkey },
      swig: managedSwig,
    })
    // The explicit Swig stays fixed regardless of which credential owns it.
    expect(passkeyOwned.getAddress('solana')).toBe(
      ecdsaOwned.getAddress('solana'),
    )
    for (const candidate of [
      { type: 'passkey', account: owner },
      { type: 'passkey', account: { ...passkey, type: 'local' } },
      { type: 'passkey', account: { ...passkey, id: '' } },
      {
        type: 'passkey',
        account: { ...passkey, publicKey: `0x${'11'.repeat(63)}` },
      },
      { type: 'ecdsa', account: passkey },
    ]) {
      await expect(
        sdk.createAccount({ evm, solana: { owner: candidate } } as never),
      ).rejects.toThrow(ManagedSolanaAccountNotSupportedError)
    }
  })

  test.each([
    ['development on the dev endpoint', DEV_ORCHESTRATOR_URL, true],
    ['development on the dev endpoint/', `${DEV_ORCHESTRATOR_URL}/`, true],
    ['production on the default endpoint', undefined, false],
    ['production on the prod endpoint/', `${PROD_ORCHESTRATOR_URL}/`, false],
  ])('accepts %s', async (_name, endpointUrl, useDevContracts) => {
    const account = await new RhinestoneSDK({
      apiKey: 'offline',
      ...(endpointUrl ? { endpointUrl } : {}),
      useDevContracts,
    }).createAccount({
      evm: { owners: { type: 'ecdsa', accounts: [owner] } },
      solana: {
        owner: { type: 'ecdsa', account: owner },
        swig: managedSwig,
      },
    })
    expect(account.getAddress('solana')).toBe(managedSwigLocation.wallet)
  })

  test.each([
    ['development on the prod endpoint', PROD_ORCHESTRATOR_URL, true],
    ['development on the default endpoint', undefined, true],
    ['production on the dev endpoint', DEV_ORCHESTRATOR_URL, false],
    ['development on a custom endpoint', 'https://orchestrator.example', true],
    ['production on a custom endpoint', 'https://orchestrator.example', false],
  ])('refuses %s', async (_name, endpointUrl, useDevContracts) => {
    const sdk = new RhinestoneSDK({
      apiKey: 'offline',
      ...(endpointUrl ? { endpointUrl } : {}),
      useDevContracts,
    })
    for (const config of [
      {
        evm: { owners: { type: 'ecdsa' as const, accounts: [owner] } },
        solana: {
          owner: { type: 'ecdsa' as const, account: owner },
          swig: managedSwig,
        },
      },
      {
        solana: {
          owner: { type: 'ecdsa' as const, account: owner },
          swig: managedSwig,
        },
      },
    ]) {
      const refusal = sdk.createAccount(config)
      await expect(refusal).rejects.toBeInstanceOf(
        ManagedSolanaAccountNotSupportedError,
      )
      await expect(refusal).rejects.toThrow(
        /v1\.orchestrator\.rhinestone\.dev.*dev\.v1\.orchestrator\.rhinestone\.dev/,
      )
    }
  })

  test('rejects a managed account naming no Swig, and widened unsupported owners', async () => {
    await expect(
      new RhinestoneSDK({
        apiKey: 'offline',
        endpointUrl: DEV_ORCHESTRATOR_URL,
        useDevContracts: true,
      }).createAccount({
        solana: { owner: { type: 'ecdsa', account: owner } },
      } as never),
    ).rejects.toThrow(/requires `swig`/)
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

  describe('standing alone on the Swig it names', () => {
    // Any existing Swig state account will do; its wallet PDA is derived.
    const location = locateSwig(asSwigNamespace('dev-v1'), guardian.address)
    const swig = location.swig
    const ecdsaOwner = { type: 'ecdsa' as const, account: owner }
    const devSdk = () =>
      new RhinestoneSDK({
        apiKey: 'offline',
        endpointUrl: DEV_ORCHESTRATOR_URL,
        useDevContracts: true,
      })

    test('is addressed by its wallet and exposes only the intent lifecycle, offline', async () => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      try {
        const account = await devSdk().createAccount({
          solana: { owner: ecdsaOwner, swig },
        })

        expect(account.getAddress('solana')).toBe(location.wallet)
        expect(() =>
          (account as never as { getAddress(vm: string): string }).getAddress(
            'evm',
          ),
        ).toThrow(AccountVmNotConfiguredError)
        expect(typeof account.prepareTransaction).toBe('function')
        expect(typeof account.waitForExecution).toBe('function')
        // `deploy` creates the Swig; the rest is EVM account management.
        expect(typeof account.deploy).toBe('function')
        for (const evmOnly of ['isDeployed', 'signMessage', 'getPortfolio']) {
          expect(evmOnly in account).toBe(false)
        }
        expect(account.config.solana).toEqual({ owner: ecdsaOwner, swig })
        expect(fetch).not.toHaveBeenCalled()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    test.each([
      ['a non-address string', 'swig'],
      ['an object', { swigAccount: swig }],
      ['an EVM address', owner.address],
    ])('refuses %s as the Swig state account', async (_name, malformed) => {
      await expect(
        devSdk().createAccount({
          solana: { owner: ecdsaOwner, swig: malformed },
        } as never),
      ).rejects.toThrow(/Swig state account address/)
    })

    test('snapshots an EVM receiver without leaking managed capabilities through mutation', async () => {
      const evm = { address: owner.address }
      const account = await devSdk().createAccount({
        evm,
        solana: { owner: ecdsaOwner, swig },
      })
      evm.address = guardian.address

      expect(account.getAddress('evm')).toBe(owner.address)
      expect(Object.isFrozen(account.config.evm)).toBe(true)
      await expect(
        account.prepareTransaction({
          source: { chain: solanaDevnet, token: location.wallet },
          destination: {
            chain: optimism,
            token: recipientAddress,
            amount: 1n,
            calls: [{ to: recipientAddress }],
          },
        } as never),
      ).rejects.toThrow(/managed EVM account/)
    })

    test.each([
      ['a managed', { owners: { type: 'ecdsa', accounts: [owner] } }],
      ['a receiver', { address: owner.address }],
    ])('keeps the explicit Swig beside %s EVM entry', async (_name, evm) => {
      const account = await devSdk().createAccount({
        evm,
        solana: { owner: ecdsaOwner, swig },
      } as never)

      const getAddress = (
        account as unknown as {
          getAddress(vm: 'evm' | 'solana'): string
        }
      ).getAddress.bind(account)
      expect(getAddress('solana')).toBe(location.wallet)
      expect(getAddress('evm')).toMatch(/^0x[0-9a-fA-F]{40}$/u)
    })
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

  function quote(intentId: string): OrchestratorExecutionQuote {
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
      endpointUrl: DEV_ORCHESTRATOR_URL,
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
      proofs: [
        {
          kind: 'personalSign' as const,
          signature: await signer.signMessage({ message }),
        },
      ],
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
    const signIntentFromRequests = vi.fn(async () => {
      throw new Error('EVM signing must not run')
    })
    const workflows = {
      getAddress,
      prepareSolanaIntent,
      signIntentFromRequests,
      reconstructSolanaIntent: reconstruct,
      signSolanaIntent,
      submitSolanaIntent,
      waitForIntentStatus,
    }
    const facade = createAccountFacade(
      compatibilityConfig,
      {
        evm: compatibilityConfig as EvmAccountConfig,
        solana: { owner: { type: 'ecdsa', account: owner }, swig: managedSwig },
      },
      {
        config: resolveSdkConfig({
          apiKey: 'offline',
          endpointUrl: DEV_ORCHESTRATOR_URL,
          useDevContracts: true,
        }),
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
      source: { token: mint },
      destination: {
        chain: solanaDevnet,
        token: mint,
        amount: 100n,
        recipient,
      },
      sponsored: false as const,
    }
  }

  test('dispatches prepare, messages, sign, submit, and status entirely through the Solana workflow', async () => {
    const { facade, workflows } = fixture()
    const prepared = await facade.prepareTransaction(transaction())

    expect(workflows.prepareSolanaIntent).toHaveBeenCalledOnce()
    expect(prepared.request.request).toEqual({
      account: {
        svm: {
          type: 'swig',
          address: swig.wallet,
          swigAccount: swig.swig,
          authorization: { kind: 'secp256k1', address: owner.address },
        },
      },
      source: { vm: 'svm', chainId: solanaDevnet.caip2, token: mint },
      destination: {
        vm: 'svm',
        chainId: solanaDevnet.caip2,
        token: mint,
        amount: '100',
        recipient: { address: recipient },
      },
    })
    expect(prepared.intentInput).toEqual(
      toSponsorshipApprovalInput(prepared.request.request),
    )
    expect(facade.getTransactionMessages(prepared)).toEqual([spendRequest()])
    const signed = await facade.signTransaction(prepared)
    expect(workflows.signSolanaIntent).toHaveBeenCalledOnce()
    expect(workflows.signIntentFromRequests).not.toHaveBeenCalled()
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
        source: { chain: mainnet, token: mainnetUsdc },
        destination: { chain: targetChain, token: mint, amount: 100n },
      }
      const evmQuote = quoteFixture('evm')
      const prepareIntent = vi.fn(async (_context, input) => ({
        traceId: 'evm-trace',
        input,
        request: intentRequest,
        intentInput: serializedIntentInput,
        quote: evmQuote,
        quotes: [evmQuote],
        signing: {} as never,
        accountChain: toEvmChainReference(mainnet.id),
      }))
      Object.assign(workflows, { prepareIntent })

      const prepared = await facade.prepareTransaction(request)

      expect(request.destination).not.toHaveProperty('recipient')
      expect(prepared.transaction).toMatchObject({
        destination: { recipient: managedWallet },
      })
      expect(prepareIntent.mock.calls[0]?.[1]).toMatchObject({
        source: { chain: toEvmChainReference(mainnet.id), token: mainnetUsdc },
        token: mint,
        amount: 100n,
        recipient: { address: managedWallet },
      })
      expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
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
        intentInput: serializedIntentInput,
        quote: evmQuote,
        quotes: [evmQuote],
        signing: {} as never,
        accountChain: toEvmChainReference(mainnet.id),
      }))
      Object.assign(workflows, { prepareIntent })

      await facade.prepareTransaction({
        source: { chain: mainnet, token: mainnetUsdc },
        destination: {
          chain: targetChain,
          token: mint,
          amount: 100n,
          recipient,
        },
      })

      expect(prepareIntent.mock.calls[0]?.[1]).toMatchObject({
        destination: parseCaip2(targetChain.caip2),
        recipient: { address: recipient },
      })
      expect(recipient).not.toBe(managedWallet)
    },
  )

  test('prepares, signs and submits for a passkey owner under its compressed key', async () => {
    const { account: passkey, compressedPublicKey } = signingPasskey()
    const request: SigningRequest = {
      ...spendRequest(),
      authority: {
        kind: 'swigRole',
        roleId: 1,
        authority: { kind: 'secp256r1', publicKey: compressedPublicKey },
      },
      payload: { kind: 'webauthn', challenge: `0x${'a3'.repeat(32)}` },
    }
    const best = { ...quote('best'), signingRequests: [request] }
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
      endpointUrl: DEV_ORCHESTRATOR_URL,
      useDevContracts: true,
    }
    const workflows = {
      getAddress: vi.fn(() => owner.address),
      prepareSolanaIntent: vi.fn(async (input) => ({
        traceId: 'prepare-trace',
        input,
        ...buildSolanaIntentRequest(input),
        quote: best,
        quotes: [best],
      })),
      reconstructSolanaIntent,
      signSolanaIntent: vi.fn((input) =>
        signSolanaIntent({ ...input, now: () => 1_900_000_000_000 }),
      ),
      submitSolanaIntent: vi.fn(async ({ prepared }) => ({
        type: 'intent' as const,
        traceId: 'submit-trace',
        intentId: prepared.quote.intentId,
        sourceChains: [792703810],
        targetChain: 792703810,
      })),
    }
    const facade = createAccountFacade(
      compatibilityConfig,
      {
        evm: compatibilityConfig as EvmAccountConfig,
        solana: {
          owner: { type: 'passkey', account: passkey },
          swig: managedSwig,
        },
      },
      {
        config: resolveSdkConfig({
          apiKey: 'offline',
          endpointUrl: DEV_ORCHESTRATOR_URL,
          useDevContracts: true,
        }),
        project: {} as never,
        createAccount: (context) => ({
          context,
          workflows: workflows as never,
        }),
      },
    )

    const prepared = await facade.prepareTransaction(transaction())
    const input = workflows.prepareSolanaIntent.mock.calls[0]?.[0]
    expect(input?.authority).toEqual({
      kind: 'secp256r1',
      publicKey: compressedPublicKey,
    })
    expect(buildSolanaIntentRequest(input).request.account.svm).toMatchObject({
      authorization: { kind: 'secp256r1', publicKey: compressedPublicKey },
    })
    expect(prepared.execution?.authority).toBe(compressedPublicKey)

    const signed = await facade.signTransaction(prepared)
    expect(workflows.signSolanaIntent.mock.calls[0]?.[0].owner).toBe(passkey)
    expect(signed.proofs).toEqual([
      {
        kind: 'webauthn',
        assertion: expect.objectContaining({ credentialId: 'AQIDBA' }),
      },
    ])
    await expect(facade.submitTransaction(signed)).resolves.toMatchObject({
      id: 'best',
    })
    expect(workflows.submitSolanaIntent.mock.calls[0]?.[0].proofs).toEqual(
      signed.proofs,
    )
  })

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
    request.destination.amount = 999n
    request.destination.recipient = solanaAddress(
      '11111111111111111111111111111113',
    )
    request.appFees.feeBps = 75
    request.protocolFees.feeBps = 100
    release()

    const prepared = await preparing
    expect(prepared.transaction).toMatchObject({
      destination: { recipient, token: mint, amount: 100n },
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
    ['calls', { calls: [] }],
    ['sourceChains', { sourceChains: [mainnet] }],
    ['signers', { signers: { type: 'owner', accounts: [owner] } }],
    ['customDeadline', { customDeadline: 1 }],
    ['settlementLayers', { settlementLayers: { include: ['RELAY'] } }],
    ['nonce', { nonce: 1n }],
    ['source.auxiliaryFunds', { source: { token: mint, auxiliaryFunds: 1n } }],
    ['source.calls', { source: { token: mint, calls: [] } }],
    [
      'destination.calls',
      { destination: { ...transaction().destination, calls: [] } },
    ],
    [
      'destination.gasLimit',
      { destination: { ...transaction().destination, gasLimit: 1n } },
    ],
    [
      'destination.hyperCore',
      { destination: { ...transaction().destination, hyperCore: {} } },
    ],
  ])(
    'rejects widened `%s` before quote, sign, or submit effects',
    async (_field, patch) => {
      const { facade, workflows } = fixture()
      const widened = { ...transaction(), ...patch }

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
      'destination',
      { destination: { ...transaction().destination, memo: 'x' } },
    ],
    ['source', { source: { token: mint, memo: 'x' } }],
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

  describe('with a source amount cap', () => {
    const capped = (maxAmount?: bigint, source: object = {}) => ({
      source: {
        token: mint,
        ...(maxAmount === undefined ? {} : { maxAmount }),
        ...source,
      },
    })

    test('caps the transfer with the source maxAmount and keeps it through signing', async () => {
      const { facade, workflows } = fixture()
      const prepared = await facade.prepareTransaction({
        ...transaction(),
        ...capped(100n),
      })

      expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
        action: { amount: 100n, sourceLimit: 100n },
      })
      const source = {
        vm: 'svm',
        chainId: solanaDevnet.caip2,
        token: mint,
        maxAmount: '100',
      }
      expect(prepared.request.request).toMatchObject({ source })
      expect(prepared.request.request).not.toHaveProperty('source.selection')
      expect(prepared.request.request).not.toHaveProperty('source.limits')
      expect(prepared.intentInput.source).toEqual(source)
      await facade.submitTransaction(await facade.signTransaction(prepared))
      expect(workflows.submitSolanaIntent).toHaveBeenCalledOnce()
    })

    test('expands the same-chain shorthand exactly as naming the cluster', async () => {
      const { facade } = fixture()
      const shorthand = await facade.prepareTransaction(transaction())
      const named = await facade.prepareTransaction({
        ...transaction(),
        ...capped(undefined, { chain: solanaDevnet }),
      })

      expect(named.request).toEqual(shorthand.request)
      expect(named.intentInput).toEqual(shorthand.intentInput)
      expect(named.execution).toEqual(shorthand.execution)
    })

    test.each([
      ['a token amount above the cap', capped(99n), /exceeds/],
      [
        'another mint',
        capped(100n, {
          token: solanaAddress('11111111111111111111111111111113'),
        }),
        /mint the transfer sends/,
      ],
      [
        'another cluster',
        capped(100n, { chain: solanaMainnet }),
        /own cluster only/,
      ],
      ['a zero cap', capped(0n), /positive bigint/],
      ['a source list', { source: [{ token: mint }] }, /must be an object/],
    ])('refuses %s before quoting', async (_name, patch, reason) => {
      const { facade, workflows } = fixture()
      const refusal = facade.prepareTransaction({
        ...transaction(),
        ...patch,
      } as never)

      await expect(refusal).rejects.toBeInstanceOf(
        UnsupportedAccountCapabilityError,
      )
      await expect(refusal).rejects.toThrow(reason)
      expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
    })
  })

  describe('with native SOL', () => {
    const sol = solanaAddress('11111111111111111111111111111111')
    const nativeSolMessage =
      'A same-chain Solana transfer cannot send native SOL; name an SPL mint.'

    test.each([
      [
        'the destination token',
        { destination: { ...transaction().destination, token: sol } },
        nativeSolMessage,
        'destination.token',
      ],
      [
        'the destination and source token',
        {
          source: { token: sol, maxAmount: 100n },
          destination: { ...transaction().destination, token: sol },
        },
        nativeSolMessage,
        'destination.token',
      ],
      [
        'the source token',
        { source: { token: sol, maxAmount: 100n } },
        '`source.token` must be the mint the transfer sends, `destination.token`.',
        'source.token',
      ],
    ])(
      'refuses it as %s before quoting',
      async (_name, patch, message, field) => {
        const { facade, workflows } = fixture()
        const refusal = facade.prepareTransaction({
          ...transaction(),
          ...patch,
        } as never)

        await expect(refusal).rejects.toBeInstanceOf(
          UnsupportedAccountCapabilityError,
        )
        await expect(refusal).rejects.toMatchObject({
          message,
          context: { vm: 'solana', field },
        })
        expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
      },
    )

    test('refuses a persisted artifact that sends it', async () => {
      const { facade, workflows } = fixture()
      const prepared = await facade.prepareTransaction(transaction())
      const signed = await facade.signTransaction(prepared)
      workflows.signSolanaIntent.mockClear()
      const persisted = {
        ...prepared.transaction,
        source: { token: sol },
        destination: { ...transaction().destination, token: sol },
      } as never

      await expect(
        facade.signTransaction({ ...prepared, transaction: persisted }),
      ).rejects.toThrow(UnsupportedAccountCapabilityError)
      await expect(
        facade.submitTransaction({ ...signed, transaction: persisted }),
      ).rejects.toThrow(UnsupportedAccountCapabilityError)
      expect(workflows.signSolanaIntent).not.toHaveBeenCalled()
      expect(workflows.submitSolanaIntent).not.toHaveBeenCalled()
    })
  })

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

  // A Solana origin authorizes its spend with a personal-sign proof first, and
  // a plain delivery asks for nothing else: an empty, doubled, or EVM-shaped
  // proof vector is refused before submission.
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
          destination: {
            ...prepared.transaction.destination,
            recipient: solanaAddress('11111111111111111111111111111113'),
          },
        } as never,
      }),
    ],
    [
      'mint',
      (prepared: PreparedTransactionData) => {
        const other = solanaAddress('11111111111111111111111111111113')
        const { source, destination } = prepared.transaction as ReturnType<
          typeof transaction
        >
        return {
          ...prepared,
          transaction: {
            ...prepared.transaction,
            source: { ...source, token: other },
            destination: { ...destination, token: other },
          } as never,
        }
      },
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

  // The binding version is checked before the transaction: a `caucasus-1`
  // artifact still carries the flat shape, and must fail as an earlier wire
  // version rather than as a malformed transaction.
  test.each([
    ['a caucasus-1 binding', { version: 'caucasus-1' }],
    ['no binding', undefined],
  ])(
    'refuses a Solana prepared artifact with %s before any effect',
    async (_name, binding) => {
      const { facade, workflows } = fixture()
      const prepared = await facade.prepareTransaction(transaction())
      const signed = await facade.signTransaction(prepared)
      vi.clearAllMocks()
      const legacyFields = {
        request: binding && { ...prepared.request, ...binding },
        transaction: {
          chain: solanaDevnet,
          tokenRequests: [{ address: mint, amount: 100n }],
          recipient,
        },
      }
      const legacy = {
        ...prepared,
        ...legacyFields,
      } as unknown as PreparedTransactionData
      const legacySigned = {
        ...signed,
        ...legacyFields,
      } as unknown as SignedTransactionData

      expect(() => facade.getTransactionMessages(legacy)).toThrow(
        InvalidPreparedTransactionError,
      )
      await expect(facade.signTransaction(legacy)).rejects.toThrow(
        InvalidPreparedTransactionError,
      )
      await expect(facade.assembleTransaction(legacy, [])).rejects.toThrow(
        InvalidPreparedTransactionError,
      )
      await expect(facade.signAuthorizations(legacy)).rejects.toThrow(
        InvalidPreparedTransactionError,
      )
      await expect(facade.submitTransaction(legacySigned)).rejects.toThrow(
        InvalidPreparedTransactionError,
      )
      for (const workflow of [
        workflows.reconstructSolanaIntent,
        workflows.signSolanaIntent,
        workflows.submitSolanaIntent,
        workflows.signIntentFromRequests,
      ]) {
        expect(workflow).not.toHaveBeenCalled()
      }
    },
  )

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

  test('routes a stored shorthand transaction to the Solana binding check', async () => {
    const { facade, workflows } = fixture()
    const prepared = await facade.prepareTransaction(transaction())
    const tampered = {
      ...prepared,
      transaction: {
        ...transaction(),
        destination: {
          ...transaction().destination,
          recipient: solanaAddress('11111111111111111111111111111113'),
        },
      },
    } as unknown as PreparedTransactionData
    expect(() => facade.getTransactionMessages(tampered)).toThrow(
      InvalidSolanaTransactionArtifactError,
    )
    await expect(facade.signTransaction(tampered)).rejects.toThrow(
      InvalidSolanaTransactionArtifactError,
    )
    expect(workflows.signSolanaIntent).not.toHaveBeenCalled()
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
        destination: { chain: optimism },
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

  test('keeps plain Solana requests independent when live EVM fields mutate', async () => {
    const { facade, workflows } = fixture()
    ;(facade.config.evm as LegacyAccountConfig<unknown>).account = {
      type: 'hca',
    }

    await facade.prepareTransaction(transaction())
    expect(workflows.prepareSolanaIntent).toHaveBeenCalledWith(
      expect.objectContaining({ accountAddress: swig.wallet }),
    )
    expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).not.toHaveProperty(
      'accountType',
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
        destination: {
          ...signed.intentInput.destination,
          recipient: {
            address: solanaAddress('11111111111111111111111111111113'),
          },
        },
      },
    } as SignedTransactionData
    await expect(first.facade.submitTransaction(changedInput)).rejects.toThrow(
      InvalidSolanaTransactionArtifactError,
    )
    const changedRequest = {
      ...prepared,
      request: {
        ...prepared.request,
        request: {
          ...(prepared.request.request as Record<string, unknown>),
          account: { evm: { type: 'eoa', address: owner.address } },
        },
      },
    }
    await expect(second.facade.signTransaction(changedRequest)).rejects.toThrow(
      /persisted request/,
    )
    expect(first.workflows.submitSolanaIntent).not.toHaveBeenCalled()
  })

  describe('instruction execution', () => {
    const program = solanaAddress('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')
    const normalized = [
      {
        programId: program,
        accounts: [{ pubkey: mint, isSigner: false, isWritable: true }],
        data: 'AQID',
      },
    ]

    function destination() {
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

    function instructionTransaction() {
      return { destination: destination(), sponsored: true }
    }

    test('routes a sponsored execution to the Solana workflow with no source', async () => {
      const { facade, workflows } = fixture()
      const prepared = await facade.prepareTransaction(instructionTransaction())

      expect(prepared.transaction).toMatchObject({
        destination: { instructions: normalized },
      })
      expect(prepared.transaction).not.toHaveProperty('source')
      expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
        action: { kind: 'instructions', instructions: normalized },
      })
      expect(
        workflows.prepareSolanaIntent.mock.calls[0]?.[0].action,
      ).not.toHaveProperty('feeToken')
      expect(prepared.execution).toEqual({
        kind: 'solana-instructions',
        namespace: 'dev-v1',
        endpoint: expect.any(String),
        chain: 792703810,
        caip2: solanaDevnet.caip2,
        accountAddress: swig.wallet,
        authority: owner.address,
        swigAddress: expect.any(String),
        walletAddress: expect.any(String),
      })
      expect(prepared.request.request).toEqual({
        account: {
          svm: {
            type: 'swig',
            address: swig.wallet,
            swigAccount: swig.swig,
            authorization: { kind: 'secp256k1', address: owner.address },
          },
        },
        destination: {
          vm: 'svm',
          chainId: solanaDevnet.caip2,
          execution: { instructions: normalized },
        },
        options: {
          sponsorship: {
            gas: true,
            bridgeFees: true,
            swapFees: true,
            protocolFees: true,
          },
        },
      })
      expect(prepared.intentInput).not.toHaveProperty('source')
      expect(prepared.intentInput.destination).toEqual({
        vm: 'svm',
        chainId: solanaDevnet.caip2,
        execution: { instructions: normalized },
      })
    })

    test('accepts object sponsorship on a source-free execution', async () => {
      const { facade, workflows } = fixture()
      await facade.prepareTransaction({
        destination: destination(),
        sponsored: { gas: true, bridging: false, swaps: false },
      })

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
      ['no sponsorship', {}],
      ['sponsorship without gas', { sponsored: false }],
      [
        'object sponsorship without gas',
        { sponsored: { gas: false, bridging: true, swaps: true } },
      ],
    ])(
      'refuses a source-free execution with %s before quoting',
      async (_name, sponsorship) => {
        const { facade, workflows } = fixture()
        const refusal = facade.prepareTransaction({
          destination: destination(),
          ...sponsorship,
        } as never)

        await expect(refusal).rejects.toBeInstanceOf(
          UnsupportedAccountCapabilityError,
        )
        await expect(refusal).rejects.toMatchObject({
          message: expect.stringMatching(
            /not gas-sponsored needs `source.token`/,
          ),
          context: { vm: 'solana', field: 'source' },
        })
        expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
      },
    )

    test('pays an unsponsored execution in the source token', async () => {
      const { facade, workflows } = fixture()
      const prepared = await facade.prepareTransaction({
        source: { token: mint },
        destination: destination(),
      })

      expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
        action: { kind: 'instructions', feeToken: mint },
      })
      expect(
        workflows.prepareSolanaIntent.mock.calls[0]?.[0],
      ).not.toHaveProperty('sponsorSettings')
      expect(prepared.request.request).toMatchObject({
        source: { vm: 'svm', chainId: solanaDevnet.caip2, token: mint },
        destination: {
          vm: 'svm',
          chainId: solanaDevnet.caip2,
          execution: { instructions: normalized },
        },
      })
      expect(prepared.request.request).not.toHaveProperty('options')
      expect(prepared.intentInput.source).toEqual({
        vm: 'svm',
        chainId: solanaDevnet.caip2,
        token: mint,
      })
      await facade.submitTransaction(await facade.signTransaction(prepared))
      expect(workflows.submitSolanaIntent).toHaveBeenCalledOnce()
    })

    test.each([
      [
        'a recipient',
        { destination: { ...destination(), recipient } },
        'destination.recipient',
      ],
      [
        'a delivery token',
        { destination: { ...destination(), token: mint } },
        'destination.token',
      ],
      [
        'EVM calls',
        { destination: { ...destination(), calls: [] } },
        'destination.calls',
      ],
      ['app fees', { appFees: { feeBps: 10 } }, 'appFees'],
      ['protocol fees', { protocolFees: { feeBps: 10 } }, 'protocolFees'],
      [
        'a source cap',
        { source: { token: mint, maxAmount: 1n } },
        'source.maxAmount',
      ],
    ])('refuses instructions combined with %s', async (_name, patch, field) => {
      const { facade, workflows } = fixture()
      const refusal = facade.prepareTransaction({
        ...instructionTransaction(),
        ...patch,
      } as never)

      await expect(refusal).rejects.toBeInstanceOf(
        UnsupportedAccountCapabilityError,
      )
      await expect(refusal).rejects.toMatchObject({ context: { field } })
      expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
    })

    test('refuses malformed instructions and lookup tables before quoting', async () => {
      const { facade, workflows } = fixture()

      await expect(
        facade.prepareTransaction({
          destination: { chain: solanaDevnet, instructions: [] },
          sponsored: true,
        } as never),
      ).rejects.toThrow(InvalidSolanaTransactionArtifactError)
      await expect(
        facade.prepareTransaction({
          ...instructionTransaction(),
          destination: {
            ...destination(),
            addressLookupTables: ['not-base58'],
          },
        } as never),
      ).rejects.toThrow(InvalidSolanaTransactionArtifactError)
      expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
    })

    test('refuses lookup tables without instructions', async () => {
      const { facade } = fixture()

      await expect(
        facade.prepareTransaction({
          ...transaction(),
          destination: {
            ...transaction().destination,
            addressLookupTables: [mint],
          },
        } as never),
      ).rejects.toThrow(UnsupportedAccountCapabilityError)
    })
  })

  describe('authority change', () => {
    const authority = {
      action: 'add' as const,
      key: { type: 'ecdsa' as const, publicKey: guardian.publicKey },
      permission: 'all' as const,
    }
    const change = { destination: { chain: solanaDevnet, authority } }

    test('sends a sponsored, source-free change of this Swig', async () => {
      const { facade, workflows } = fixture()
      const prepared = await facade.prepareTransaction(change)

      expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
        accountAddress: swig.wallet,
        action: {
          kind: 'authority',
          change: { action: 'add', keyType: 'ecdsa', permission: 'all' },
        },
      })
      expect(prepared.request.request).not.toHaveProperty('source')
      expect(prepared.request.request).toMatchObject({
        destination: {
          vm: 'svm',
          chainId: solanaDevnet.caip2,
          execution: {
            authority: { action: 'add', permission: 'all' },
          },
        },
        options: {
          sponsorship: { gas: true, bridgeFees: false, swapFees: false },
        },
      })
      expect(prepared.intentInput).not.toHaveProperty('source')
    })

    test('reports its status from the same shape', async () => {
      const { facade, workflows } = fixture()

      await expect(facade.getAuthorityStatus(change)).resolves.toEqual({
        status: 'notApplied',
      })
      expect(workflows.prepareSolanaIntent).toHaveBeenCalledOnce()
    })

    test.each([
      ['the flat shape', { chain: solanaDevnet, authority }],
      ['a transfer', transaction()],
    ])('refuses %s as an authority status query', async (_name, query) => {
      const { facade, workflows } = fixture()
      const refusal = facade.getAuthorityStatus(query as never)

      await expect(refusal).rejects.toBeInstanceOf(
        UnsupportedAccountCapabilityError,
      )
      await expect(refusal).rejects.toMatchObject({
        context: { field: 'destination.authority' },
      })
      expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
    })

    test.each([
      ['a source', { source: { token: mint } }, 'source'],
      ['sponsorship', { sponsored: true }, 'sponsored'],
    ])('refuses a change with %s', async (_name, patch, field) => {
      const { facade, workflows } = fixture()
      const refusal = facade.prepareTransaction({
        ...change,
        ...patch,
      } as never)

      await expect(refusal).rejects.toMatchObject({ context: { field } })
      expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
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

  function spendRequest(
    location: {
      readonly wallet: SolanaAddress
      readonly swig: SolanaAddress
    } = swig,
  ): SigningRequest {
    return personalSignRequest({
      chainId: solanaDevnet.caip2,
      wallet: location.wallet,
      swigAccount: location.swig,
      authority: owner.address,
      message,
      expiresAtSlot: '123',
    })
  }

  function quote(
    intentId: string,
    location: {
      readonly wallet: SolanaAddress
      readonly swig: SolanaAddress
    } = swig,
    input = 101n,
  ): OrchestratorExecutionQuote {
    return {
      ...caucasusQuote({
        intentId,
        expiresAt: 2_000_000_000,
        settlementLayer: 'RELAY',
        signingRequests: [spendRequest(location)],
        cost: {
          input: [
            {
              chainId: solanaDevnet.caip2,
              tokenAddress: mint,
              symbol: 'USDC',
              decimals: 6,
              price: { usd: 1 },
              amount: input,
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

  function fixture(
    best = quote('best'),
    explicitSwig = managedSwig,
    environment: 'development' | 'production' = 'development',
  ) {
    const endpoint = {
      endpointUrl:
        environment === 'development'
          ? DEV_ORCHESTRATOR_URL
          : PROD_ORCHESTRATOR_URL,
      useDevContracts: environment === 'development',
    }
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
      ...endpoint,
    }
    const prepareSolanaIntent = vi.fn(async (input) => ({
      traceId: 'prepare-trace',
      input,
      ...buildSolanaIntentRequest(input),
      quote: best,
      quotes: [best],
    }))
    const signSolanaIntent = vi.fn(async ({ prepared, owner: signer }) => ({
      prepared,
      proofs: [
        {
          kind: 'personalSign' as const,
          signature: await signer.signMessage({ message }),
        },
      ],
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
      prepareSolanaIntent,
      reconstructSolanaIntent: vi.fn(reconstructSolanaIntent),
      signIntentFromRequests: vi.fn(async () => {
        throw new Error('EVM signing must not run')
      }),
      signSolanaIntent,
      submitSolanaIntent,
      waitForIntentStatus,
    }
    const facade = createAccountFacade(
      compatibilityConfig,
      {
        evm: compatibilityConfig as EvmAccountConfig,
        solana: {
          owner: { type: 'ecdsa', account: owner },
          swig: explicitSwig,
        },
      },
      {
        config: resolveSdkConfig({ apiKey: 'offline', ...endpoint }),
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
      source: { chain: solanaDevnet, token: mint },
      destination: {
        chain: optimism,
        token: destinationToken as `0x${string}`,
        amount: 100n,
      },
    }
  }

  function withDestination(patch: object) {
    return {
      ...transaction(),
      destination: { ...transaction().destination, ...patch },
    }
  }

  test('quotes an EVM delivery from the named cluster and mint, and reports the EVM target', async () => {
    const { facade, workflows } = fixture()
    const prepared = await facade.prepareTransaction(transaction())

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
    expect(prepared.request.request).toEqual({
      account: {
        svm: {
          type: 'swig',
          address: swig.wallet,
          swigAccount: swig.swig,
          authorization: { kind: 'secp256k1', address: owner.address },
        },
      },
      source: { vm: 'svm', chainId: solanaDevnet.caip2, token: mint },
      destination: {
        vm: 'evm',
        chainId: formatCaip2(optimism.id),
        token: destinationToken,
        amount: '100',
        recipient: { address: owner.address },
      },
    })
    expect(prepared.intentInput).toEqual(
      toSponsorshipApprovalInput(prepared.request.request),
    )
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
    expect(workflows.signIntentFromRequests).not.toHaveBeenCalled()
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
        destination: { chain: optimism },
        sponsored: true,
      }).options?.sponsorSettings,
    })
  })

  test('prefers an explicit recipient and does not mutate the caller request', async () => {
    const { facade, workflows } = fixture()
    const request = withDestination({ recipient: guardian.address })
    const prepared = await facade.prepareTransaction(request)

    expect(request.destination).toMatchObject({ recipient: guardian.address })
    expect(Object.isFrozen(request)).toBe(false)
    expect(Object.isFrozen(request.destination)).toBe(false)
    expect(prepared.execution).toMatchObject({ recipient: guardian.address })
    expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
      action: { delivery: { recipient: guardian.address } },
    })
  })

  test.each([
    [
      'source calls',
      { source: { ...transaction().source, calls: [] } },
      'source.calls',
    ],
    [
      'source auxiliary funds',
      { source: { ...transaction().source, auxiliaryFunds: 1n } },
      'source.auxiliaryFunds',
    ],
    [
      'calls with an explicit recipient',
      withDestination({
        calls: [{ to: destinationToken }],
        recipient: guardian.address,
      }),
      'destination.recipient',
    ],
    [
      'a gas limit without calls',
      withDestination({ gasLimit: 100_000n }),
      'destination.gasLimit',
    ],
    [
      'an EIP-7702 init signature without calls',
      { ...withDestination({ calls: [] }), eip7702InitSignature: '0x12' },
      'eip7702InitSignature',
    ],
    [
      'instructions',
      withDestination({ instructions: [] }),
      'destination.instructions',
    ],
    [
      'hyperCore',
      withDestination({ hyperCore: { closePerp: { asset: 'ETH' } } }),
      'destination.hyperCore',
    ],
    [
      'a settlement layer filter',
      { settlementLayers: { include: ['RELAY'] } },
      'settlementLayers',
    ],
    [
      'a flat source chain list',
      { sourceChains: [solanaDevnet] },
      'sourceChains',
    ],
    ['a source list', { source: [transaction().source] }, 'source'],
    [
      'a zero source cap',
      { source: { ...transaction().source, maxAmount: 0n } },
      'source.maxAmount',
    ],
    [
      'a negative source cap',
      { source: { ...transaction().source, maxAmount: -1n } },
      'source.maxAmount',
    ],
    [
      'a numeric source cap',
      { source: { ...transaction().source, maxAmount: 1 } },
      'source.maxAmount',
    ],
    [
      'an earlier source spelling',
      { source: { ...transaction().source, address: mint } },
      'source.address',
    ],
    [
      'a source on a forged cluster',
      {
        source: {
          chain: { ...solanaDevnet, name: 'Forged' },
          token: mint,
        },
      },
      'source.chain',
    ],
    [
      'an invalid source mint',
      { source: { chain: solanaDevnet, token: 'not-a-mint' } },
      'source.token',
    ],
    [
      'a Solana destination on another cluster',
      { destination: { chain: solanaMainnet, token: mint, recipient: mint } },
      'source.chain',
    ],
    [
      'a base58 recipient',
      withDestination({ recipient: mint }),
      'destination.recipient',
    ],
    [
      'a zero delivery amount',
      withDestination({ amount: 0n }),
      'destination.amount',
    ],
    [
      'a base58 delivery token',
      withDestination({ token: mint }),
      'destination.token',
    ],
    [
      'no delivery token',
      withDestination({ token: undefined, amount: undefined }),
      'destination.token',
    ],
  ])('refuses %s before quoting', async (_name, patch, field) => {
    const { facade, workflows } = fixture()
    const refusal = facade.prepareTransaction({
      ...transaction(),
      ...patch,
    } as never)

    await expect(refusal).rejects.toBeInstanceOf(
      UnsupportedAccountCapabilityError,
    )
    await expect(refusal).rejects.toMatchObject({ context: { field } })
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
      transaction: withDestination({ recipient: guardian.address }),
    }

    await expect(facade.signTransaction(tampered)).rejects.toThrow(
      InvalidSolanaTransactionArtifactError,
    )
    expect(workflows.signSolanaIntent).not.toHaveBeenCalled()
  })

  describe('with destination calls', () => {
    const call = {
      to: '0x00000000000000000000000000000000000000c1',
      data: '0xabcdef',
    } as const
    const resolvedCall = { target: call.to, value: 0n, data: call.data }
    const setupOp = {
      to: '0x000000000000000000000000000000000000fac7',
      data: '0xfac7',
    } as const
    const childRequest = eip712Request({
      chainId: optimism.id,
      account: owner.address,
    })
    const childProof = {
      kind: 'eip712' as const,
      signature: `0x${'11'.repeat(65)}` as const,
    }

    function callsFixture(
      location: typeof swig = swig,
      environment: 'development' | 'production' = 'development',
    ) {
      const base = fixture(
        {
          ...quote('best', location),
          signingRequests: [spendRequest(location), childRequest],
        },
        location.swig,
        environment,
      )
      const resolveSolanaEvmDestination = vi.fn(async () => ({
        calls: [resolvedCall],
        account: {
          kind: 'erc7579' as const,
          address: owner.address,
          setupOps: [setupOp],
        },
      }))
      const signIntentFromRequests = vi.fn(async () => ({
        proofs: [childProof],
        transcript: {},
      }))
      Object.assign(base.workflows, {
        resolveSolanaEvmDestination,
        signIntentFromRequests,
        signSolanaIntent: vi.fn(
          (input: Parameters<typeof signSolanaIntent>[0]) =>
            signSolanaIntent({ ...input, now: () => 1_900_000_000_000 }),
        ),
      })
      return { ...base, resolveSolanaEvmDestination, signIntentFromRequests }
    }

    function callsTransaction() {
      return withDestination({ calls: [call], gasLimit: 200_000n })
    }

    test('resolves the calls on the paired account and signs its requests before the spend', async () => {
      const {
        facade,
        workflows,
        resolveSolanaEvmDestination,
        signIntentFromRequests,
      } = callsFixture()
      const prepared = await facade.prepareTransaction(callsTransaction())

      expect(resolveSolanaEvmDestination).toHaveBeenCalledWith(
        expect.anything(),
        { chain: toEvmChainReference(optimism.id), calls: [resolvedCall] },
      )
      expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
        action: {
          delivery: {
            recipient: owner.address,
            execution: {
              calls: [resolvedCall],
              gasLimit: 200_000n,
              account: { setupOps: [setupOp] },
            },
          },
        },
      })
      expect(prepared.request.request).toMatchObject({
        account: { evm: { initData: { setupOps: [setupOp] } } },
        source: { vm: 'svm', chainId: solanaDevnet.caip2, token: mint },
        destination: {
          vm: 'evm',
          chainId: formatCaip2(optimism.id),
          token: destinationToken,
          amount: '100',
          execution: {
            calls: [{ to: call.to, value: '0', data: call.data }],
            gasLimit: '200000',
          },
        },
      })
      expect(prepared.request.request).not.toHaveProperty(
        'destination.recipient',
      )

      const signed = await facade.signTransaction(prepared)
      expect(signIntentFromRequests).toHaveBeenCalledWith(expect.anything(), {
        signingRequests: [childRequest],
        targetChain: toEvmChainReference(optimism.id),
      })
      expect(signed.proofs).toEqual([
        { kind: 'personalSign', signature: expect.any(String) },
        childProof,
      ])
      await facade.submitTransaction(signed)
      expect(workflows.submitSolanaIntent.mock.calls[0]?.[0].proofs).toEqual(
        signed.proofs,
      )
      // Signing and submitting replay the prepared calls rather than resolving
      // them again.
      expect(resolveSolanaEvmDestination).toHaveBeenCalledOnce()
    })

    test('replays a prepared transaction on another instance from its canonical input', async () => {
      const prepared = await callsFixture().facade.prepareTransaction(
        callsTransaction(),
      )
      const other = callsFixture()

      await expect(
        other.facade.signTransaction(prepared),
      ).resolves.toMatchObject({
        proofs: [{ kind: 'personalSign' }, childProof],
      })
      expect(other.resolveSolanaEvmDestination).not.toHaveBeenCalled()

      const { execution: _execution, ...plainDestination } = prepared
        .intentInput.destination as Record<string, unknown>
      for (const tampered of [
        { ...prepared, transaction: transaction() },
        {
          ...prepared,
          intentInput: {
            ...prepared.intentInput,
            destination: plainDestination,
          } as never,
        },
      ]) {
        await expect(other.facade.signTransaction(tampered)).rejects.toThrow(
          InvalidSolanaTransactionArtifactError,
        )
      }
    })

    test('refuses an independently selected Swig before destination-call effects', async () => {
      const otherLocation = locateSwig(
        asSwigNamespace('dev-v1'),
        guardian.address,
      )
      const base = fixture(quote('best'), otherLocation.swig)
      const resolveSolanaEvmDestination = vi.fn()
      Object.assign(base.workflows, { resolveSolanaEvmDestination })

      const prepared = await base.facade.prepareTransaction(transaction())
      base.workflows.prepareSolanaIntent.mockClear()

      await expect(
        base.facade.prepareTransaction(callsTransaction()),
      ).rejects.toThrow(/independently selected Swig/)
      const replayWithCalls = {
        ...prepared,
        transaction: withDestination({ calls: [call] }),
      }
      expect(() => base.facade.getTransactionMessages(replayWithCalls)).toThrow(
        /independently selected Swig/,
      )
      await expect(
        base.facade.signTransaction(replayWithCalls),
      ).rejects.toThrow(/independently selected Swig/)
      expect(resolveSolanaEvmDestination).not.toHaveBeenCalled()
      expect(base.workflows.prepareSolanaIntent).not.toHaveBeenCalled()
    })

    test('runs calls from the prod-v1 Swig of a production account', async () => {
      const prodSwig = locateSwig(asSwigNamespace('prod-v1'), owner.address)
      const { facade, workflows } = callsFixture(prodSwig, 'production')
      const prepared = await facade.prepareTransaction(callsTransaction())

      expect(prepared.execution).toMatchObject({
        namespace: 'prod-v1',
        swigAddress: prodSwig.swig,
      })
      await facade.submitTransaction(await facade.signTransaction(prepared))
      expect(workflows.submitSolanaIntent).toHaveBeenCalledOnce()
    })

    test('refuses calls from the dev-v1 Swig on a production account', async () => {
      const { facade, resolveSolanaEvmDestination } = callsFixture(
        swig,
        'production',
      )

      await expect(
        facade.prepareTransaction(callsTransaction()),
      ).rejects.toThrow(/independently selected Swig/)
      expect(resolveSolanaEvmDestination).not.toHaveBeenCalled()
    })

    test('passes an EIP-7702 init signature to the destination resolution', async () => {
      const { facade, resolveSolanaEvmDestination } = callsFixture()
      const eip7702InitSignature = `0x${'22'.repeat(65)}` as const
      await facade.prepareTransaction({
        ...callsTransaction(),
        eip7702InitSignature,
      })

      expect(resolveSolanaEvmDestination).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eip7702InitSignature }),
      )
    })

    test('refuses a proof vector missing the destination proof before submission', async () => {
      const { facade, workflows } = callsFixture()
      const signed = await facade.signTransaction(
        await facade.prepareTransaction(callsTransaction()),
      )

      await expect(
        facade.submitTransaction({ ...signed, proofs: [signed.proofs[0]!] }),
      ).rejects.toThrow(InvalidSolanaTransactionArtifactError)
      expect(workflows.submitSolanaIntent).not.toHaveBeenCalled()
    })
  })

  describe('with a source amount cap', () => {
    const cap = 101n
    // `null` names no cap; `undefined` would take the default.
    function cappedTransaction(maxAmount: bigint | null = cap) {
      return {
        ...transaction(),
        source: {
          chain: solanaDevnet,
          token: mint,
          ...(maxAmount === null ? {} : { maxAmount }),
        },
      }
    }
    // Persisted artifacts carry bigints; callers round-trip them losslessly.
    function roundTrip<T>(value: T): T {
      return JSON.parse(
        JSON.stringify(value, (_key, item) =>
          typeof item === 'bigint' ? { $bigint: item.toString() } : item,
        ),
        (_key, item) =>
          item && typeof item === 'object' && '$bigint' in item
            ? BigInt(item.$bigint)
            : item,
      )
    }

    test('sends the cap as the source maxAmount and signs within it', async () => {
      const { facade, workflows } = fixture()
      const prepared = await facade.prepareTransaction(cappedTransaction())

      expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
        action: { mint, amount: 100n, sourceLimit: cap },
      })
      const source = {
        vm: 'svm',
        chainId: solanaDevnet.caip2,
        token: mint,
        maxAmount: '101',
      }
      expect(prepared.request.request).toMatchObject({ source })
      expect(prepared.intentInput.source).toEqual(source)
      expect(
        Object.isFrozen((prepared.transaction as { source?: object }).source),
      ).toBe(true)

      const other = fixture()
      const signed = await other.facade.signTransaction(roundTrip(prepared))
      await other.facade.submitTransaction(roundTrip(signed))
      expect(other.workflows.submitSolanaIntent).toHaveBeenCalledOnce()
    })

    test('sends no maxAmount without a cap', async () => {
      const { facade } = fixture()
      const uncapped = await facade.prepareTransaction(transaction())
      const noAmount = await facade.prepareTransaction(cappedTransaction(null))

      expect(noAmount.request).toEqual(uncapped.request)
      expect(noAmount.intentInput).toEqual(uncapped.intentInput)
      expect(uncapped.request.request).not.toHaveProperty('source.maxAmount')
    })

    test('refuses a quote debiting more than the cap before signing', async () => {
      const { facade, workflows } = fixture(quote('best', swig, cap + 1n))
      const prepared = await facade.prepareTransaction(cappedTransaction())

      await expect(facade.signTransaction(prepared)).rejects.toThrow(
        /exceeds the source amount cap/,
      )
      expect(workflows.signSolanaIntent).not.toHaveBeenCalled()
    })

    test.each([
      [
        'a raised cap in the transaction',
        (prepared: PreparedTransactionData) => ({
          ...prepared,
          transaction: cappedTransaction(cap + 1n),
        }),
      ],
      [
        'a cap removed from the transaction',
        (prepared: PreparedTransactionData) => ({
          ...prepared,
          transaction: cappedTransaction(null),
        }),
      ],
      [
        'a cap removed from the request',
        (prepared: PreparedTransactionData) => {
          const request = prepared.request.request as {
            source: Record<string, unknown>
          }
          const { maxAmount: _maxAmount, ...source } = request.source
          return {
            ...prepared,
            request: { ...prepared.request, request: { ...request, source } },
          }
        },
      ],
      [
        'a cap changed in the intent input',
        (prepared: PreparedTransactionData) => ({
          ...prepared,
          intentInput: {
            ...prepared.intentInput,
            source: { ...prepared.intentInput.source!, maxAmount: '1000' },
          },
        }),
      ],
    ])('refuses %s on sign and submit', async (_name, tamper) => {
      const { facade, workflows } = fixture()
      const prepared = await facade.prepareTransaction(cappedTransaction())
      const signed = await facade.signTransaction(prepared)
      workflows.signSolanaIntent.mockClear()

      await expect(
        facade.signTransaction(tamper(prepared) as never),
      ).rejects.toThrow(InvalidSolanaTransactionArtifactError)
      await expect(
        facade.submitTransaction({
          ...signed,
          ...tamper(signed),
        } as SignedTransactionData),
      ).rejects.toThrow(InvalidSolanaTransactionArtifactError)
      expect(workflows.signSolanaIntent).not.toHaveBeenCalled()
      expect(workflows.submitSolanaIntent).not.toHaveBeenCalled()
    })

    test('refuses a cap added to an uncapped artifact', async () => {
      const { facade, workflows } = fixture()
      const prepared = await facade.prepareTransaction(transaction())

      await expect(
        facade.signTransaction({
          ...prepared,
          transaction: cappedTransaction(),
        }),
      ).rejects.toThrow(/persisted request/)
      expect(workflows.signSolanaIntent).not.toHaveBeenCalled()
    })
  })

  describe('with a native SOL source', () => {
    const sol = solanaAddress('11111111111111111111111111111111')
    function solQuote(input = 101n): OrchestratorExecutionQuote {
      const base = quote('best', swig, input)
      return {
        ...base,
        cost: {
          ...base.cost,
          input: [
            {
              ...base.cost.input[0]!,
              tokenAddress: sol,
              symbol: 'SOL',
              decimals: 9,
            },
          ],
        },
      }
    }
    function solTransaction(maxAmount?: bigint) {
      return {
        ...transaction(),
        source: {
          chain: solanaDevnet,
          token: sol,
          ...(maxAmount === undefined ? {} : { maxAmount }),
        },
      }
    }

    test.each([
      ['uncapped', undefined],
      ['capped', 101n],
    ])('prepares, signs and submits it %s', async (_name, cap) => {
      const { facade, workflows } = fixture(solQuote())
      const prepared = await facade.prepareTransaction(solTransaction(cap))

      expect(workflows.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
        action: {
          kind: 'transfer',
          mint: sol,
          amount: 100n,
          delivery: { kind: 'cross-chain', chainId: optimism.id },
        },
      })
      expect(
        workflows.prepareSolanaIntent.mock.calls[0]?.[0].action.sourceLimit,
      ).toBe(cap)
      expect((prepared.request.request as { source: unknown }).source).toEqual({
        vm: 'svm',
        chainId: solanaDevnet.caip2,
        token: sol,
        ...(cap === undefined ? {} : { maxAmount: cap.toString() }),
      })
      expect(prepared.execution).toMatchObject({
        kind: 'solana-cross-chain',
        mint: sol,
      })
      await facade.submitTransaction(await facade.signTransaction(prepared))
      expect(workflows.submitSolanaIntent).toHaveBeenCalledOnce()
    })

    test('refuses a quote debiting more than the cap before signing', async () => {
      const { facade, workflows } = fixture(solQuote(102n))
      const prepared = await facade.prepareTransaction(solTransaction(101n))

      await expect(facade.signTransaction(prepared)).rejects.toThrow(
        /exceeds the source amount cap/,
      )
      expect(workflows.signSolanaIntent).not.toHaveBeenCalled()
    })
  })

  test.each([
    [
      'sourceTokens',
      [{ address: mint }],
      '`sourceTokens` was replaced by `source.token`.',
    ],
    [
      'sourceAssets',
      [{ chain: solanaDevnet, address: mint }],
      '`sourceAssets` was replaced by `source.token` and `source.maxAmount`.',
    ],
  ])('refuses a leftover `%s` by name', async (field, value, message) => {
    const { facade, workflows } = fixture()
    const legacy = { ...transaction(), [field]: value }

    const refusal = facade.prepareTransaction(legacy as never)
    await expect(refusal).rejects.toBeInstanceOf(
      UnsupportedAccountCapabilityError,
    )
    await expect(refusal).rejects.toMatchObject({ message, context: { field } })
    expect(workflows.prepareSolanaIntent).not.toHaveBeenCalled()
    // An artifact persisted with the field is refused, not reinterpreted.
    const prepared = await facade.prepareTransaction(transaction())
    const signed = await facade.signTransaction(prepared)
    await expect(
      facade.signTransaction({ ...prepared, transaction: legacy as never }),
    ).rejects.toThrow(message)
    await expect(
      facade.submitTransaction({ ...signed, transaction: legacy as never }),
    ).rejects.toThrow(message)
    expect(workflows.submitSolanaIntent).not.toHaveBeenCalled()
  })

  describe('on production', () => {
    const prodSwig = locateSwig(asSwigNamespace('prod-v1'), owner.address)

    test('derives a different Swig from the same EVM account', () => {
      expect(prodSwig.swig).not.toBe(swig.swig)
      expect(prodSwig.wallet).not.toBe(swig.wallet)
    })

    test('prepares, signs and submits a capped delivery bound to prod-v1', async () => {
      const { facade, workflows } = fixture(
        quote('best', prodSwig),
        prodSwig.swig,
        'production',
      )
      const prepared = await facade.prepareTransaction({
        ...transaction(),
        source: { chain: solanaDevnet, token: mint, maxAmount: 101n },
      })

      expect(prepared.execution).toMatchObject({
        kind: 'solana-cross-chain',
        namespace: 'prod-v1',
        endpoint: PROD_ORCHESTRATOR_URL,
        swigAddress: prodSwig.swig,
      })
      await facade.submitTransaction(await facade.signTransaction(prepared))
      expect(workflows.submitSolanaIntent).toHaveBeenCalledOnce()
    })

    test.each([
      ['a production artifact on a development account', 'production'],
      ['a development artifact on a production account', 'development'],
    ] as const)('refuses %s', async (_name, from) => {
      const to = from === 'production' ? 'development' : 'production'
      // The same independently selected Swig on both, so only the environment
      // differs.
      const source = fixture(quote('best'), managedSwig, from)
      const target = fixture(quote('best'), managedSwig, to)
      const prepared = await source.facade.prepareTransaction(transaction())
      const signed = await source.facade.signTransaction(prepared)

      await expect(target.facade.signTransaction(prepared)).rejects.toThrow(
        InvalidSolanaTransactionArtifactError,
      )
      await expect(target.facade.submitTransaction(signed)).rejects.toThrow(
        InvalidSolanaTransactionArtifactError,
      )
      expect(target.workflows.submitSolanaIntent).not.toHaveBeenCalled()
    })
  })
})

describe('standalone managed Solana account facade', () => {
  const mint = solanaAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
  const recipient = solanaAddress('11111111111111111111111111111112')
  const destinationToken = '0x0b2c639c533813f4aa9d7837caf62653d097ff85'
  const message = 'ab'.repeat(32)
  const location = locateSwig(asSwigNamespace('dev-v1'), guardian.address)
  const sdk = resolveSdkConfig({
    apiKey: 'offline',
    endpointUrl: DEV_ORCHESTRATOR_URL,
    useDevContracts: true,
  })
  const ecdsaOwner = { type: 'ecdsa' as const, account: owner }
  const config = {
    solana: {
      owner: ecdsaOwner,
      swig: location.swig,
    },
  }
  const swigLeg = {
    vm: 'svm' as const,
    chainId: solanaDevnet.caip2,
    account: {
      wallet: location.wallet,
      swigAccount: location.swig,
      authority: { kind: 'secp256k1' as const, address: owner.address },
    },
  }

  function quote(
    intentId: 'same-chain' | 'cross-chain',
  ): OrchestratorExecutionQuote {
    const input = costEntry({
      chainId: solanaDevnet.caip2,
      tokenAddress: mint,
      amount: 100n,
    })
    return {
      ...caucasusQuote({
        intentId,
        expiresAt: 2_000_000_000,
        settlementLayer: intentId === 'same-chain' ? 'SAME_CHAIN' : 'RELAY',
        signingRequests: [
          personalSignRequest({
            chainId: solanaDevnet.caip2,
            wallet: location.wallet,
            swigAccount: location.swig,
            authority: owner.address,
            message,
            expiresAtSlot: '123',
          }),
        ],
        cost: {
          ...emptyCost(),
          input: [input],
          output: [
            intentId === 'same-chain'
              ? input
              : costEntry({
                  chainId: formatCaip2(optimism.id),
                  tokenAddress: destinationToken,
                  amount: 100n,
                }),
          ],
        },
      }),
      plan: { source: [swigLeg], destination: swigLeg, deployments: [] },
    }
  }

  const prodSdk = resolveSdkConfig({ apiKey: 'offline' })

  function fixture(
    evmRecipient?: typeof owner.address,
    // What the account captured at creation, and what the SDK runs with now.
    environments: {
      readonly captured?: typeof sdk
      readonly current?: typeof sdk
    } = {},
  ) {
    const captured = environments.captured ?? sdk
    const current = environments.current ?? captured
    const solana = {
      prepareSolanaIntent: vi.fn(async (input) => {
        const best = quote(
          input.action.kind === 'transfer' &&
            input.action.delivery.kind === 'cross-chain'
            ? 'cross-chain'
            : 'same-chain',
        )
        return {
          traceId: 'prepare-trace',
          input,
          ...buildSolanaIntentRequest(input),
          quote: best,
          quotes: [best],
        }
      }),
      reconstructSolanaIntent: vi.fn(reconstructSolanaIntent),
      signSolanaIntent: vi.fn(async ({ prepared, owner: signer }) => ({
        prepared,
        proofs: [
          {
            kind: 'personalSign' as const,
            signature: await signer.signMessage({ message }),
          },
        ],
      })),
      submitSolanaIntent: vi.fn(async ({ prepared }) => ({
        type: 'intent' as const,
        traceId: 'submit-trace',
        intentId: prepared.quote.intentId,
        sourceChains: [792703810],
        targetChain: 792703810,
      })),
    }
    const waitForIntentStatus = vi.fn(async (intentId: string) => ({
      traceId: `status-${intentId}`,
      intentId,
      purpose: 'execution' as const,
      status: 'COMPLETED' as const,
      operations: [],
    }))
    const createAccount = vi.fn((): never => {
      throw new Error('a standalone Solana account has no EVM context')
    })
    const facade = createSolanaAccountFacade(
      {
        owner: ecdsaOwner,
        walletAddress: location.wallet,
        swigAddress: location.swig,
        environment: captured.environment,
        endpoint: captured.orchestratorUrl,
        ...(evmRecipient ? { evmRecipient } : {}),
      },
      (evmRecipient
        ? { ...config, evm: { address: evmRecipient } }
        : config) as Readonly<{
        solana: typeof config.solana
        evm?: { address: typeof owner.address }
      }>,
      {
        config: current,
        project: { solana, waitForIntentStatus } as never,
        createAccount,
      },
    )
    return { facade, solana, waitForIntentStatus, createAccount }
  }

  function transfer() {
    return {
      source: { token: mint },
      destination: {
        chain: solanaDevnet,
        token: mint,
        amount: 100n,
        recipient,
      },
    }
  }

  function delivery() {
    return {
      source: { chain: solanaDevnet, token: mint },
      destination: {
        chain: optimism,
        token: destinationToken as `0x${string}`,
        amount: 100n,
      },
    }
  }

  function deliveryTo(recipient: `0x${string}`) {
    return {
      ...delivery(),
      destination: { ...delivery().destination, recipient },
    }
  }

  test('quotes from the named Swig with no EVM entry and runs the lifecycle without an EVM context', async () => {
    const { facade, solana, waitForIntentStatus, createAccount } = fixture()
    const prepared = await facade.prepareTransaction(transfer())

    const input = solana.prepareSolanaIntent.mock.calls[0]?.[0]
    expect(input).toMatchObject({ accountAddress: location.wallet })
    expect(input).not.toHaveProperty('accountType')
    const account = {
      svm: {
        type: 'swig',
        address: location.wallet,
        swigAccount: location.swig,
        authorization: { kind: 'secp256k1', address: owner.address },
      },
    }
    expect(prepared.request).toEqual({
      version: 'caucasus-singular-1',
      request: {
        account,
        source: { vm: 'svm', chainId: solanaDevnet.caip2, token: mint },
        destination: {
          vm: 'svm',
          chainId: solanaDevnet.caip2,
          token: mint,
          amount: '100',
          recipient: { address: recipient },
        },
      },
    })
    expect(prepared.intentInput).toEqual({
      contractVersion: 'sdk-caucasus-singular-2026-09-v1',
      account,
      source: { vm: 'svm', chainId: solanaDevnet.caip2, token: mint },
      destination: {
        vm: 'svm',
        chainId: solanaDevnet.caip2,
        token: mint,
        amount: '100',
        recipient: { address: recipient },
      },
      options: {},
    })

    expect(facade.getTransactionMessages(prepared)).toEqual(
      prepared.quotes.best.signingRequests,
    )
    const submitted = await facade.submitTransaction(
      await facade.signTransaction(prepared),
    )
    expect(submitted).toMatchObject({ type: 'intent', id: 'same-chain' })
    await expect(facade.waitForExecution(submitted)).resolves.toMatchObject({
      status: 'COMPLETED',
    })
    expect(waitForIntentStatus).toHaveBeenCalledWith('same-chain')
    expect(createAccount).not.toHaveBeenCalled()
  })

  test('binds persisted metadata to the wallet, with no EVM account type, across instances', async () => {
    const prepared = structuredClone(
      await fixture().facade.prepareTransaction(transfer()),
    )

    expect(prepared.execution).toEqual({
      kind: 'solana',
      namespace: 'dev-v1',
      endpoint: sdk.orchestratorUrl,
      chain: 792703810,
      caip2: solanaDevnet.caip2,
      accountAddress: location.wallet,
      authority: owner.address,
      swigAddress: location.swig,
      walletAddress: location.wallet,
      recipient,
      mint,
    })
    const other = fixture()
    await expect(
      other.facade.submitTransaction(
        await other.facade.signTransaction(prepared),
      ),
    ).resolves.toMatchObject({ id: 'same-chain' })

    for (const execution of [
      { ...prepared.execution!, accountType: 'ERC7579' as const },
      { ...prepared.execution!, accountAddress: guardian.address },
    ]) {
      await expect(
        other.facade.signTransaction({ ...prepared, execution }),
      ).rejects.toThrow(InvalidSolanaTransactionArtifactError)
    }
  })

  test('delivers to an EVM chain only to an explicit recipient', async () => {
    const { facade, solana } = fixture()

    await expect(
      facade.prepareTransaction(delivery() as never),
    ).rejects.toThrow(/needs an explicit EVM `destination.recipient`/)
    expect(solana.prepareSolanaIntent).not.toHaveBeenCalled()

    const prepared = await facade.prepareTransaction(
      deliveryTo(guardian.address),
    )
    expect(prepared.execution).toMatchObject({
      kind: 'solana-cross-chain',
      accountAddress: location.wallet,
      recipient: guardian.address,
    })
    expect(prepared.request.request).toMatchObject({
      destination: { vm: 'evm', recipient: { address: guardian.address } },
    })
    expect(prepared.request.request).not.toHaveProperty('account.evm')
  })

  test('uses an EVM receiver as a plain-delivery default without adding it to the wire account', async () => {
    const { facade } = fixture(guardian.address)
    const prepared = await facade.prepareTransaction(delivery() as never)

    expect(facade.getAddress('evm' as never)).toBe(guardian.address)
    expect(prepared.execution).toMatchObject({
      accountAddress: location.wallet,
      recipient: guardian.address,
    })
    expect(prepared.request.request).not.toHaveProperty('account.evm')
  })

  test('refuses destination calls, which need an EVM account to run them', async () => {
    const { facade, solana } = fixture()

    await expect(
      facade.prepareTransaction({
        ...delivery(),
        destination: {
          ...delivery().destination,
          calls: [{ to: destinationToken, data: '0x' }],
        },
      } as never),
    ).rejects.toThrow(/managed EVM account/)
    expect(solana.prepareSolanaIntent).not.toHaveBeenCalled()
  })

  test.each([
    [
      'an EVM same-chain transaction',
      { destination: { chain: mainnet, calls: [] }, sponsored: true },
    ],
    [
      'an EVM → Solana delivery',
      {
        source: { chain: mainnet, token: mainnetUsdc },
        destination: {
          chain: solanaDevnet,
          token: mint,
          amount: 1n,
          recipient,
        },
      },
    ],
  ])('refuses %s before quoting', async (_name, transaction) => {
    const { facade, solana, createAccount } = fixture()

    await expect(
      facade.prepareTransaction(transaction as never),
    ).rejects.toThrow(/only originate on Solana/)
    expect(solana.prepareSolanaIntent).not.toHaveBeenCalled()
    expect(createAccount).not.toHaveBeenCalled()
  })

  test('has no assembly or authorizations, and refuses untyped owner signing and submission options', async () => {
    const { facade, solana } = fixture()
    const prepared = await facade.prepareTransaction(transfer())

    expect('assembleTransaction' in facade).toBe(false)
    expect('signAuthorizations' in facade).toBe(false)
    await expect(
      facade.signTransaction(prepared, { owner } as never),
    ).rejects.toThrow(/Independent owner signing/)
    expect(solana.signSolanaIntent).not.toHaveBeenCalled()

    const signed = await facade.signTransaction(prepared)
    await expect(
      (
        facade.submitTransaction as (
          signed: unknown,
          options: unknown,
        ) => Promise<unknown>
      )(signed, { internal_dryRun: true }),
    ).rejects.toThrow(/does not accept submission options/)
    expect(solana.submitSolanaIntent).not.toHaveBeenCalled()
  })
  describe('on production', () => {
    const program = solanaAddress('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')

    test.each([
      ['a same-chain transfer', () => transfer()],
      [
        'a capped same-chain transfer',
        () => ({ ...transfer(), source: { token: mint, maxAmount: 100n } }),
      ],
      [
        'a sponsored instruction execution',
        () => ({
          destination: {
            chain: solanaDevnet,
            instructions: [{ programId: program, accounts: [], data: 'AQID' }],
          },
          sponsored: true,
        }),
      ],
      [
        'a capped delivery',
        () => ({
          ...deliveryTo(guardian.address),
          source: { chain: solanaDevnet, token: mint, maxAmount: 100n },
        }),
      ],
    ])('runs %s bound to prod-v1', async (_name, build) => {
      const { facade, solana } = fixture(undefined, { captured: prodSdk })
      const prepared = await facade.prepareTransaction(build() as never)

      expect(solana.prepareSolanaIntent.mock.calls[0]?.[0]).toMatchObject({
        namespace: 'prod-v1',
        endpoint: PROD_ORCHESTRATOR_URL,
      })
      expect(prepared.execution).toMatchObject({
        namespace: 'prod-v1',
        endpoint: PROD_ORCHESTRATOR_URL,
      })
      await facade.submitTransaction(await facade.signTransaction(prepared))
      expect(solana.submitSolanaIntent).toHaveBeenCalledOnce()
    })

    test.each([
      ['production', { captured: sdk, current: prodSdk }],
      ['development', { captured: prodSdk, current: sdk }],
      [
        'another endpoint',
        {
          captured: prodSdk,
          current: resolveSdkConfig({
            apiKey: 'offline',
            endpointUrl: 'https://orchestrator.example',
          }),
        },
      ],
    ])(
      'refuses an account whose SDK moved to %s before quoting',
      async (_name, environments) => {
        const { facade, solana } = fixture(undefined, environments)

        await expect(
          facade.prepareTransaction(transfer()),
        ).rejects.toBeInstanceOf(ManagedSolanaAccountNotSupportedError)
        expect(solana.prepareSolanaIntent).not.toHaveBeenCalled()
      },
    )
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
  const mainnetSource = { chain: mainnet, token: mainnetUsdc }

  test('defaults Solana delivery to the configured receiver', () => {
    const normalized = normalizeTransaction(
      {
        source: mainnetSource,
        destination: { chain: solanaMainnet, token: solana, amount: 1n },
        sponsored: true,
      },
      config,
    )
    expect(normalized).toEqual({
      source: mainnetSource,
      destination: {
        chain: solanaMainnet,
        token: solana,
        amount: 1n,
        recipient: solana,
      },
      sponsored: true,
    })
  })

  test('expands the same-chain shorthand to the destination chain and nothing else', () => {
    const normalized = normalizeTransaction(
      {
        source: { token: mainnetUsdc },
        destination: { chain: mainnet, token: mainnetUsdc, amount: 1n },
      },
      config,
    )
    expect(normalized).toEqual({
      source: { chain: mainnet, token: mainnetUsdc },
      destination: { chain: mainnet, token: mainnetUsdc, amount: 1n },
    })
    expect(normalizeTransaction(normalized, config)).toEqual(normalized)
  })

  test.each([
    [
      { destination: { chain: mainnet, calls: [] } },
      /not gas-sponsored needs a `source`/,
      'source',
    ],
    [
      { destination: { chain: mainnet, token: mainnetUsdc }, sponsored: true },
      /A delivery needs a `source`/,
      'source',
    ],
    [
      { source: null, destination: { chain: mainnet } },
      /`source` must be an object/,
      'source',
    ],
    [
      { sourceChains: [mainnet], destination: { chain: mainnet } },
      /`sourceChains` was replaced by `source.chain`/,
      'sourceChains',
    ],
    [
      { chain: mainnet, calls: [] },
      /`chain` was replaced by `destination.chain`/,
      'chain',
    ],
    [
      {
        source: {
          chain: { id: 1, kind: 'svm', caip2: 'solana:forged' },
          token: solana,
        },
        destination: { chain: mainnet, token: recipientAddress, amount: 1n },
      },
      /managed Solana source is required/,
      undefined,
    ],
    [
      {
        source: { chain: { id: 1500148 }, token: mainnetUsdc },
        destination: { chain: mainnet },
      },
      /eip155 chain ID/,
      'source.chain',
    ],
    [
      { source: mainnetSource, destination: { chain: solanaMainnet } },
      /only receives tokens/,
      'destination.token',
    ],
    [
      {
        source: mainnetSource,
        destination: { chain: solanaMainnet, token: solana, amount: 0n },
      },
      /must be a positive bigint/,
      'destination.amount',
    ],
    [
      {
        source: mainnetSource,
        destination: { chain: mainnet, amount: 1n },
      },
      /needs `destination.token`/,
      'destination.amount',
    ],
    [
      {
        source: mainnetSource,
        destination: { chain: solanaMainnet, token: solana, instructions: [] },
      },
      /`destination.instructions` is not supported for a svm destination/,
      'destination.instructions',
    ],
    [
      {
        source: mainnetSource,
        destination: {
          chain: solanaMainnet,
          token: solana,
          hyperCore: { closePerp: { asset: 'ETH' } },
        },
      },
      /applies to a HyperCore destination/,
      'destination.hyperCore',
    ],
    [
      {
        source: mainnetSource,
        destination: { chain: solanaMainnet, token: solana, recipient: null },
      },
      /delivery recipient must be an address/,
      'destination.recipient',
    ],
    [
      {
        source: mainnetSource,
        destination: {
          chain: mainnet,
          token: mainnetUsdc,
          recipient: recipientAddress,
          calls: [{ to: recipientAddress }],
        },
      },
      /recipient cannot execute destination calls/,
      'destination.recipient',
    ],
    [
      {
        source: { chain: optimism, token: optimismUsdc },
        destination: { chain: mainnet },
        customDeadline: 9_999_999_999,
      },
      /same-chain transactions only/,
      'customDeadline',
    ],
    [
      {
        source: {
          ...mainnetSource,
          calls: [
            {
              to: recipientAddress,
              provides: [{ token: recipientAddress, amount: 1n }],
            },
          ],
        },
        destination: { chain: mainnet },
      },
      /must be `source.token`/,
      'source.calls.0.provides.0.token',
    ],
    [
      {
        source: { ...mainnetSource, auxiliaryFunds: 0n },
        destination: { chain: mainnet },
      },
      /must be a positive bigint/,
      'source.auxiliaryFunds',
    ],
  ])(
    'rejects unsupported dynamic transaction %#',
    (transaction, message, field) => {
      let error: unknown
      try {
        normalizeTransaction(transaction as never, config)
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(UnsupportedAccountCapabilityError)
      expect((error as Error).message).toMatch(message)
      if (field) {
        expect(error).toMatchObject({ context: { field } })
      }
    },
  )

  test('rejects a synthetic non-EVM ID disguised as a viem destination', () => {
    expect(() =>
      normalizeTransaction(
        {
          destination: { chain: { ...mainnet, id: 1500148 } },
          sponsored: true,
        } as never,
        config,
      ),
    ).toThrow(/eip155 chain ID/)
  })

  test.each([
    { destination: { chain: { ...mainnet, id: -1 } }, sponsored: true },
    {
      source: { chain: { ...mainnet, id: -1 }, token: mainnetUsdc },
      destination: { chain: mainnet },
    },
  ])('wraps invalid chain IDs in a capability error', (transaction) => {
    expect(() => normalizeTransaction(transaction as never, config)).toThrow(
      UnsupportedAccountCapabilityError,
    )
    expect(() => normalizeTransaction(transaction as never, config)).toThrow(
      /eip155 chain ID/,
    )
  })

  test('reports non-EVM origins without calling them Solana', () => {
    expect(() =>
      normalizeTransaction(
        {
          source: { chain: tronMainnet, token: mainnetUsdc },
          destination: { chain: mainnet },
        } as never,
        config,
      ),
    ).toThrow(
      'A tvm chain cannot fund a transaction; `source.chain` must be an EVM chain.',
    )
  })

  test('rejects a forged non-EVM descriptor', () => {
    expect(() =>
      normalizeTransaction(
        {
          source: mainnetSource,
          destination: {
            chain: { ...solanaMainnet, caip2: 'tron:mainnet' },
            token: solana,
            amount: 1n,
          },
        } as never,
        config,
      ),
    ).toThrow(/mismatched VM/)
  })
})

describe('EVM prepare against the orchestrator', () => {
  /** An orchestrator that records every non-RPC request and answers none. */
  function stubOrchestrator() {
    const requests: { url: string; body: Record<string, unknown> }[] = []
    const fetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString()
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        if (body?.method === 'eth_getCode') {
          return Response.json({ jsonrpc: '2.0', id: body.id, result: '0x' })
        }
        requests.push({ url, body })
        return Response.json(
          { error: { code: 'INTERNAL_ERROR', message: 'stop' } },
          { status: 500 },
        )
      },
    )
    vi.stubGlobal('fetch', fetch)
    return { fetch, requests }
  }

  function createAccount() {
    return new RhinestoneSDK({ apiKey: 'offline' }).createAccount({
      evm: { owners: { type: 'ecdsa', accounts: [owner] } },
    })
  }

  test('sends a shorthand source on the destination chain', async () => {
    const { requests } = stubOrchestrator()
    try {
      const account = await createAccount()
      await account
        .prepareTransaction({
          source: { token: mainnetUsdc },
          destination: { chain: mainnet, token: mainnetUsdc, amount: 1n },
        })
        .catch(() => {})

      expect(requests.map(({ url }) => url)).toEqual([
        `${PROD_ORCHESTRATOR_URL}/quotes`,
      ])
      const [{ body }] = requests as [(typeof requests)[number]]
      expect(body.source).toEqual({
        vm: 'evm',
        chainId: formatCaip2(mainnet.id),
        token: mainnetUsdc,
      })
      expect(body.destination).toEqual({
        vm: 'evm',
        chainId: formatCaip2(mainnet.id),
        token: mainnetUsdc,
        amount: '1',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('quotes a cross-chain delivery from the named source without reading the chain catalog', async () => {
    const { requests } = stubOrchestrator()
    try {
      const account = await createAccount()
      await account
        .prepareTransaction({
          source: { chain: mainnet, token: mainnetUsdc, maxAmount: 2n },
          destination: { chain: optimism, token: optimismUsdc, amount: 1n },
        })
        .catch(() => {})

      expect(requests.map(({ url }) => url)).toEqual([
        `${PROD_ORCHESTRATOR_URL}/quotes`,
      ])
      const [{ body }] = requests as [(typeof requests)[number]]
      expect(Object.keys(body).sort()).toEqual([
        'account',
        'destination',
        'source',
      ])
      expect(body.source).toEqual({
        vm: 'evm',
        chainId: formatCaip2(mainnet.id),
        token: mainnetUsdc,
        maxAmount: '2',
      })
      expect(body.destination).toEqual({
        vm: 'evm',
        chainId: formatCaip2(optimism.id),
        token: optimismUsdc,
        amount: '1',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test.each([
    [
      'customDeadline on a cross-chain transaction',
      {
        source: { chain: mainnet, token: mainnetUsdc },
        destination: { chain: optimism, calls: [] },
        customDeadline: 9_999_999_999,
      },
      'customDeadline',
    ],
    [
      'a delivery with no source',
      {
        destination: { chain: optimism, token: optimismUsdc, amount: 1n },
        sponsored: true,
      },
      'source',
    ],
    [
      'an unsponsored execution with no source',
      { destination: { chain: optimism, calls: [] } },
      'source',
    ],
  ])('refuses %s before any request', async (_name, transaction, field) => {
    const { fetch } = stubOrchestrator()
    try {
      const account = await createAccount()
      const refusal = account.prepareTransaction(transaction as never)

      await expect(refusal).rejects.toBeInstanceOf(
        UnsupportedAccountCapabilityError,
      )
      await expect(refusal).rejects.toMatchObject({ context: { field } })
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('EVM prepared artifacts from an earlier wire version', () => {
  function fixture() {
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
    }
    const workflows = {
      getAddress: vi.fn(() => owner.address),
      reconstructPreparedIntent: vi.fn(),
      signIntent: vi.fn(),
      signIntentAsOwner: vi.fn(),
      assembleIntent: vi.fn(),
      signRequestedDelegations: vi.fn(),
      submitIntent: vi.fn(),
    }
    const facade = createAccountFacade(
      compatibilityConfig,
      { evm: compatibilityConfig as EvmAccountConfig },
      {
        config: resolveSdkConfig({ apiKey: 'offline' }),
        project: {} as never,
        createAccount: (context) => ({
          context,
          workflows: workflows as never,
        }),
      },
    )
    return { facade, workflows }
  }

  const quote = quoteFixture('best')
  const { signingRequests: _requests, ...withoutRequests } = quote

  // Both carry the flat transaction their generation used: the binding is
  // checked first, so they fail as an earlier wire version and not as a
  // malformed transaction.
  test.each([
    [
      'a caucasus-1 artifact',
      {
        quotes: { traceId: 'trace', best: quote, all: [quote] },
        intentInput: serializedIntentInput,
        request: {
          version: 'caucasus-1',
          request: {
            account: intentRequest.account,
            destination: {
              vm: 'evm',
              chainId: formatCaip2(mainnet.id),
              tokenRequests: [],
            },
          },
        },
        transaction: { chain: mainnet, tokenRequests: [] },
      },
    ],
    // A Blanc-era artifact has role-keyed `signData` and no request binding.
    [
      'a Blanc-era artifact',
      {
        quotes: {
          traceId: 'trace',
          best: { ...withoutRequests, signData: { origin: [] } },
          all: [{ ...withoutRequests, signData: { origin: [] } }],
        },
        intentInput: serializedIntentInput,
        transaction: sameChainTransaction,
      },
    ],
  ])('refuses %s before any effect', async (_name, artifact) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    try {
      const { facade, workflows } = fixture()
      const legacy = artifact as unknown as PreparedTransactionData
      const signed = {
        ...artifact,
        quote,
        proofs: [],
      } as unknown as SignedTransactionData

      expect(() => facade.getTransactionMessages(legacy)).toThrow(
        InvalidPreparedTransactionError,
      )
      await expect(facade.signTransaction(legacy)).rejects.toThrow(
        InvalidPreparedTransactionError,
      )
      await expect(facade.signTransaction(legacy, { owner })).rejects.toThrow(
        InvalidPreparedTransactionError,
      )
      await expect(facade.assembleTransaction(legacy, [])).rejects.toThrow(
        InvalidPreparedTransactionError,
      )
      await expect(facade.signAuthorizations(legacy)).rejects.toThrow(
        InvalidPreparedTransactionError,
      )
      await expect(facade.submitTransaction(signed)).rejects.toThrow(
        InvalidPreparedTransactionError,
      )
      for (const workflow of Object.values(workflows)) {
        expect(workflow).not.toHaveBeenCalled()
      }
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
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
      intentInput: serializedIntentInput,
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
      source: { chain: optimism, token: optimismUsdc },
      destination: { chain: solanaMainnet, token: mint, amount: 50_000n },
      sponsored: true,
      appFees: { feeBps: 25 },
      protocolFees: { feeBps: 50 },
    })

    expect(prepareIntent.mock.calls[0]?.[1]).toMatchObject({
      destination: parseCaip2(solanaMainnet.caip2),
      source: { chain: toEvmChainReference(optimism.id), token: optimismUsdc },
      calls: [],
      // Base58 is case-sensitive; the facade must not normalize either string.
      token: mint,
      amount: 50_000n,
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
      source: { chain: mainnet, token: mainnetUsdc },
      destination: {
        chain: solanaDevnet,
        token: mint,
        amount: 1n,
        recipient: explicitRecipient,
      },
    })

    expect(prepareIntent.mock.calls[0]?.[1]).toMatchObject({
      recipient: { address: explicitRecipient },
    })
  })

  test('refuses delivery with neither an explicit recipient nor a Solana branch', () => {
    expect(() =>
      normalizeTransaction(
        {
          source: { chain: mainnet, token: mainnetUsdc },
          destination: { chain: solanaMainnet, token: mint, amount: 1n },
        },
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
      transaction: sameChainTransaction,
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
      transaction: sameChainTransaction,
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
      transaction: sameChainTransaction,
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
      transaction: sameChainTransaction,
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
        source: { chain: mainnet, token: mainnetUsdc },
        destination: {
          chain: hyperCorePerp,
          hyperCore: {
            openPerp: { asset: 'BTC', direction: 'long', notionalUsd: 100 },
          },
        },
      },
      action,
    )

    expect(transaction.options?.hyperCore).toEqual({ action })
  })

  test('leaves hyperCore off the options when nothing resolved', () => {
    const transaction = adaptTransaction(
      invocationContext(),
      sameChainTransaction,
    )

    expect(transaction.options && 'hyperCore' in transaction.options).toBe(
      false,
    )
  })

  test('projects smart-account recipients instead of dropping them', () => {
    const transaction = adaptTransaction(invocationContext(), {
      source: { token: mainnetUsdc },
      destination: {
        chain: mainnet,
        token: mainnetUsdc,
        recipient: {
          account: { type: 'nexus', version: '1.2.0' },
          owners: { type: 'ecdsa', accounts: [owner] },
        },
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
        source: { token: mainnetUsdc },
        destination: {
          chain: mainnet,
          token: mainnetUsdc,
          recipient: recipientAddress,
        },
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
          source: { token: mainnetUsdc },
          destination: { chain: mainnet, token: mainnetUsdc, recipient },
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
        source: { chain: mainnet, token: mainnetUsdc },
        destination: { chain: optimism },
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
      ...sameChainTransaction,
      customDeadline,
    })

    expect(transaction.options?.customDeadline).toBe(customDeadline)
  })

  // RHI-5510: the delivery venue is the destination chain, not a field on the
  // token request, so `adaptTransaction` carries nothing venue-specific. This
  // pins that no stray venue field is synthesised onto a request — the previous
  // `balance` flag was dropped by this very mapping, which is what silently
  // routed spot deliveries into perp margin.
  test('synthesises no venue field onto the delivery', () => {
    const token = '0x0000000000000000000000000000000000000020'
    const transaction = adaptTransaction(invocationContext(), {
      source: { token },
      destination: { chain: mainnet, token, amount: 1_000_000n },
    })

    expect(transaction).toMatchObject({ token, amount: 1_000_000n })
    expect(transaction).not.toHaveProperty('balance')
  })

  test('forwards protocolFees into intent options (RHI-4904)', () => {
    const transaction = adaptTransaction(invocationContext(), {
      ...sameChainTransaction,
      protocolFees: { feeBps: 35 },
    })

    expect(transaction.options?.protocolFees).toEqual({ feeBps: 35 })
    expect(transaction.options?.appFees).toBeUndefined()
  })

  test('maps sponsored.protocolFees onto sponsorSettings (RHI-4904)', () => {
    const transaction = adaptTransaction(invocationContext(), {
      ...sameChainTransaction,
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
      ...sameChainTransaction,
      sponsored: { gas: true, bridging: true, swaps: true },
    })

    expect(transaction.options?.sponsorSettings?.protocolFees).toBe(false)
  })

  test.each([
    { swaps: true, swapValue: true },
    { swaps: true, swapValue: false },
    { swaps: false, swapValue: true },
  ])('ignores withdrawn runtime swapValue input: %j', (legacy) => {
    const sponsored = { gas: true, bridging: false, ...legacy }
    const transaction = adaptTransaction(invocationContext(), {
      ...sameChainTransaction,
      sponsored,
    })

    expect(transaction.options?.sponsorSettings).toEqual({
      gas: true,
      bridgeFees: false,
      swapFees: legacy.swaps,
      protocolFees: false,
    })
    expect(transaction.options?.sponsorSettings).not.toHaveProperty('swapValue')
  })

  test('boolean sponsored: true enables protocolFees too (RHI-4904)', () => {
    const transaction = adaptTransaction(invocationContext(), {
      ...sameChainTransaction,
      sponsored: true,
    })

    expect(transaction.options?.sponsorSettings).toEqual({
      gas: true,
      bridgeFees: true,
      swapFees: true,
      protocolFees: true,
    })
  })

  test('adapts the one source, spending on the destination chain by default', () => {
    const config = {
      evm: { owners: { type: 'ecdsa' as const, accounts: [owner] } },
    }
    const shorthand = adaptTransaction(
      invocationContext(),
      normalizeTransaction(
        {
          source: { token: mainnetUsdc, maxAmount: 5n, auxiliaryFunds: 1n },
          destination: { chain: mainnet },
        },
        config,
      ),
    )
    const crossChain = adaptTransaction(
      invocationContext(),
      normalizeTransaction(
        {
          source: { chain: optimism, token: optimismUsdc },
          destination: { chain: mainnet, token: mainnetUsdc },
        },
        config,
      ),
    )

    expect(shorthand.source).toEqual({
      chain: toEvmChainReference(mainnet.id),
      token: mainnetUsdc,
      maxAmount: 5n,
      auxiliaryFunds: 1n,
    })
    expect(crossChain.source).toEqual({
      chain: toEvmChainReference(optimism.id),
      token: optimismUsdc,
    })
    expect(crossChain).toMatchObject({
      destination: toEvmChainReference(mainnet.id),
      token: mainnetUsdc,
    })
    expect(
      adaptTransaction(invocationContext(), {
        destination: { chain: mainnet },
        sponsored: true,
      }),
    ).not.toHaveProperty('source')
  })

  test.each([
    [
      'the source chain',
      { source: { chain: optimism, token: optimismUsdc } },
      { sourceChains: [optimism.id] },
    ],
    ['nothing for a source-free execution', { sponsored: true }, {}],
  ])('reports %s on the submitted result', async (_name, patch, expected) => {
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
    }
    const reconstructPreparedIntent = vi.fn(async (_context, input) => ({
      ...input,
      input: input.intentInput,
      accountChain: toEvmChainReference(1),
      signing: {} as never,
    }))
    const submissionClient = {
      submitIntent: vi.fn(async ({ intentId }: { intentId: string }) => ({
        traceId: 'submit-trace',
        intentId,
      })),
    }
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
            submitIntent: (_context: unknown, signed: never) =>
              submitIntent({ submissionClient } as never, signed),
          } as never,
        }),
      },
    )
    const quote = quoteFixture('best')
    const signed = {
      quotes: { traceId: 'trace', best: quote, all: [quote] },
      intentInput: serializedIntentInput,
      request: preparedRequest,
      transaction: { destination: { chain: mainnet }, ...patch },
      quote,
      proofs: [{ kind: 'eip712', signature: '0x12' }],
    } as SignedTransactionData

    await expect(facade.submitTransaction(signed)).resolves.toEqual({
      type: 'intent',
      id: 'best',
      traceId: 'submit-trace',
      ...expected,
      targetChain: mainnet.id,
    })
  })

  test('forwards a deployment or setup source token and refuses a malformed one', async () => {
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
    }
    const deploy = vi.fn(async () => true)
    const setup = vi.fn(async () => true)
    const facade = createAccountFacade(
      compatibilityConfig,
      { evm: compatibilityConfig as EvmAccountConfig },
      {
        config: resolveSdkConfig({ apiKey: 'offline' }),
        project: {} as never,
        createAccount: (context) => ({
          context,
          workflows: { deploy, setup } as never,
        }),
      },
    )

    await facade.deploy('evm', mainnet, { source: { token: mainnetUsdc } })
    await facade.setup(mainnet, { source: { token: mainnetUsdc } })
    await facade.setup(mainnet)
    expect(deploy).toHaveBeenCalledWith(
      expect.anything(),
      toEvmChainReference(mainnet.id),
      { sourceToken: mainnetUsdc },
    )
    expect(setup.mock.calls.map((call) => call.slice(1))).toEqual([
      [toEvmChainReference(mainnet.id), { sourceToken: mainnetUsdc }],
      [toEvmChainReference(mainnet.id), {}],
    ])

    deploy.mockClear()
    setup.mockClear()
    for (const source of [
      { token: 'USDC' },
      { chain: optimism, token: mainnetUsdc },
      null,
    ]) {
      await expect(
        facade.deploy('evm', mainnet, { source } as never),
      ).rejects.toMatchObject({
        context: { field: 'source.token', chainId: mainnet.id },
      })
      expect(() => facade.setup(mainnet, { source } as never)).toThrow(
        UnsupportedAccountCapabilityError,
      )
    }
    expect(deploy).not.toHaveBeenCalled()
    expect(setup).not.toHaveBeenCalled()
  })
})

// A same-chain EVM quote carrying the one origin authorization the account
// signs. The chain has to be readable from the payload's domain: that is where
// the signing account runtime is resolved from.
function quoteFixture(intentId: string): Quote {
  return publicQuote(caucasusQuote({ intentId, chainId: mainnet.id }))
}

describe('managed Solana Swig creation', () => {
  const devSdk = resolveSdkConfig({
    apiKey: 'offline',
    endpointUrl: DEV_ORCHESTRATOR_URL,
    useDevContracts: true,
  })
  // An independently minted Swig: id = 32 × 0x07.
  const independentId = `0x${'07'.repeat(32)}` as const
  const independent = locateSwigById(hexToBytes(independentId))

  function deploymentRoute(
    target: { readonly swig: string; readonly wallet: string },
    authority: SwigAuthority,
  ): OrchestratorDeploymentQuote {
    const leg = {
      vm: 'svm' as const,
      chainId: solanaDevnet.caip2,
      account: { wallet: target.wallet, swigAccount: target.swig, authority },
    }
    return {
      intentId: 'deployment-intent',
      purpose: 'deployment',
      expiresAt: 4_000_000_000,
      estimatedFillTime: { seconds: 2 },
      settlementLayer: 'SAME_CHAIN',
      plan: { source: [], destination: leg, deployments: [leg] },
      cost: emptyCost(),
      deploymentCosts: [],
      requirements: [],
      signingRequests: [],
    }
  }

  function ports(route: OrchestratorQuote) {
    const createQuote = vi.fn(
      async (
        _request: OrchestratorIntentRequest,
        _context?: OrchestratorQuoteContext,
      ) => ({
        traceId: 'quote-trace',
        routes: [route],
      }),
    )
    const submitIntent = vi.fn(async (intent: { intentId: string }) => ({
      traceId: 'submit-trace',
      intentId: intent.intentId,
    }))
    const context = {
      quoteClient: { createQuote },
      submissionClient: { submitIntent },
      now: Date.now,
    }
    return {
      createQuote,
      submitIntent,
      prepareSolanaDeployment: vi.fn((input: SolanaDeploymentInput) =>
        prepareSolanaDeployment(context, input),
      ),
      submitSolanaDeployment: vi.fn((prepared: PreparedSolanaDeployment) =>
        submitSolanaDeployment(context, prepared),
      ),
    }
  }

  function completed(intentId: string) {
    return {
      traceId: `status-${intentId}`,
      intentId,
      purpose: 'deployment' as const,
      status: 'COMPLETED' as const,
      operations: [],
      terminal: true,
    }
  }

  function standalone(
    options: {
      readonly owner?: SolanaOwner
      readonly authority?: SwigAuthority
      readonly sdk?: ReturnType<typeof resolveSdkConfig>
      readonly environment?: 'development' | 'production'
      readonly endpoint?: string
      readonly route?: OrchestratorQuote
    } = {},
  ) {
    const solanaOwner = options.owner ?? { type: 'ecdsa', account: owner }
    const authority = options.authority ?? {
      kind: 'secp256k1',
      address: owner.address,
    }
    const sdk = options.sdk ?? devSdk
    const workflows = ports(
      options.route ?? deploymentRoute(independent, authority),
    )
    const waitForIntentStatus = vi.fn(async (intentId: string) =>
      completed(intentId),
    )
    const facade = createSolanaAccountFacade(
      {
        owner: solanaOwner,
        walletAddress: independent.wallet,
        swigAddress: independent.swig,
        environment: options.environment ?? 'development',
        endpoint: options.endpoint ?? devSdk.orchestratorUrl,
      },
      { solana: { owner: solanaOwner, swig: independent.swig } },
      {
        config: sdk,
        project: { solana: workflows, waitForIntentStatus } as never,
        createAccount: () => {
          throw new Error('a standalone Solana account has no EVM context')
        },
      },
    )
    return { facade, workflows, waitForIntentStatus }
  }

  test('creates an independent Swig with its saved id and the owner as root', async () => {
    const { facade, workflows, waitForIntentStatus } = standalone()

    await expect(
      facade.deploy('solana', solanaDevnet, { swigId: independentId }),
    ).resolves.toBe(true)

    expect(workflows.createQuote).toHaveBeenCalledOnce()
    const request = workflows.createQuote.mock.calls[0]![0]
    expect(request.account).toEqual({
      svm: {
        type: 'swig',
        address: independent.wallet,
        swigAccount: independent.swig,
        authorization: { kind: 'secp256k1', address: owner.address },
        initData: {
          authority: { kind: 'secp256k1', publicKey: owner.publicKey },
          id: independentId,
        },
      },
    })
    expect(request.options).toEqual({
      sponsorship: { gas: true, bridgeFees: false, swapFees: false },
    })
    expect(workflows.createQuote.mock.calls[0]![1]).toMatchObject({
      sponsored: true,
    })
    expect(workflows.submitIntent).toHaveBeenCalledWith({
      intentId: 'deployment-intent',
      proofs: [],
    })
    expect(waitForIntentStatus).toHaveBeenCalledWith('deployment-intent')
  })

  test('installs a passkey owner under its compressed key', async () => {
    const { account: passkey, compressedPublicKey } = signingPasskey()
    const authority = {
      kind: 'secp256r1' as const,
      publicKey: compressedPublicKey,
    }
    const { facade, workflows } = standalone({
      owner: { type: 'passkey', account: passkey },
      authority,
    })

    await facade.deploy('solana', solanaDevnet, { swigId: independentId })

    expect(workflows.createQuote.mock.calls[0]![0].account.svm).toMatchObject({
      authorization: authority,
      initData: { authority, id: independentId },
    })
  })

  test.each([
    ['a missing id', undefined, /createSolanaSwigId\(\)/],
    ['a malformed id', '0x1234', /32-byte Swig id/],
    [
      'an id deriving another Swig',
      `0x${'08'.repeat(32)}`,
      /does not derive the configured Swig/,
    ],
  ])(
    'refuses %s before contacting the orchestrator',
    async (_label, swigId, message) => {
      const { facade, workflows } = standalone()
      const refusal = facade.deploy(
        'solana',
        solanaDevnet,
        // Untyped callers can still omit the required id.
        (swigId === undefined ? undefined : { swigId }) as { swigId: Hex },
      )
      await expect(refusal).rejects.toBeInstanceOf(
        UnsupportedAccountCapabilityError,
      )
      await expect(refusal).rejects.toThrow(message)
      expect(workflows.createQuote).not.toHaveBeenCalled()
    },
  )

  test('creates an independent Swig on a production account', async () => {
    const { facade, workflows } = standalone({
      sdk: resolveSdkConfig({ apiKey: 'offline' }),
      environment: 'production',
      endpoint: PROD_ORCHESTRATOR_URL,
    })

    await expect(
      facade.deploy('solana', solanaDevnet, { swigId: independentId }),
    ).resolves.toBe(true)
    expect(workflows.prepareSolanaDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'prod-v1',
        endpoint: PROD_ORCHESTRATOR_URL,
      }),
    )
  })

  test.each([
    ['a production SDK', { sdk: resolveSdkConfig({ apiKey: 'offline' }) }],
    [
      'a development SDK on a production account',
      {
        environment: 'production' as const,
        endpoint: PROD_ORCHESTRATOR_URL,
      },
    ],
    ['another endpoint', { endpoint: 'https://other.example' }],
  ])(
    'refuses %s before contacting the orchestrator',
    async (_label, options) => {
      const { facade, workflows } = standalone(options)
      await expect(
        facade.deploy('solana', solanaDevnet, { swigId: independentId }),
      ).rejects.toBeInstanceOf(ManagedSolanaAccountNotSupportedError)
      expect(workflows.createQuote).not.toHaveBeenCalled()
    },
  )

  test('refuses a chain that is not canonical Solana', async () => {
    const { facade, workflows } = standalone()
    await expect(
      facade.deploy(
        'solana',
        { ...solanaDevnet, name: 'Solana Lookalike' },
        { swigId: independentId },
      ),
    ).rejects.toBeInstanceOf(InvalidSolanaTransactionArtifactError)
    expect(workflows.createQuote).not.toHaveBeenCalled()
  })

  test.each([
    [
      'exposes no public key',
      { address: owner.address, type: 'json-rpc' } as unknown as Account,
      /exposes none/,
    ],
    [
      "carries another key's public key",
      {
        ...owner,
        publicKey: privateKeyToAccount(`0x${'09'.repeat(32)}`).publicKey,
      },
      /does not belong to its `address`/,
    ],
  ])('refuses an ECDSA owner that %s', async (_label, account, message) => {
    const { facade, workflows } = standalone({
      owner: { type: 'ecdsa', account },
    })
    const refusal = facade.deploy('solana', solanaDevnet, {
      swigId: independentId,
    })
    await expect(refusal).rejects.toBeInstanceOf(
      UnsupportedAccountCapabilityError,
    )
    await expect(refusal).rejects.toThrow(message)
    expect(workflows.createQuote).not.toHaveBeenCalled()
  })

  test('surfaces a failed deployment intent', async () => {
    const { facade, waitForIntentStatus } = standalone()
    waitForIntentStatus.mockRejectedValueOnce(
      new IntentFailedError({ context: { intentId: 'deployment-intent' } }),
    )
    await expect(
      facade.deploy('solana', solanaDevnet, { swigId: independentId }),
    ).rejects.toBeInstanceOf(IntentFailedError)
  })

  function alreadyDeployed(
    swig: SolanaAddress,
    destinationChainId: string | null = solanaDevnet.caip2,
  ) {
    return parseErrorEnvelope(
      {
        code: 'UNPROCESSABLE_CONTENT',
        message: 'exists',
        traceId: 'trace',
        details: [
          {
            message: 'exists',
            context: {
              code: 'ACCOUNT_ALREADY_DEPLOYED',
              ...(destinationChainId ? { destinationChainId } : {}),
              swig,
              wallet: independent.wallet,
            },
          },
        ],
      },
      422,
    )
  }

  test('resolves true for a Swig that already exists without submitting', async () => {
    const { facade, workflows, waitForIntentStatus } = standalone()
    workflows.createQuote.mockRejectedValueOnce(
      alreadyDeployed(independent.swig),
    )
    await expect(
      facade.deploy('solana', solanaDevnet, { swigId: independentId }),
    ).resolves.toBe(true)
    expect(workflows.submitIntent).not.toHaveBeenCalled()
    expect(waitForIntentStatus).not.toHaveBeenCalled()
  })

  test.each([
    ['another Swig', alreadyDeployed(managedSwig)],
    [
      'another cluster',
      alreadyDeployed(
        independent.swig,
        'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      ),
    ],
    ['no cluster', alreadyDeployed(independent.swig, null)],
  ])('rethrows an existing-Swig refusal naming %s', async (_label, refusal) => {
    const { facade, workflows } = standalone()
    workflows.createQuote.mockRejectedValueOnce(refusal)
    await expect(
      facade.deploy('solana', solanaDevnet, { swigId: independentId }),
    ).rejects.toBeInstanceOf(SolanaAccountAlreadyCreatedError)
    expect(workflows.submitIntent).not.toHaveBeenCalled()
  })

  test('refuses an EVM deployment on a standalone Solana account', async () => {
    const { facade, workflows } = standalone()
    await expect(
      (facade.deploy as (...args: unknown[]) => Promise<boolean>)(
        'evm',
        mainnet,
      ),
    ).rejects.toBeInstanceOf(UnsupportedAccountCapabilityError)
    expect(workflows.createQuote).not.toHaveBeenCalled()
  })

  function composite(
    options: {
      readonly swig?: SolanaAddress | false
      readonly environment?: 'development' | 'production'
    } = {},
  ) {
    const production = options.environment === 'production'
    const endpoint = {
      endpointUrl: production ? PROD_ORCHESTRATOR_URL : DEV_ORCHESTRATOR_URL,
      useDevContracts: !production,
    }
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
      ...endpoint,
    }
    const derived = production ? prodSwigLocation : managedSwigLocation
    const swig = options.swig === undefined ? derived.swig : options.swig
    const target =
      swig === independent.swig
        ? independent
        : swig === prodSwigLocation.swig
          ? prodSwigLocation
          : managedSwigLocation
    const solanaPorts = ports(
      deploymentRoute(target, { kind: 'secp256k1', address: owner.address }),
    )
    const workflows = {
      getAddress: vi.fn(() => owner.address),
      deploy: vi.fn(async () => true),
      waitForIntentStatus: vi.fn(async (_context, intentId: string) =>
        completed(intentId),
      ),
      ...solanaPorts,
    }
    // Typed as managing Solana so the untyped `swig: false` case reaches the
    // runtime refusal.
    const facade = createAccountFacade(
      compatibilityConfig,
      {
        evm: compatibilityConfig as EvmAccountConfig,
        ...(swig
          ? { solana: { owner: { type: 'ecdsa', account: owner }, swig } }
          : {}),
      } as { evm: EvmAccountConfig; solana: SolanaManagedAccountConfig },
      {
        config: resolveSdkConfig({ apiKey: 'offline', ...endpoint }),
        project: {} as never,
        createAccount: (context) => ({
          context,
          workflows: workflows as never,
        }),
      },
    )
    return { facade, workflows }
  }

  test('creates the EVM-derived Swig of a composite account with no id', async () => {
    const { facade, workflows } = composite()

    await expect(facade.deploy('solana', solanaDevnet)).resolves.toBe(true)

    const request = workflows.createQuote.mock.calls[0]![0]
    expect(request.account).not.toHaveProperty('evm')
    expect(request.account.svm).toMatchObject({
      swigAccount: managedSwig,
      initData: { id: bytesToHex(managedSwigLocation.id) },
    })
    expect(workflows.waitForIntentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'deploy' }),
      'deployment-intent',
    )
    expect(workflows.deploy).not.toHaveBeenCalled()
  })

  test('creates the prod-v1 Swig of a production composite account with no id', async () => {
    const { facade, workflows } = composite({ environment: 'production' })

    await expect(facade.deploy('solana', solanaDevnet)).resolves.toBe(true)

    expect(prodSwigLocation.swig).not.toBe(managedSwig)
    expect(workflows.createQuote.mock.calls[0]![0].account.svm).toMatchObject({
      swigAccount: prodSwigLocation.swig,
      initData: { id: bytesToHex(prodSwigLocation.id) },
    })
  })

  test('needs the saved id for the dev-v1 Swig on a production account', async () => {
    const { facade, workflows } = composite({
      environment: 'production',
      swig: managedSwig,
    })

    await expect(facade.deploy('solana', solanaDevnet)).rejects.toThrow(
      /createSolanaSwigId\(\)/,
    )
    expect(workflows.createQuote).not.toHaveBeenCalled()
  })

  test('needs the saved id for an independent Swig on a composite account', async () => {
    const { facade, workflows } = composite({ swig: independent.swig })

    await expect(facade.deploy('solana', solanaDevnet)).rejects.toThrow(
      /createSolanaSwigId\(\)/,
    )
    expect(workflows.createQuote).not.toHaveBeenCalled()
    await expect(
      facade.deploy('solana', solanaDevnet, { swigId: independentId }),
    ).resolves.toBe(true)
  })

  test('keeps the EVM deployment path for an EVM chain', async () => {
    const { facade, workflows } = composite()

    await expect(
      facade.deploy('evm', mainnet, { sponsored: true }),
    ).resolves.toBe(true)
    expect(workflows.deploy).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'deploy' }),
      toEvmChainReference(mainnet.id),
      { sponsored: true },
    )
    expect(workflows.createQuote).not.toHaveBeenCalled()
  })

  test('refuses a Solana deployment on an account with no managed Solana entry', async () => {
    const { facade, workflows } = composite({ swig: false })

    await expect(facade.deploy('solana', solanaDevnet)).rejects.toBeInstanceOf(
      UnsupportedAccountCapabilityError,
    )
    expect(workflows.createQuote).not.toHaveBeenCalled()
    expect(workflows.deploy).not.toHaveBeenCalled()
  })

  test.each([
    [
      'an EVM deployment of a Solana chain',
      'evm',
      UnsupportedAccountCapabilityError,
    ],
    ['an unknown VM', 'tron', AccountVmNotConfiguredError],
  ])('refuses %s', async (_label, vm, error) => {
    const { facade, workflows } = composite()
    await expect(
      (facade.deploy as (...args: unknown[]) => Promise<boolean>)(
        vm,
        solanaDevnet,
      ),
    ).rejects.toBeInstanceOf(error)
    expect(workflows.createQuote).not.toHaveBeenCalled()
    expect(workflows.deploy).not.toHaveBeenCalled()
  })
})

describe('quote-time sponsorship approval', () => {
  const mint = solanaAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
  const recipient = solanaAddress('11111111111111111111111111111112')
  const message = 'cd'.repeat(32)
  const independentId = `0x${'07'.repeat(32)}` as const
  const swig = locateSwigById(hexToBytes(independentId))
  const solana = {
    owner: { type: 'ecdsa' as const, account: owner },
    swig: swig.swig,
  }
  const leg = {
    vm: 'svm' as const,
    chainId: solanaDevnet.caip2,
    account: {
      wallet: swig.wallet,
      swigAccount: swig.swig,
      authority: { kind: 'secp256k1' as const, address: owner.address },
    },
  }

  function spendRoute() {
    const cost = costEntry({
      chainId: solanaDevnet.caip2,
      tokenAddress: mint,
      amount: 100n,
    })
    return {
      ...caucasusQuote({
        intentId: 'spend',
        expiresAt: 4_000_000_000,
        signingRequests: [
          personalSignRequest({
            chainId: solanaDevnet.caip2,
            wallet: swig.wallet,
            swigAccount: swig.swig,
            authority: owner.address,
            message,
          }),
        ],
        cost: { ...emptyCost(), input: [cost], output: [cost] },
      }),
      plan: { source: [leg], destination: leg, deployments: [] },
    }
  }

  function deploymentRoute() {
    return {
      intentId: 'deployment',
      purpose: 'deployment',
      expiresAt: 4_000_000_000,
      estimatedFillTime: { seconds: 2 },
      settlementLayer: 'SAME_CHAIN',
      plan: { source: [], destination: leg, deployments: [leg] },
      cost: emptyCost(),
      deploymentCosts: [],
      requirements: [],
      signingRequests: [],
    }
  }

  /** An orchestrator that records what it is asked, in order. */
  function orchestrator(route: unknown) {
    const events: string[] = []
    const quotes: { headers: Headers; body: unknown }[] = []
    const submissions: Headers[] = []
    const fetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString()
        const headers = new Headers(init?.headers)
        if (url.endsWith('/quotes')) {
          events.push('quote')
          quotes.push({ headers, body: JSON.parse(String(init?.body)) })
          return Response.json({
            status: 'quoted',
            routes: [serializeBigInts(route)],
          })
        }
        if (url.endsWith('/intents')) {
          events.push('submit')
          submissions.push(headers)
          const { intentId } = JSON.parse(String(init?.body))
          return Response.json({ intentId }, { status: 201 })
        }
        const status = /\/intents\/([^/?]+)/u.exec(url)
        if (status) {
          return Response.json({
            intentId: status[1],
            purpose: 'deployment',
            status: 'COMPLETED',
            operations: [],
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      },
    )
    return { fetch, events, quotes, submissions }
  }

  function sdk(getIntentExtensionToken: (input: unknown) => Promise<string>) {
    return new RhinestoneSDK({
      auth: {
        mode: 'experimental_jwt',
        accessToken: 'access',
        getIntentExtensionToken,
      },
      endpointUrl: DEV_ORCHESTRATOR_URL,
      useDevContracts: true,
    })
  }

  function transfer() {
    return {
      source: { token: mint },
      destination: {
        chain: solanaDevnet,
        token: mint,
        amount: 100n,
        recipient,
      },
      sponsored: { gas: true, bridging: false, swaps: false },
    }
  }

  test('asks for approval once, before quoting, and submits without asking again', async () => {
    const server = orchestrator(spendRoute())
    vi.stubGlobal('fetch', server.fetch)
    try {
      const approvals: unknown[] = []
      const getIntentExtensionToken = vi.fn(async (input: unknown) => {
        server.events.push('approve')
        approvals.push(input)
        return 'extension'
      })
      const account = await sdk(getIntentExtensionToken).createAccount({
        solana,
      })

      const prepared = await account.prepareTransaction(transfer())

      expect(server.events).toEqual(['approve', 'quote'])
      expect(approvals).toEqual([prepared.intentInput])
      expect(server.quotes[0]?.headers.get('X-Intent-Extension')).toBe(
        'Bearer extension',
      )
      expect(projectSponsorshipApproval(server.quotes[0]?.body)).toEqual(
        JSON.parse(JSON.stringify(prepared.intentInput)),
      )

      await account.submitTransaction(await account.signTransaction(prepared))

      expect(server.events).toEqual(['approve', 'quote', 'submit'])
      expect(getIntentExtensionToken).toHaveBeenCalledOnce()
      expect(server.submissions[0]?.has('X-Intent-Extension')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('submits a restored prepared transaction without asking again', async () => {
    const server = orchestrator(spendRoute())
    vi.stubGlobal('fetch', server.fetch)
    try {
      const getIntentExtensionToken = vi.fn(async () => 'extension')
      const prepared = structuredClone(
        await (
          await sdk(getIntentExtensionToken).createAccount({ solana })
        ).prepareTransaction(transfer()),
      )
      const restored = await sdk(getIntentExtensionToken).createAccount({
        solana,
      })

      await restored.submitTransaction(await restored.signTransaction(prepared))

      expect(getIntentExtensionToken).toHaveBeenCalledOnce()
      expect(server.events).toEqual(['quote', 'submit'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('stops at a denied approval without quoting', async () => {
    const server = orchestrator(spendRoute())
    vi.stubGlobal('fetch', server.fetch)
    try {
      const denied = new Error('denied')
      const account = await sdk(async () => {
        throw denied
      }).createAccount({ solana })

      await expect(account.prepareTransaction(transfer())).rejects.toBe(denied)
      expect(server.fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('asks an EVM account for approval before quoting, and stops at a denial', async () => {
    const requests: string[] = []
    let quoted: { headers: Headers; body: unknown } | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString()
        const payload = init?.body ? JSON.parse(String(init.body)) : undefined
        if (payload?.method === 'eth_getCode') {
          return Response.json({ jsonrpc: '2.0', id: payload.id, result: '0x' })
        }
        requests.push(url)
        quoted = { headers: new Headers(init?.headers), body: payload }
        return Response.json(
          { error: { code: 'INTERNAL_ERROR', message: 'stop' } },
          { status: 500 },
        )
      }),
    )
    try {
      const approvals: unknown[] = []
      const evm = { owners: { type: 'ecdsa' as const, accounts: [owner] } }
      const transaction = {
        destination: {
          chain: mainnet,
          calls: [{ to: recipientAddress, data: '0x' as const }],
        },
        sponsored: true,
      }
      const account = await sdk(async (input) => {
        approvals.push(input)
        requests.push('approve')
        return 'extension'
      }).createAccount({ evm })
      await account.prepareTransaction(transaction).catch(() => {})

      expect(requests).toEqual(['approve', `${DEV_ORCHESTRATOR_URL}/quotes`])
      expect(quoted?.headers.get('X-Intent-Extension')).toBe('Bearer extension')
      expect(projectSponsorshipApproval(quoted?.body)).toEqual(
        JSON.parse(JSON.stringify(approvals[0])),
      )

      requests.length = 0
      const denied = new Error('denied')
      const refusing = await sdk(async () => {
        throw denied
      }).createAccount({ evm })
      await expect(refusing.prepareTransaction(transaction)).rejects.toBe(
        denied,
      )
      expect(requests).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('asks for approval when a Swig creation is quoted', async () => {
    const server = orchestrator(deploymentRoute())
    vi.stubGlobal('fetch', server.fetch)
    try {
      const approvals: unknown[] = []
      const account = await sdk(async (input) => {
        server.events.push('approve')
        approvals.push(input)
        return 'extension'
      }).createAccount({ solana })

      await expect(
        account.deploy('solana', solanaDevnet, { swigId: independentId }),
      ).resolves.toBe(true)

      expect(server.events).toEqual(['approve', 'quote', 'submit'])
      expect(approvals[0]).toEqual({
        contractVersion: 'sdk-caucasus-singular-2026-09-v1',
        account: {
          svm: {
            type: 'swig',
            address: swig.wallet,
            swigAccount: swig.swig,
            authorization: { kind: 'secp256k1', address: owner.address },
            initData: {
              authority: { kind: 'secp256k1', publicKey: owner.publicKey },
              id: independentId,
            },
          },
        },
        destination: { vm: 'svm', chainId: solanaDevnet.caip2 },
        options: {
          sponsorship: { gas: true, bridgeFees: false, swapFees: false },
        },
      })
      expect(projectSponsorshipApproval(server.quotes[0]?.body)).toEqual(
        approvals[0],
      )
      expect(server.submissions[0]?.has('X-Intent-Extension')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
