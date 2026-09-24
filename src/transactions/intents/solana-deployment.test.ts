import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test, vi } from 'vitest'
import { quote as caucasusQuote, emptyCost } from '../../../test/utils/caucasus'
import { solanaAddress, solanaDevnet } from '../../chains/non-evm'
import { isSponsoredIntentInput } from '../../clients/orchestrator/normalized'
import type {
  IntentAccountView,
  QuotePlan,
  SwigAuthority,
} from '../../clients/orchestrator/public'
import type {
  OrchestratorDeploymentQuote,
  OrchestratorQuote,
} from '../../clients/orchestrator/types'
import {
  InvalidSolanaTransactionArtifactError,
  SolanaQuoteExpiredError,
} from '../../errors/execution'
import {
  buildSolanaDeploymentRequest,
  prepareSolanaDeployment,
  type SolanaDeploymentInput,
  submitSolanaDeployment,
} from './solana-deployment'

const owner = privateKeyToAccount(`0x${'12'.repeat(32)}`)
const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
// `createSolanaSwigId`-style independent Swig for id = 32 × 0x07.
const swigId = `0x${'07'.repeat(32)}` as Hex
const swig = solanaAddress('3wm644fHe3ekULLCPov4vkDeVCJEaQmnCfn5k2HhMS4B')
const wallet = solanaAddress('C4PvoicLfj71bcjnvSWFKo3QeDP8AXJbUzZFQPvRf3xm')
const passkey =
  '0x036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296' as Hex

function ecdsaInput(
  overrides: Partial<SolanaDeploymentInput> = {},
): SolanaDeploymentInput {
  return {
    chain: solanaDevnet,
    walletAddress: wallet,
    swigAddress: swig,
    authorization: { kind: 'secp256k1', address: owner.address },
    initAuthority: { kind: 'secp256k1', publicKey: owner.publicKey },
    swigId,
    namespace: 'dev-v1',
    endpoint: 'https://dev.example',
    ...overrides,
  }
}

function passkeyInput(
  overrides: Partial<SolanaDeploymentInput> = {},
): SolanaDeploymentInput {
  return ecdsaInput({
    authorization: { kind: 'secp256r1', publicKey: passkey },
    initAuthority: { kind: 'secp256r1', publicKey: passkey },
    ...overrides,
  })
}

function plan(
  account: IntentAccountView = {
    wallet,
    swigAccount: swig,
    authority: { kind: 'secp256k1', address: owner.address },
  },
  chainId = DEVNET,
): QuotePlan {
  const leg = { vm: 'svm' as const, chainId, account }
  return { source: [], destination: leg, deployments: [leg] }
}

function deploymentQuote(
  overrides: Partial<OrchestratorDeploymentQuote> = {},
): OrchestratorDeploymentQuote {
  return {
    intentId: 'deployment-intent',
    purpose: 'deployment',
    expiresAt: 2_000_000_000,
    estimatedFillTime: { seconds: 2 },
    settlementLayer: 'SAME_CHAIN',
    plan: plan(),
    cost: emptyCost(),
    deploymentCosts: [
      {
        vm: 'svm',
        chainId: DEVNET,
        rent: { amount: 1_869_440n, usd: 0.3, sponsored: true },
      },
    ],
    requirements: [],
    signingRequests: [],
    ...overrides,
  }
}

function context(
  candidate: OrchestratorQuote = deploymentQuote(),
  now = 1_900_000_000_000,
) {
  const createQuote = vi.fn(async () => ({
    traceId: 'quote-trace',
    routes: [candidate],
  }))
  const submitIntent = vi.fn(async () => ({
    traceId: 'submit-trace',
    intentId: candidate.intentId,
  }))
  return {
    createQuote,
    submitIntent,
    workflow: {
      quoteClient: { createQuote },
      submissionClient: { submitIntent },
      now: () => now,
    },
  }
}

describe('Solana Swig deployment request', () => {
  test('installs the ECDSA owner key in the Solana-only creation shape', () => {
    const { request, normalized } = buildSolanaDeploymentRequest(ecdsaInput())

    expect(request).toEqual({
      account: {
        svm: {
          type: 'swig',
          address: wallet,
          swigAccount: swig,
          authorization: { kind: 'secp256k1', address: owner.address },
          initData: {
            authority: { kind: 'secp256k1', publicKey: owner.publicKey },
            id: swigId,
          },
        },
      },
      destination: { vm: 'svm', chainId: DEVNET, tokenRequests: [] },
      source: { selection: { chains: { only: [DEVNET] }, tokens: 'all' } },
      options: { sponsorship: { gas: true } },
    })
    expect(request.account).not.toHaveProperty('evm')
    expect(normalized).toEqual({
      account: { address: wallet },
      destinationChainId: 792703810,
      destinationExecutions: [],
      tokenRequests: [],
      accountAccessList: { chainIds: [792703810] },
      options: {
        signatureMode: 1,
        sponsorSettings: { gas: true, bridgeFees: false, swapFees: false },
      },
    })
    expect(isSponsoredIntentInput(normalized)).toBe(true)
  })

  test('installs the compressed passkey', () => {
    const { request } = buildSolanaDeploymentRequest(passkeyInput())
    expect(request.account.svm).toMatchObject({
      authorization: { kind: 'secp256r1', publicKey: passkey },
      initData: {
        authority: { kind: 'secp256r1', publicKey: passkey },
        id: swigId,
      },
    })
  })

  test.each([
    ['a malformed id', { swigId: '0x1234' as Hex }, /32 bytes of hex/],
    [
      'an id deriving another Swig',
      { swigId: `0x${'08'.repeat(32)}` as Hex },
      /does not derive the configured Swig/,
    ],
    [
      'a wallet the Swig does not derive',
      { walletAddress: swig },
      /does not derive the configured Swig and wallet/,
    ],
    [
      'an installed authority of another kind',
      { initAuthority: { kind: 'secp256r1', publicKey: passkey } as const },
      /configured Solana owner/,
    ],
    [
      'a malformed ECDSA public key',
      {
        initAuthority: { kind: 'secp256k1', publicKey: '0x04' as Hex } as const,
      },
      /SEC1 secp256k1 public key/,
    ],
    [
      'another namespace',
      { namespace: 'local-v1' as 'dev-v1' },
      /namespace must be dev-v1 or prod-v1/,
    ],
  ])('refuses %s', (_label, overrides, message) => {
    expect(() =>
      buildSolanaDeploymentRequest(
        ecdsaInput(overrides as Partial<SolanaDeploymentInput>),
      ),
    ).toThrow(message)
  })

  test('builds the same request under the production namespace', () => {
    expect(
      buildSolanaDeploymentRequest(ecdsaInput({ namespace: 'prod-v1' })),
    ).toEqual(buildSolanaDeploymentRequest(ecdsaInput()))
  })

  test('refuses an installed passkey that is not the configured one', () => {
    expect(() =>
      buildSolanaDeploymentRequest(
        passkeyInput({
          initAuthority: {
            kind: 'secp256r1',
            publicKey: `0x02${'11'.repeat(32)}`,
          },
        }),
      ),
    ).toThrow(/configured 33-byte compressed P-256 key/)
  })
})

describe('Solana Swig deployment quote', () => {
  test('prepares the validated deployment route', async () => {
    const fixture = context()
    const prepared = await prepareSolanaDeployment(
      fixture.workflow,
      ecdsaInput(),
    )
    expect(fixture.createQuote).toHaveBeenCalledWith(prepared.request)
    expect(prepared.quote.intentId).toBe('deployment-intent')
    expect(prepared.traceId).toBe('quote-trace')
  })

  test('accepts the configured passkey authority case-insensitively', async () => {
    const fixture = context(
      deploymentQuote({
        plan: plan({
          wallet,
          swigAccount: swig,
          authority: {
            kind: 'secp256r1',
            publicKey: passkey.toUpperCase().replace('0X', '0x') as Hex,
          },
        }),
      }),
    )
    await expect(
      prepareSolanaDeployment(fixture.workflow, passkeyInput()),
    ).resolves.toMatchObject({ quote: { purpose: 'deployment' } })
  })

  const otherAuthority: SwigAuthority = {
    kind: 'secp256k1',
    address: privateKeyToAccount(`0x${'13'.repeat(32)}`).address,
  }

  test.each<[string, OrchestratorQuote, RegExp]>([
    [
      'an execution route',
      caucasusQuote({ intentId: 'execution-intent' }),
      /must be a deployment route/,
    ],
    [
      'a route asking for signatures',
      deploymentQuote({
        signingRequests: caucasusQuote().signingRequests,
      }),
      /ask for no signatures/,
    ],
    [
      'a route with requirements',
      deploymentQuote({
        requirements: [
          {
            kind: 'wrapNative',
            vm: 'svm',
            chainId: DEVNET,
            account: { address: wallet },
            tokenAddress: wallet,
            amount: 1n,
          },
        ],
      }),
      /no requirements/,
    ],
    [
      'a deployment of another Swig',
      deploymentQuote({
        plan: plan({
          wallet,
          swigAccount: wallet,
          authority: { kind: 'secp256k1', address: owner.address },
        }),
      }),
      /exactly the configured Swig and wallet/,
    ],
    [
      'a deployment of another wallet',
      deploymentQuote({
        plan: plan({
          wallet: swig,
          swigAccount: swig,
          authority: { kind: 'secp256k1', address: owner.address },
        }),
      }),
      /exactly the configured Swig and wallet/,
    ],
    [
      'a deployment on another chain',
      deploymentQuote({ plan: plan(undefined, MAINNET) }),
      /exactly the configured Swig and wallet/,
    ],
    [
      'a deployment of an EVM account',
      deploymentQuote({
        plan: plan({ address: owner.address, type: 'erc7579' }),
      }),
      /exactly the configured Swig and wallet/,
    ],
    [
      'more than one deployment',
      deploymentQuote({
        plan: {
          ...plan(),
          deployments: [...plan().deployments, ...plan().deployments],
        },
      }),
      /exactly the configured Swig and wallet/,
    ],
    [
      'a deployment installing another authority',
      deploymentQuote({
        plan: plan({ wallet, swigAccount: swig, authority: otherAuthority }),
      }),
      /install the configured Solana owner/,
    ],
    [
      'a deployment that discloses no authority',
      deploymentQuote({ plan: plan({ wallet, swigAccount: swig }) }),
      /install the configured Solana owner/,
    ],
    [
      'a deployment cost on another chain',
      deploymentQuote({
        deploymentCosts: [
          {
            vm: 'svm',
            chainId: MAINNET,
            rent: { amount: 1n, usd: 0, sponsored: true },
          },
        ],
      }),
      /every deployment cost/,
    ],
    [
      'a route without an intent id',
      deploymentQuote({ intentId: '' }),
      /carry an intent id/,
    ],
  ])('refuses %s', async (_label, candidate, message) => {
    const fixture = context(candidate)
    const refusal = prepareSolanaDeployment(fixture.workflow, ecdsaInput())
    await expect(refusal).rejects.toBeInstanceOf(
      InvalidSolanaTransactionArtifactError,
    )
    await expect(refusal).rejects.toThrow(message)
  })

  test('refuses an answer with no routes', async () => {
    const fixture = context()
    fixture.createQuote.mockResolvedValueOnce({ traceId: 't', routes: [] })
    await expect(
      prepareSolanaDeployment(fixture.workflow, ecdsaInput()),
    ).rejects.toThrow(/no quote/)
  })

  test('refuses an expired quote', async () => {
    const fixture = context(deploymentQuote(), 2_000_000_000_000)
    await expect(
      prepareSolanaDeployment(fixture.workflow, ecdsaInput()),
    ).rejects.toBeInstanceOf(SolanaQuoteExpiredError)
  })
})

describe('Solana Swig deployment submission', () => {
  test('submits with no proofs, sponsored', async () => {
    const fixture = context()
    const prepared = await prepareSolanaDeployment(
      fixture.workflow,
      ecdsaInput(),
    )
    const submitted = await submitSolanaDeployment(fixture.workflow, prepared)

    expect(fixture.submitIntent).toHaveBeenCalledWith(
      { intentId: 'deployment-intent', proofs: [] },
      {
        intentInput: expect.objectContaining({
          account: { address: wallet },
          destinationChainId: 792703810,
        }),
        sponsored: true,
      },
    )
    expect(submitted).toEqual({
      type: 'intent',
      traceId: 'submit-trace',
      intentId: 'deployment-intent',
      sourceChains: [792703810],
      targetChain: 792703810,
    })
  })

  test('refuses a quote that expired before submission', async () => {
    const fixture = context()
    const prepared = await prepareSolanaDeployment(
      fixture.workflow,
      ecdsaInput(),
    )
    const late = { ...fixture.workflow, now: () => 2_000_000_000_000 }
    await expect(submitSolanaDeployment(late, prepared)).rejects.toBeInstanceOf(
      SolanaQuoteExpiredError,
    )
    expect(fixture.submitIntent).not.toHaveBeenCalled()
  })
})
