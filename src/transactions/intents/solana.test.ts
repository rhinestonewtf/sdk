import { base64urlnopad } from '@scure/base'
import { concat, type Hex, hexToBytes, sha256, stringToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test, vi } from 'vitest'
import {
  quote as caucasusQuote,
  costEntry,
  delegationRequest,
  eip712Request,
  emptyCost,
  personalSignRequest,
} from '../../../test/utils/caucasus'
import { signingPasskey } from '../../../test/utils/passkeys'
import type { SolanaAddress } from '../../chains/non-evm'
import {
  solanaAddress,
  solanaDevnet,
  solanaMainnet,
} from '../../chains/non-evm'
import { parseErrorEnvelope } from '../../clients/orchestrator/errors'
import { projectCompatibleIntentInput } from '../../clients/orchestrator/normalized'
import type {
  IntentAccountView,
  QuotePlan,
  SigningProof,
  SigningRequest,
  WebAuthnAssertion,
} from '../../clients/orchestrator/public'
import type {
  OrchestratorIntentRequest,
  OrchestratorQuote,
} from '../../clients/orchestrator/types'
import {
  InvalidSolanaTransactionArtifactError,
  SolanaQuoteExpiredError,
} from '../../errors/execution'
import type { IntentAccountProjection } from './account'
import {
  assertSolanaNotExpired,
  buildSolanaIntentRequest,
  compressP256PublicKey,
  prepareSolanaIntent,
  reconstructSolanaIntent,
  type SolanaAction,
  type SolanaDelivery,
  type SolanaEvmExecution,
  type SolanaTransferInput,
  signSolanaIntent,
  solanaChainId,
  submitSolanaIntent,
  validateSolanaSignature,
  validateSolanaWebAuthnAssertion,
} from './solana'

const owner = privateKeyToAccount(`0x${'12'.repeat(32)}`)
const other = privateKeyToAccount(`0x${'13'.repeat(32)}`)
const mint = solanaAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const recipient = solanaAddress('11111111111111111111111111111112')
const wallet = solanaAddress('DfBX7Po1bmnXt4GuEF3Eg5UYUHAjs9m5n8nbb9WUqgw2')
const swig = solanaAddress('9fTE4gQnweN345EGzy6jnXNFW8VryvZ8QwLZqgBubmMs')
const message = 'ab'.repeat(32)

const accountAddress = '0x29b406a587dd2a8ba87b9431262ee4fe732f5f0b' as const
const destinationToken = '0x036cbd53842c5426634e7929541ec2318f3dcf7e' as const
const destinationRecipient =
  '0xabc82222eaa155331bac89b87c20a584a8e05add' as const
const baseSepoliaId = 84532
const BASE_SEPOLIA = 'eip155:84532'
const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'

type TransferOverrides = Omit<Partial<SolanaTransferInput>, 'action'> & {
  mint?: SolanaAddress
  amount?: bigint
  delivery?: SolanaDelivery
}

function transfer(overrides: TransferOverrides = {}): SolanaTransferInput {
  const {
    mint: mintOverride,
    delivery,
    amount: _amount,
    ...binding
  } = overrides
  const amount = 'amount' in overrides ? overrides.amount : 100_000n
  return {
    chain: solanaDevnet,
    action: {
      kind: 'transfer',
      mint: mintOverride ?? mint,
      ...(amount === undefined ? {} : { amount }),
      delivery: delivery ?? { kind: 'same-chain', recipient },
    },
    accountAddress: wallet,
    authority: { kind: 'secp256k1', address: owner.address },
    walletAddress: wallet,
    swigAddress: swig,
    namespace: 'dev-v1',
    endpoint: 'https://dev.example',
    ...binding,
  }
}

const swigView: IntentAccountView = {
  wallet,
  swigAccount: swig,
  authority: { kind: 'secp256k1', address: owner.address },
}

function svmPlan(chainId: string): QuotePlan {
  const leg = { vm: 'svm' as const, chainId, account: swigView }
  return { source: [leg], destination: leg, deployments: [] }
}

/** The one spend authorization a Solana-origin quote carries. */
function spendRequest(overrides: Partial<SigningRequest> = {}): SigningRequest {
  return {
    ...personalSignRequest({
      chainId: DEVNET,
      wallet,
      swigAccount: swig,
      authority: owner.address,
      message,
      expiresAtSlot: '123456789',
    }),
    ...overrides,
  }
}

function splCost(chainId: string, tokenAddress: string, amount: bigint) {
  return {
    ...costEntry({ chainId, tokenAddress, amount }),
    symbol: 'USDC',
    decimals: 6,
    price: { usd: 1 },
  }
}

function quote(overrides: Partial<OrchestratorQuote> = {}): OrchestratorQuote {
  return {
    ...caucasusQuote({
      intentId: 'solana-intent',
      expiresAt: 2_000_000_000,
      signingRequests: [spendRequest()],
      cost: {
        ...emptyCost(),
        input: [splCost(DEVNET, mint, 100_100n)],
        output: [splCost(DEVNET, mint, 100_000n)],
      },
    }),
    plan: svmPlan(DEVNET),
    estimatedFillTime: { seconds: 2 },
    ...overrides,
  }
}

function context(candidate = quote()) {
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
      now: () => 1_900_000_000_000,
    },
  }
}

describe('managed Solana intent workflow', () => {
  test('builds the standalone Swig quote and preserves backend costs', async () => {
    const fixture = context()
    const prepared = await prepareSolanaIntent(fixture.workflow, transfer())

    expect(fixture.createQuote).toHaveBeenCalledWith({
      account: {
        svm: {
          type: 'swig',
          address: wallet,
          swigAccount: swig,
          authorization: { kind: 'secp256k1', address: owner.address },
        },
      },
      destination: {
        vm: 'svm',
        chainId: DEVNET,
        recipient: { address: recipient },
        tokenRequests: [{ tokenAddress: mint, amount: 100_000n }],
      },
      source: {
        selection: {
          chains: { only: [DEVNET] },
          tokens: { only: [mint] },
          perChain: { [DEVNET]: { tokens: { only: [mint] } } },
        },
      },
    })
    // The sponsorship projection keeps its numeric chain ids and its original
    // field names across the wire migration.
    expect(prepared.normalized).toEqual({
      account: { address: wallet },
      destinationChainId: 792703810,
      destinationExecutions: [],
      tokenRequests: [{ tokenAddress: mint, amount: 100_000n }],
      recipient: { address: recipient },
      accountAccessList: { chainIds: [792703810] },
      options: { signatureMode: 1 },
    })
    expect(prepared.quote.cost.input[0]?.amount).toBe(100_100n)
  })

  test('names the Swig state account instead of an EVM entry for a standalone account', () => {
    const { request, normalized } = buildSolanaIntentRequest(
      transfer({ accountAddress: wallet, accountType: undefined }),
    )

    expect(request.account).toEqual({
      svm: {
        type: 'swig',
        address: wallet,
        swigAccount: swig,
        authorization: { kind: 'secp256k1', address: owner.address },
      },
    })
    expect(normalized.account).toEqual({ address: wallet })
  })

  test('signs the exact digest text and submits one recoverable origin signature', async () => {
    const fixture = context()
    const prepared = await prepareSolanaIntent(fixture.workflow, transfer())
    const signMessage = vi.fn(owner.signMessage)
    const signed = await signSolanaIntent({
      prepared,
      owner: { ...owner, signMessage },
      now: fixture.workflow.now,
    })

    // The 64 characters are signed as text: opaque to the SDK, despite looking
    // like hex.
    expect(signMessage).toHaveBeenCalledWith({ message })
    expect(signed.proofs).toEqual([
      {
        kind: 'personalSign',
        signature: expect.stringMatching(/^0x[0-9a-f]{130}$/u),
      },
    ])
    const submitted = await submitSolanaIntent(fixture.workflow, signed)
    expect(fixture.submitIntent).toHaveBeenCalledWith(
      {
        intentId: 'solana-intent',
        proofs: signed.proofs,
      },
      {
        intentInput: projectCompatibleIntentInput(prepared.normalized),
        sponsored: false,
      },
    )
    expect(submitted.targetChain).toBe(792703810)
  })

  test('rejects expired, wrong-route, and tampered plain artifacts before effects', async () => {
    const expired = context(quote({ expiresAt: 1_800_000_000 }))
    const prepared = await prepareSolanaIntent(expired.workflow, transfer())
    await expect(
      signSolanaIntent({ prepared, owner, now: expired.workflow.now }),
    ).rejects.toThrow(SolanaQuoteExpiredError)

    const malformed = context(
      quote({ settlementLayer: 'ACROSS', signingRequests: [] }),
    )
    await expect(
      prepareSolanaIntent(malformed.workflow, transfer()),
    ).rejects.toThrow(InvalidSolanaTransactionArtifactError)

    const valid = context()
    const fresh = await prepareSolanaIntent(valid.workflow, transfer())
    expect(() =>
      reconstructSolanaIntent({
        traceId: fresh.traceId,
        request: fresh.request,
        transfer: transfer(),
        intentInput: {
          ...projectCompatibleIntentInput(fresh.normalized),
          recipient: { address: wallet },
        },
        quote: fresh.quote,
        quotes: fresh.quotes,
      }),
    ).toThrow(/canonical intent input|persisted request/)
    expect(valid.submitIntent).not.toHaveBeenCalled()
  })

  test.each([
    transfer({ amount: 0n }),
    transfer({ amount: 1 as never }),
    transfer({ mint: solanaAddress('11111111111111111111111111111111') }),
    transfer({ delivery: { kind: 'same-chain', recipient: wallet } }),
    transfer({
      delivery: {
        kind: 'cross-chain',
        chainId: 792703810,
        token: destinationToken,
        recipient: destinationRecipient,
      },
    }),
    transfer({
      delivery: {
        kind: 'cross-chain',
        chainId: baseSepoliaId,
        token: 'not-an-address' as never,
        recipient: destinationRecipient,
      },
    }),
    transfer({
      delivery: {
        kind: 'cross-chain',
        chainId: baseSepoliaId,
        token: destinationToken,
        recipient: recipient as never,
      },
    }),
    transfer({ namespace: 'other' as 'dev-v1' }),
    transfer({ appFees: { feeBps: -1 } }),
    transfer({ appFees: { feeBps: 1.5 } }),
    transfer({ protocolFees: { feeBps: 10_001 } }),
    transfer({ protocolFees: { feeBps: '1' as never } }),
  ])('refuses unsupported transfer input before quoting %#', (input) => {
    expect(() => buildSolanaIntentRequest(input)).toThrow(
      InvalidSolanaTransactionArtifactError,
    )
  })

  test('supports mainnet identity and max-out with valid fee requests', () => {
    expect(solanaChainId(solanaMainnet)).toBe(792703809)
    const built = buildSolanaIntentRequest(
      transfer({
        chain: solanaMainnet,
        amount: undefined,
        appFees: { feeBps: 1 },
        protocolFees: { feeBps: 2 },
      }),
    )
    expect(built.request).toMatchObject({
      destination: {
        chainId: MAINNET,
        tokenRequests: [{ tokenAddress: mint }],
      },
      source: { selection: { chains: { only: [MAINNET] } } },
      options: { appFees: { feeBps: 1 }, protocolFees: { feeBps: 2 } },
    })
    // No `amount` at all: a max-out spends the whole balance.
    expect(built.normalized.tokenRequests).toEqual([{ tokenAddress: mint }])
    expect(built.normalized).toMatchObject({
      destinationChainId: 792703809,
      options: {
        signatureMode: 1,
        appFees: { feeBps: 1 },
        protocolFees: { feeBps: 2 },
      },
    })
    expect(() =>
      solanaChainId({ ...solanaDevnet, caip2: 'solana:unknown' } as never),
    ).toThrow(/canonical Solana/)
    expect(() =>
      solanaChainId({ ...solanaDevnet, kind: 'tvm' } as never),
    ).toThrow(/canonical Solana/)
  })

  test.each([
    ['no intent id', quote({ intentId: '' }), /must carry an intent id/],
    [
      'no signing request',
      quote({ signingRequests: [] }),
      /exactly one signing request/,
    ],
    // Position is a signing request's identity, so a second one is a different
    // authorization set, not a duplicate to ignore.
    [
      'a second signing request',
      quote({ signingRequests: [spendRequest(), spendRequest()] }),
      /exactly one signing request/,
    ],
    [
      'a payload that is not a personal sign',
      quote({
        signingRequests: [
          spendRequest({ payload: { kind: 'webauthn', challenge: message } }),
        ],
      }),
      /UTF-8 personal-sign spend authorization/,
    ],
    [
      'a short digest',
      quote({
        signingRequests: [
          spendRequest({
            payload: {
              kind: 'personalSign',
              message: { encoding: 'utf8', value: 'short' },
            },
          }),
        ],
      }),
      /64-character opaque payload/,
    ],
    [
      'a digest that is not hexadecimal',
      quote({
        signingRequests: [
          spendRequest({
            payload: {
              kind: 'personalSign',
              message: { encoding: 'utf8', value: 'zz'.repeat(32) },
            },
          }),
        ],
      }),
      /64-character opaque payload/,
    ],
    // The Swig wallet holds the assets; the state account is a different
    // address, and signing for it would authorize nothing.
    [
      'another Swig wallet',
      quote({
        signingRequests: [
          spendRequest({
            account: { vm: 'svm', wallet: recipient, swigAccount: swig },
          }),
        ],
      }),
      /configured Swig wallet and state account/,
    ],
    [
      'the state account in the wallet slot',
      quote({
        signingRequests: [
          spendRequest({
            account: { vm: 'svm', wallet: swig, swigAccount: swig },
          }),
        ],
      }),
      /configured Swig wallet and state account/,
    ],
    [
      'another Swig state account',
      quote({
        signingRequests: [
          spendRequest({
            account: { vm: 'svm', wallet, swigAccount: recipient },
          }),
        ],
      }),
      /configured Swig wallet and state account/,
    ],
    [
      'an EVM account slot',
      quote({
        signingRequests: [
          spendRequest({ account: { vm: 'evm', address: accountAddress } }),
        ],
      }),
      /configured Swig wallet and state account/,
    ],
    [
      'another authority',
      quote({
        signingRequests: [
          spendRequest({
            authority: {
              kind: 'swigRole',
              roleId: 1,
              authority: { kind: 'secp256k1', address: other.address },
            },
          }),
        ],
      }),
      /configured Solana authority/,
    ],
    [
      'an authority the SDK cannot sign for',
      quote({
        signingRequests: [
          spendRequest({
            authority: { kind: 'account', vm: 'evm', address: owner.address },
          }),
        ],
      }),
      /configured Solana authority/,
    ],
    [
      'a scope that is not a Solana spend',
      quote({
        signingRequests: [
          spendRequest({
            scope: { vm: 'evm', action: 'claim', accounts: [] },
          }),
        ],
      }),
      /authorize a Solana spend/,
    ],
    [
      'no slot window',
      quote({
        signingRequests: [
          spendRequest({
            validity: [{ kind: 'timestamp', expiresAt: 2_000_000_000 }],
          }),
        ],
      }),
      /decimal Solana slot window/,
    ],
    [
      'a slot that is not decimal',
      quote({
        signingRequests: [
          personalSignRequest({
            chainId: DEVNET,
            wallet,
            swigAccount: swig,
            authority: owner.address,
            message,
            expiresAtSlot: 'not-a-slot',
          }),
        ],
      }),
      /decimal Solana slot window/,
    ],
    [
      'no input cost',
      quote({ cost: { ...quote().cost, input: [] } }),
      /exactly one input and one output/,
    ],
    [
      'an output cost on another cluster',
      quote({
        cost: {
          ...quote().cost,
          output: [splCost(MAINNET, mint, 100_000n)],
        },
      }),
      /output cost must reference the requested Solana chain/,
    ],
  ])('rejects a quote with %s', async (_name, candidate, reason) => {
    const fixture = context(candidate)
    await expect(
      prepareSolanaIntent(fixture.workflow, transfer()),
    ).rejects.toThrow(reason)
  })

  test('accepts a bare secp256k1 authority on the spend', async () => {
    const fixture = context(
      quote({
        signingRequests: [
          spendRequest({
            authority: { kind: 'secp256k1', address: owner.address },
          }),
        ],
      }),
    )
    await expect(
      prepareSolanaIntent(fixture.workflow, transfer()),
    ).resolves.toMatchObject({ quote: { intentId: 'solana-intent' } })
  })

  test('rejects an empty quote response', async () => {
    const fixture = context()
    fixture.createQuote.mockResolvedValueOnce({ traceId: 'trace', routes: [] })
    await expect(
      prepareSolanaIntent(fixture.workflow, transfer()),
    ).rejects.toThrow(/returned no quote/)
  })

  test('surfaces the orchestrator refusal when the Swig does not exist', async () => {
    // Caucasus takes no Swig `initData`, so a missing Swig is a refusal the
    // caller has to resolve, never a deployment the SDK requests.
    const refusal = parseErrorEnvelope(
      {
        code: 'VALIDATION_ERROR',
        message: 'Solana account not created',
        traceId: 'trace-swig',
        details: [
          {
            message: 'Solana account not created',
            context: {
              code: 'SOLANA_ACCOUNT_NOT_CREATED',
              swigAddress: swig,
              chainId: DEVNET,
            },
          },
        ],
      },
      422,
    )
    const workflow = {
      quoteClient: {
        createQuote: vi.fn(async () => {
          throw refusal
        }),
      },
      submissionClient: { submitIntent: vi.fn() },
      now: () => 1_900_000_000_000,
    }
    await expect(
      prepareSolanaIntent(workflow as never, transfer()),
    ).rejects.toBe(refusal)
    expect(
      buildSolanaIntentRequest(transfer()).request.account.svm,
    ).not.toHaveProperty('initData')
  })

  test('reconstructs valid plain data and rejects missing or changed quotes', async () => {
    const fixture = context()
    const prepared = await prepareSolanaIntent(fixture.workflow, transfer())
    const plain = {
      traceId: prepared.traceId,
      request: prepared.request,
      transfer: transfer(),
      intentInput: projectCompatibleIntentInput(prepared.normalized),
      quote: prepared.quote,
      quotes: prepared.quotes,
    }
    expect(reconstructSolanaIntent(plain).quote.intentId).toBe('solana-intent')
    expect(() => reconstructSolanaIntent({ ...plain, quotes: [] })).toThrow(
      /selected quote/,
    )
    expect(() =>
      reconstructSolanaIntent({
        ...plain,
        quote: { ...prepared.quote, expiresAt: prepared.quote.expiresAt + 1 },
      }),
    ).toThrow(/selected quote/)
    // A prepared spend is good for one slot window, so a re-quoted window is a
    // different authorization rather than a refresh of this one.
    expect(() =>
      reconstructSolanaIntent({
        ...plain,
        quote: {
          ...prepared.quote,
          signingRequests: [
            personalSignRequest({
              chainId: DEVNET,
              wallet,
              swigAccount: swig,
              authority: owner.address,
              message,
              expiresAtSlot: '223456789',
            }),
          ],
        },
      }),
    ).toThrow(/selected quote/)
  })

  test('rejects missing, malformed, unrecoverable, and wrong-authority signatures', async () => {
    const fixture = context()
    const prepared = await prepareSolanaIntent(fixture.workflow, transfer())
    const payload = { message }
    await expect(
      signSolanaIntent({
        prepared,
        owner: { address: owner.address, type: 'local' } as never,
        now: fixture.workflow.now,
      }),
    ).rejects.toThrow(/cannot sign messages/)
    await expect(
      validateSolanaSignature(owner.address, payload, '0x12'),
    ).rejects.toThrow(/65-byte/)
    await expect(
      validateSolanaSignature(owner.address, payload, `0x${'ff'.repeat(65)}`),
    ).rejects.toThrow(/not recoverable/)
    const signature = await owner.signMessage({ message })
    await expect(
      validateSolanaSignature(other.address, payload, signature),
    ).rejects.toThrow(/configured Solana authority/)
  })

  test('rejects non-finite deadlines', () => {
    expect(() =>
      assertSolanaNotExpired(0, quote({ expiresAt: Number.NaN })),
    ).toThrow(SolanaQuoteExpiredError)
  })
})

describe('sponsored Solana intents', () => {
  const sponsorSettings = {
    gas: true,
    bridgeFees: false,
    swapFees: false,
    protocolFees: true,
  } as const

  test('carries the requested sponsorship on the quote options', () => {
    const built = buildSolanaIntentRequest(transfer({ sponsorSettings }))
    expect(built.request.options).toEqual({ sponsorship: sponsorSettings })
    expect(built.normalized.options).toEqual({
      signatureMode: 1,
      sponsorSettings,
    })
  })

  test('leaves the options untouched when nothing is sponsored', () => {
    const built = buildSolanaIntentRequest(transfer())
    expect(built.request).not.toHaveProperty('options')
    expect(built.normalized.options).toEqual({ signatureMode: 1 })
  })

  test('reports the sponsorship on submit', async () => {
    const fixture = context()
    const prepared = await prepareSolanaIntent(
      fixture.workflow,
      transfer({ sponsorSettings }),
    )
    const signed = await signSolanaIntent({
      prepared,
      owner,
      now: fixture.workflow.now,
    })
    await submitSolanaIntent(fixture.workflow, signed)

    expect(fixture.submitIntent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sponsored: true }),
    )
  })

  test('reports no sponsorship for an unsponsored intent', async () => {
    const fixture = context()
    const prepared = await prepareSolanaIntent(fixture.workflow, transfer())
    const signed = await signSolanaIntent({
      prepared,
      owner,
      now: fixture.workflow.now,
    })
    await submitSolanaIntent(fixture.workflow, signed)

    expect(fixture.submitIntent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sponsored: false }),
    )
  })

  test('rejects a restored transaction whose sponsorship changed', async () => {
    const fixture = context()
    const prepared = await prepareSolanaIntent(
      fixture.workflow,
      transfer({ sponsorSettings }),
    )
    const intentInput = projectCompatibleIntentInput(prepared.normalized)

    expect(() =>
      reconstructSolanaIntent({
        traceId: prepared.traceId,
        request: prepared.request,
        transfer: transfer({ sponsorSettings }),
        intentInput,
        quote: prepared.quote,
        quotes: prepared.quotes,
      }),
    ).not.toThrow()
    expect(() =>
      reconstructSolanaIntent({
        traceId: prepared.traceId,
        request: prepared.request,
        transfer: transfer({
          sponsorSettings: { ...sponsorSettings, protocolFees: false },
        }),
        intentInput,
        quote: prepared.quote,
        quotes: prepared.quotes,
      }),
    ).toThrow(/canonical intent input|persisted request/)
    expect(() =>
      reconstructSolanaIntent({
        traceId: prepared.traceId,
        request: prepared.request,
        transfer: transfer(),
        intentInput,
        quote: prepared.quote,
        quotes: prepared.quotes,
      }),
    ).toThrow(/canonical intent input|persisted request/)
  })
})

describe('Solana-origin cross-chain delivery', () => {
  const delivery = {
    kind: 'cross-chain',
    chainId: baseSepoliaId,
    token: destinationToken,
    recipient: destinationRecipient,
  } as const

  function crossChainTransfer(
    overrides: TransferOverrides = {},
  ): SolanaTransferInput {
    return transfer({ delivery, ...overrides })
  }

  function crossChainQuote(
    overrides: Partial<OrchestratorQuote> = {},
  ): OrchestratorQuote {
    const base = quote()
    return {
      ...base,
      settlementLayer: 'RELAY',
      bridgeFill: {
        type: 'RELAY',
        requestId: `0x${'ab'.repeat(32)}`,
        destinationChainId: BASE_SEPOLIA,
        fillStatusTimeout: 60_000,
      },
      cost: {
        ...base.cost,
        // The orchestrator lowercases EVM token addresses.
        output: [splCost(BASE_SEPOLIA, destinationToken, 99_500n)],
      },
      ...overrides,
    }
  }

  test('targets the EVM destination and narrows the source to the named mint', () => {
    expect(
      buildSolanaIntentRequest(
        crossChainTransfer({
          appFees: { feeBps: 10 },
          protocolFees: { feeBps: 5 },
        }),
      ),
    ).toEqual({
      request: {
        account: {
          svm: {
            type: 'swig',
            address: wallet,
            swigAccount: swig,
            authorization: { kind: 'secp256k1', address: owner.address },
          },
        },
        destination: {
          vm: 'evm',
          chainId: BASE_SEPOLIA,
          recipient: { address: destinationRecipient },
          tokenRequests: [{ tokenAddress: destinationToken, amount: 100_000n }],
        },
        // Naming the cluster without the mint would re-expand the source scope
        // to every registry token on it.
        source: {
          selection: {
            chains: { only: [DEVNET] },
            tokens: { only: [mint] },
            perChain: { [DEVNET]: { tokens: { only: [mint] } } },
          },
        },
        options: { appFees: { feeBps: 10 }, protocolFees: { feeBps: 5 } },
      },
      normalized: {
        account: { address: wallet },
        destinationChainId: baseSepoliaId,
        destinationExecutions: [],
        tokenRequests: [{ tokenAddress: destinationToken, amount: 100_000n }],
        recipient: { address: destinationRecipient },
        // `chainIds` would union with this and re-expand the source scope.
        accountAccessList: { chainTokens: { 792703810: [mint] } },
        options: {
          signatureMode: 1,
          appFees: { feeBps: 10 },
          protocolFees: { feeBps: 5 },
        },
      },
    })
  })

  test('carries sponsorship on a delivery', () => {
    const sponsorSettings = {
      gas: true,
      bridgeFees: true,
      swapFees: false,
      protocolFees: false,
    } as const
    const built = buildSolanaIntentRequest(
      crossChainTransfer({ sponsorSettings }),
    )
    expect(built.request.options).toEqual({ sponsorship: sponsorSettings })
    expect(built.normalized.options).toMatchObject({ sponsorSettings })
  })

  test('spends the whole balance when no delivery amount is given', () => {
    expect(
      buildSolanaIntentRequest(crossChainTransfer({ amount: undefined })),
    ).toMatchObject({
      request: {
        destination: { tokenRequests: [{ tokenAddress: destinationToken }] },
      },
      normalized: { tokenRequests: [{ tokenAddress: destinationToken }] },
    })
  })

  test('accepts a vendor-settled route and reports the EVM target chain', async () => {
    const fixture = context(crossChainQuote())
    const prepared = await prepareSolanaIntent(
      fixture.workflow,
      crossChainTransfer(),
    )

    expect(prepared.quote.bridgeFill).toMatchObject({
      type: 'RELAY',
      requestId: `0x${'ab'.repeat(32)}`,
      destinationChainId: BASE_SEPOLIA,
      fillStatusTimeout: 60_000,
    })
    const signed = await signSolanaIntent({
      prepared,
      owner,
      now: fixture.workflow.now,
    })
    const submitted = await submitSolanaIntent(fixture.workflow, signed)
    expect(submitted).toMatchObject({
      sourceChains: [792703810],
      targetChain: baseSepoliaId,
    })
  })

  test('accepts a settlement layer the corridor has not moved to yet', async () => {
    const fixture = context(crossChainQuote({ settlementLayer: 'CCTP' }))
    await expect(
      prepareSolanaIntent(fixture.workflow, crossChainTransfer()),
    ).resolves.toMatchObject({ quote: { settlementLayer: 'CCTP' } })
  })

  test('matches the delivered token case-insensitively', async () => {
    const fixture = context(
      crossChainQuote({
        cost: {
          ...crossChainQuote().cost,
          output: [
            splCost(BASE_SEPOLIA, destinationToken.toUpperCase(), 99_500n),
          ],
        },
      }),
    )
    await expect(
      prepareSolanaIntent(fixture.workflow, crossChainTransfer()),
    ).resolves.toMatchObject({ quote: { intentId: 'solana-intent' } })
  })

  test.each([
    [
      'a same-chain settlement layer',
      crossChainQuote({ settlementLayer: 'SAME_CHAIN' }),
    ],
    // A destination fill is authorized by the solver, not by this spend, so a
    // second signing request is not this intent.
    [
      'a destination signing request',
      crossChainQuote({
        signingRequests: [spendRequest(), spendRequest()],
      }),
    ],
    [
      'an input leg on the wrong chain',
      crossChainQuote({
        cost: {
          ...crossChainQuote().cost,
          input: [splCost(MAINNET, mint, 100_100n)],
        },
      }),
    ],
    [
      'an input leg naming another mint',
      crossChainQuote({
        cost: {
          ...crossChainQuote().cost,
          input: [
            splCost(
              DEVNET,
              solanaAddress('11111111111111111111111111111112'),
              100_100n,
            ),
          ],
        },
      }),
    ],
    [
      'an output leg on the wrong chain',
      crossChainQuote({
        cost: {
          ...crossChainQuote().cost,
          output: [splCost('eip155:1', destinationToken, 99_500n)],
        },
      }),
    ],
    [
      'an output leg naming another token',
      crossChainQuote({
        cost: {
          ...crossChainQuote().cost,
          output: [
            splCost(
              BASE_SEPOLIA,
              '0x0000000000000000000000000000000000000001',
              99_500n,
            ),
          ],
        },
      }),
    ],
  ])('rejects a quote with %s', async (_name, candidate) => {
    const fixture = context(candidate)
    await expect(
      prepareSolanaIntent(fixture.workflow, crossChainTransfer()),
    ).rejects.toThrow(InvalidSolanaTransactionArtifactError)
  })

  test('rejects a same-chain quote for a same-chain transfer only', async () => {
    const fixture = context(crossChainQuote())
    await expect(
      prepareSolanaIntent(fixture.workflow, transfer()),
    ).rejects.toThrow(InvalidSolanaTransactionArtifactError)
  })

  describe('with destination calls', () => {
    const call = {
      target: '0x00000000000000000000000000000000000000c1',
      value: 0n,
      data: '0xabcdef',
    } as const
    const wireCall = { to: call.target, value: 0n, data: call.data }
    const factoryOp = {
      to: '0x000000000000000000000000000000000000fac7',
      data: '0xfac7',
    } as const
    const delegationContract = `0x${'77'.repeat(20)}` as const
    const childRequest = eip712Request({
      chainId: baseSepoliaId,
      account: accountAddress,
    })
    const delegation = delegationRequest({
      chainId: baseSepoliaId,
      contract: delegationContract,
      account: accountAddress,
    })
    const childProof = {
      kind: 'eip712',
      signature: `0x${'11'.repeat(65)}`,
    } as const satisfies SigningProof
    const delegationProof = {
      kind: 'eip7702',
      nonce: 3,
      signature: { r: '0x12', s: '0x34', yParity: 1 },
    } as const satisfies SigningProof

    function executing(
      account: Partial<IntentAccountProjection> = {},
      execution: Partial<SolanaEvmExecution> = {},
    ): SolanaTransferInput {
      return transfer({
        accountAddress,
        accountType: 'ERC7579',
        delivery: {
          ...delivery,
          recipient: accountAddress,
          execution: {
            calls: [call],
            gasLimit: 200_000n,
            account: {
              kind: 'erc7579',
              address: accountAddress,
              setupOps: [],
              ...account,
            },
            ...execution,
          },
        },
      })
    }

    function executingQuote(
      signingRequests: readonly SigningRequest[] = [
        spendRequest(),
        childRequest,
      ],
    ): OrchestratorQuote {
      return crossChainQuote({ signingRequests: [...signingRequests] })
    }

    test('runs the calls on a deployed paired account, with no recipient beside it', () => {
      expect(buildSolanaIntentRequest(executing())).toEqual({
        request: {
          account: {
            evm: { type: 'erc7579', address: accountAddress, signatureMode: 1 },
            svm: {
              type: 'swig',
              address: wallet,
              authorization: { kind: 'secp256k1', address: owner.address },
            },
          },
          destination: {
            vm: 'evm',
            chainId: BASE_SEPOLIA,
            tokenRequests: [
              { tokenAddress: destinationToken, amount: 100_000n },
            ],
            execution: { calls: [wireCall], gasLimit: 200_000n },
          },
          source: {
            selection: {
              chains: { only: [DEVNET] },
              tokens: { only: [mint] },
              perChain: { [DEVNET]: { tokens: { only: [mint] } } },
            },
          },
        },
        normalized: {
          account: {
            address: accountAddress,
            accountType: 'ERC7579',
            setupOps: [],
          },
          destinationChainId: baseSepoliaId,
          destinationExecutions: [wireCall],
          destinationGasUnits: 200_000n,
          tokenRequests: [{ tokenAddress: destinationToken, amount: 100_000n }],
          accountAccessList: { chainTokens: { 792703810: [mint] } },
          options: { signatureMode: 1 },
        },
      })
    })

    test('sends an undeployed account’s setup ops with the calls', () => {
      const { request, normalized } = buildSolanaIntentRequest(
        executing({ setupOps: [factoryOp] }),
      )
      expect(request.account.evm).toEqual({
        type: 'erc7579',
        address: accountAddress,
        initData: { setupOps: [factoryOp] },
        signatureMode: 1,
      })
      expect(normalized.account).toEqual({
        address: accountAddress,
        accountType: 'ERC7579',
        setupOps: [factoryOp],
      })
    })

    test('names an EIP-7702 account’s delegation and answers its delegation request', async () => {
      const input = executing({
        setupOps: [{ to: accountAddress, data: '0x1234' }],
        delegationContract,
      })
      const { request, normalized } = buildSolanaIntentRequest(input)
      expect(request.account.evm).toEqual({
        type: 'erc7579',
        address: accountAddress,
        initData: { setupOps: [{ to: accountAddress, data: '0x1234' }] },
        signatureMode: 1,
        delegations: { default: { contract: delegationContract } },
      })
      expect(normalized.account.delegations).toEqual({
        0: { contract: delegationContract },
      })

      const fixture = context(
        executingQuote([spendRequest(), childRequest, delegation]),
      )
      const prepared = await prepareSolanaIntent(fixture.workflow, input)
      const signed = await signSolanaIntent({
        prepared,
        owner,
        signEvmRequests: async () => [childProof, delegationProof],
        now: fixture.workflow.now,
      })
      await submitSolanaIntent(fixture.workflow, signed)
      expect(fixture.submitIntent).toHaveBeenCalledWith(
        {
          intentId: 'solana-intent',
          proofs: [signed.proofs[0], childProof, delegationProof],
        },
        expect.anything(),
      )
    })

    test('refuses calls for an account with no EVM entry', () => {
      expect(() =>
        buildSolanaIntentRequest({
          ...executing(),
          accountAddress: wallet,
          accountType: undefined,
        }),
      ).toThrow(/need a paired EVM account/)
    })

    test.each([
      [
        'another recipient',
        transfer({
          accountAddress,
          accountType: 'ERC7579',
          delivery: {
            ...delivery,
            execution: {
              calls: [call],
              account: {
                kind: 'erc7579',
                address: accountAddress,
                setupOps: [],
              },
            },
          },
        }),
        /must also receive the delivery/,
      ],
      [
        'another account',
        executing({ address: destinationRecipient }),
        /must also receive the delivery/,
      ],
      ['no calls', executing({}, { calls: [] }), /at least one call/],
    ])('refuses an execution with %s', (_name, input, reason) => {
      expect(() => buildSolanaIntentRequest(input)).toThrow(reason)
    })

    test('signs the destination requests before the spend and submits them after it', async () => {
      const fixture = context(executingQuote())
      const prepared = await prepareSolanaIntent(fixture.workflow, executing())
      const order: string[] = []
      const signEvmRequests = vi.fn(async () => {
        order.push('evm')
        return [childProof]
      })
      const signMessage = vi.fn(
        async (input: Parameters<typeof owner.signMessage>[0]) => {
          order.push('spend')
          return owner.signMessage(input)
        },
      )
      const signed = await signSolanaIntent({
        prepared,
        owner: { ...owner, signMessage },
        signEvmRequests,
        now: fixture.workflow.now,
      })

      // The Swig payload's slot window is the one that runs out.
      expect(order).toEqual(['evm', 'spend'])
      expect(signEvmRequests).toHaveBeenCalledWith(
        [childRequest],
        baseSepoliaId,
      )
      expect(signed.proofs).toEqual([
        { kind: 'personalSign', signature: expect.any(String) },
        childProof,
      ])
      await expect(
        submitSolanaIntent(fixture.workflow, {
          prepared,
          proofs: [signed.proofs[0]],
        }),
      ).rejects.toThrow(/answer each EVM signing request/)
      await submitSolanaIntent(fixture.workflow, signed)
      expect(fixture.submitIntent).toHaveBeenCalledOnce()
      expect(fixture.submitIntent).toHaveBeenCalledWith(
        { intentId: 'solana-intent', proofs: signed.proofs },
        expect.anything(),
      )
    })

    test.each([
      ['no proof', []],
      [
        'a session pair',
        [
          {
            kind: 'eip712',
            signature: { preClaim: '0x12', notarizedClaim: '0x34' },
          },
        ],
      ],
      ['a delegation in the authorization slot', [delegationProof]],
    ])(
      'refuses %s for the destination request before the spend is signed',
      async (_name, proofs) => {
        const fixture = context(executingQuote())
        const prepared = await prepareSolanaIntent(
          fixture.workflow,
          executing(),
        )
        const signMessage = vi.fn(owner.signMessage)
        await expect(
          signSolanaIntent({
            prepared,
            owner: { ...owner, signMessage },
            signEvmRequests: async () => proofs as never,
            now: fixture.workflow.now,
          }),
        ).rejects.toThrow(/answer each EVM signing request/)
        expect(signMessage).not.toHaveBeenCalled()
      },
    )

    test('refuses to sign destination requests without the paired account', async () => {
      const fixture = context(executingQuote())
      const prepared = await prepareSolanaIntent(fixture.workflow, executing())
      await expect(
        signSolanaIntent({ prepared, owner, now: fixture.workflow.now }),
      ).rejects.toThrow(/paired EVM account to sign them/)
    })

    test.each([
      ['only the spend', [spendRequest()], /EIP-712 authorization/],
      [
        'a destination request on another chain',
        [
          spendRequest(),
          eip712Request({ chainId: 1, account: accountAddress }),
        ],
        /paired EVM account on the delivery chain/,
      ],
      [
        'a destination request for another account',
        [
          spendRequest(),
          eip712Request({
            chainId: baseSepoliaId,
            account: destinationRecipient,
          }),
        ],
        /paired EVM account on the delivery chain/,
      ],
      [
        'a delegation on another chain',
        [
          spendRequest(),
          childRequest,
          delegationRequest({
            chainId: 1,
            contract: delegationContract,
            account: accountAddress,
          }),
        ],
        /paired EVM account on the delivery chain/,
      ],
      [
        'a second Swig spend',
        [spendRequest(), childRequest, spendRequest()],
        /paired EVM account on the delivery chain/,
      ],
    ])('rejects a quote with %s', async (_name, signingRequests, reason) => {
      const fixture = context(executingQuote(signingRequests))
      await expect(
        prepareSolanaIntent(fixture.workflow, executing()),
      ).rejects.toThrow(reason)
    })

    test('rejects destination requests on a quote for a plain delivery', async () => {
      const fixture = context(executingQuote())
      await expect(
        prepareSolanaIntent(fixture.workflow, crossChainTransfer()),
      ).rejects.toThrow(/exactly one signing request/)
    })

    test('reconstructs from the canonical input and refuses changed calls', async () => {
      const fixture = context(executingQuote())
      const prepared = await prepareSolanaIntent(fixture.workflow, executing())
      const plain = {
        traceId: prepared.traceId,
        request: prepared.request,
        intentInput: JSON.parse(
          JSON.stringify(projectCompatibleIntentInput(prepared.normalized)),
        ),
        quote: prepared.quote,
        quotes: prepared.quotes,
      }
      expect(() =>
        reconstructSolanaIntent({ ...plain, transfer: executing() }),
      ).not.toThrow()
      expect(() =>
        reconstructSolanaIntent({
          ...plain,
          transfer: executing({}, { calls: [{ ...call, data: '0xabcdee' }] }),
        }),
      ).toThrow(/canonical intent input|persisted request/)
    })
  })
})

describe('same-chain Solana instruction execution', () => {
  const program = solanaAddress('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')
  const lookupTable = solanaAddress(
    'GAQFGfFMdW95AdrXoBsWmCoiqHiWfYCKYvvmkNAbDwZ4',
  )
  const instruction = {
    programId: program,
    accounts: [{ pubkey: wallet, isSigner: true, isWritable: true }],
    data: 'AQID',
  }

  function execution(
    overrides: Omit<Partial<SolanaTransferInput>, 'action'> = {},
    action: Partial<Extract<SolanaAction, { kind: 'instructions' }>> = {},
  ): SolanaTransferInput {
    const { action: _action, ...binding } = transfer()
    return {
      ...binding,
      action: { kind: 'instructions', instructions: [instruction], ...action },
      ...overrides,
    }
  }

  function svmExecution(request: OrchestratorIntentRequest) {
    const destination = request.destination
    if (destination.vm !== 'svm') {
      throw new Error('Expected an SVM destination')
    }
    return destination.execution
  }

  function instructionQuote(
    overrides: Partial<OrchestratorQuote> = {},
  ): OrchestratorQuote {
    const base = quote()
    return {
      ...base,
      cost: { ...base.cost, input: [], output: [] },
      ...overrides,
    }
  }

  test('builds a tokenless, recipientless request', () => {
    expect(
      buildSolanaIntentRequest(
        execution({}, { addressLookupTables: [lookupTable] }),
      ),
    ).toEqual({
      request: {
        account: {
          svm: {
            type: 'swig',
            address: wallet,
            swigAccount: swig,
            authorization: { kind: 'secp256k1', address: owner.address },
          },
        },
        destination: {
          vm: 'svm',
          chainId: DEVNET,
          tokenRequests: [],
          execution: {
            instructions: [instruction],
            addressLookupTables: [lookupTable],
          },
        },
        // The instructions move whatever they move, so the source stays open
        // on the cluster instead of acquiring a funding mint.
        source: { selection: { chains: { only: [DEVNET] }, tokens: 'all' } },
      },
      normalized: {
        account: { address: wallet },
        destinationChainId: 792703810,
        destinationExecutions: [],
        tokenRequests: [],
        destinationInstructions: [instruction],
        addressLookupTableAddresses: [lookupTable],
        accountAccessList: { chainIds: [792703810] },
        options: { signatureMode: 1 },
      },
    })
  })

  test('carries sponsorship on a tokenless execution', () => {
    const sponsorSettings = {
      gas: true,
      bridgeFees: false,
      swapFees: false,
      protocolFees: false,
    } as const
    const built = buildSolanaIntentRequest(execution({ sponsorSettings }))
    expect(built.request.options).toEqual({ sponsorship: sponsorSettings })
    expect(built.normalized.options).toMatchObject({ sponsorSettings })
  })

  test('omits the lookup tables when there are none', () => {
    const { request, normalized } = buildSolanaIntentRequest(execution())
    expect(svmExecution(request)).not.toHaveProperty('addressLookupTables')
    expect(request.destination).not.toHaveProperty('recipient')
    expect(normalized).not.toHaveProperty('addressLookupTableAddresses')
    expect(normalized).not.toHaveProperty('recipient')
  })

  test('normalizes web3.js instructions into the request', () => {
    const { request, normalized } = buildSolanaIntentRequest(
      execution(
        {},
        {
          instructions: [
            {
              programId: { toBase58: () => program },
              keys: [
                {
                  pubkey: { toBase58: () => wallet },
                  isSigner: true,
                  isWritable: false,
                },
              ],
              data: new Uint8Array([1, 2, 3]),
            },
          ] as never,
        },
      ),
    )
    const wire = [
      {
        programId: program,
        accounts: [{ pubkey: wallet, isSigner: true, isWritable: false }],
        data: 'AQID',
      },
    ]
    expect(svmExecution(request)).toMatchObject({ instructions: wire })
    expect(normalized.destinationInstructions).toEqual(wire)
  })

  test.each([
    ['no instructions', execution({}, { instructions: [] })],
    ['app fees on a tokenless spend', execution({ appFees: { feeBps: 10 } })],
    [
      'protocol fees on a tokenless spend',
      execution({ protocolFees: { feeBps: 10 } }),
    ],
    [
      'lookup tables that are not base58',
      execution({}, { addressLookupTables: ['not-base58'] }),
    ],
  ])('refuses %s before quoting', (_name, input) => {
    expect(() => buildSolanaIntentRequest(input)).toThrow(
      InvalidSolanaTransactionArtifactError,
    )
  })

  test('accepts a same-chain quote whose cost legs stay on the cluster', async () => {
    const fixture = context(instructionQuote())
    const prepared = await prepareSolanaIntent(fixture.workflow, execution())
    expect(prepared.request.destination.tokenRequests).toEqual([])
    expect(prepared.quote.intentId).toBe('solana-intent')
  })

  test('rejects a quote with a cost leg off the requested cluster', async () => {
    const offCluster = quote()
    const fixture = context(
      instructionQuote({
        cost: { ...offCluster.cost, input: offCluster.cost.input, output: [] },
      }),
    )
    await expect(
      prepareSolanaIntent(
        fixture.workflow,
        execution({ chain: solanaMainnet }),
      ),
    ).rejects.toThrow(InvalidSolanaTransactionArtifactError)
  })

  test('survives a JSON round trip and rejects an altered instruction', async () => {
    const fixture = context(instructionQuote())
    const input = execution()
    const prepared = await prepareSolanaIntent(fixture.workflow, input)
    const restored = JSON.parse(
      JSON.stringify({
        traceId: prepared.traceId,
        intentInput: projectCompatibleIntentInput(prepared.normalized),
      }),
    )
    expect(() =>
      reconstructSolanaIntent({
        traceId: restored.traceId,
        request: prepared.request,
        transfer: input,
        intentInput: restored.intentInput,
        quote: prepared.quote,
        quotes: prepared.quotes,
      }),
    ).not.toThrow()
    expect(() =>
      reconstructSolanaIntent({
        traceId: restored.traceId,
        request: prepared.request,
        transfer: execution(
          {},
          {
            instructions: [{ ...instruction, data: 'AQIE' }],
          },
        ),
        intentInput: restored.intentInput,
        quote: prepared.quote,
        quotes: prepared.quotes,
      }),
    ).toThrow(/canonical intent input|persisted request/)
  })

  test('surfaces the orchestrator refusal while no route serves instructions', async () => {
    const refusal = parseErrorEnvelope(
      {
        code: 'UNPROCESSABLE_CONTENT',
        message: 'No strategy can serve destinationInstructions',
        traceId: 'trace-instructions',
        details: [
          {
            message: 'No strategy can serve destinationInstructions',
            context: { code: 'UNSUPPORTED_DESTINATION_INSTRUCTIONS' },
          },
        ],
      },
      422,
    )
    const workflow = {
      quoteClient: {
        createQuote: vi.fn(async () => {
          throw refusal
        }),
      },
      submissionClient: { submitIntent: vi.fn() },
      now: () => 1_900_000_000_000,
    }
    await expect(
      prepareSolanaIntent(workflow as never, execution()),
    ).rejects.toBe(refusal)
  })
})

describe('passkey-owned managed Solana intents', () => {
  const { account: passkey, compressedPublicKey } = signingPasskey()
  const challenge = `0x${'a3'.repeat(32)}` as const
  const now = () => 1_900_000_000_000

  function passkeyTransfer(): SolanaTransferInput {
    return transfer({
      authority: { kind: 'secp256r1', publicKey: compressedPublicKey },
    })
  }

  function passkeyRequest(
    publicKey: Hex = compressedPublicKey,
    overrides: Partial<SigningRequest> = {},
  ): SigningRequest {
    return spendRequest({
      authority: {
        kind: 'swigRole',
        roleId: 1,
        authority: { kind: 'secp256r1', publicKey },
      },
      payload: { kind: 'webauthn', challenge },
      ...overrides,
    })
  }

  function passkeyQuote(request = passkeyRequest()): OrchestratorQuote {
    return quote({ signingRequests: [request] })
  }

  async function signedProof() {
    const fixture = context(passkeyQuote())
    const prepared = await prepareSolanaIntent(
      fixture.workflow,
      passkeyTransfer(),
    )
    const {
      proofs: [proof],
    } = await signSolanaIntent({ prepared, owner: passkey, now })
    return (proof as Extract<typeof proof, { kind: 'webauthn' }>).assertion
  }

  test('sends the compressed passkey key as the Swig authorization', () => {
    const { request } = buildSolanaIntentRequest(passkeyTransfer())
    expect(request.account.svm).toEqual({
      type: 'swig',
      address: wallet,
      swigAccount: swig,
      authorization: { kind: 'secp256r1', publicKey: compressedPublicKey },
    })
  })

  test('compresses a WebAuthn public key by the parity of y', () => {
    // Cross-checked against noble's own compression of the same key.
    expect(compressP256PublicKey(passkey.publicKey)).toBe(compressedPublicKey)
    expect(compressP256PublicKey(`0x04${passkey.publicKey.slice(2)}`)).toBe(
      compressedPublicKey,
    )
    expect(compressP256PublicKey(compressedPublicKey)).toBe(compressedPublicKey)
    const x = 'aa'.repeat(32)
    expect(compressP256PublicKey(`0x${x}${'00'.repeat(31)}02`)).toBe(`0x02${x}`)
    expect(compressP256PublicKey(`0x04${x}${'00'.repeat(31)}01`)).toBe(
      `0x03${x}`,
    )
  })

  test.each([
    ['a truncated key', `0x${'11'.repeat(63)}`],
    ['a 65-byte key without the 04 prefix', `0x05${'11'.repeat(64)}`],
    ['a 33-byte key without a compressed prefix', `0x04${'11'.repeat(32)}`],
  ] as const)('refuses %s', (_name, publicKey) => {
    expect(() => compressP256PublicKey(publicKey)).toThrow(
      InvalidSolanaTransactionArtifactError,
    )
  })

  test('accepts a WebAuthn quote naming the configured key in any case', async () => {
    const upper = `0x${compressedPublicKey.slice(2).toUpperCase()}` as Hex
    const prepared = await prepareSolanaIntent(
      context(passkeyQuote(passkeyRequest(upper))).workflow,
      passkeyTransfer(),
    )
    expect(prepared.quote.signingRequests[0]?.payload).toEqual({
      kind: 'webauthn',
      challenge,
    })
  })

  test.each([
    [
      'another passkey',
      passkeyQuote(
        passkeyRequest(
          signingPasskey({ privateKey: `0x${'22'.repeat(32)}` })
            .compressedPublicKey,
        ),
      ),
      /name the configured Solana authority/,
    ],
    [
      'a secp256k1 role',
      passkeyQuote(
        passkeyRequest(compressedPublicKey, {
          authority: {
            kind: 'swigRole',
            roleId: 1,
            authority: { kind: 'secp256k1', address: owner.address },
          },
        }),
      ),
      /name the configured Solana authority/,
    ],
    ['a personal-sign payload', quote(), /WebAuthn spend authorization/],
    [
      'a short challenge',
      passkeyQuote(
        passkeyRequest(compressedPublicKey, {
          payload: { kind: 'webauthn', challenge: '0xaa' },
        }),
      ),
      /32 bytes/,
    ],
  ])('refuses %s for a passkey owner', async (_name, candidate, matcher) => {
    await expect(
      prepareSolanaIntent(context(candidate).workflow, passkeyTransfer()),
    ).rejects.toThrow(matcher)
  })

  test('refuses a WebAuthn quote for an ECDSA owner', async () => {
    await expect(
      prepareSolanaIntent(context(passkeyQuote()).workflow, transfer()),
    ).rejects.toThrow(/UTF-8 personal-sign spend authorization/)
  })

  test('signs the challenge with the passkey and submits the pinned encodings', async () => {
    const fixture = context(passkeyQuote())
    const prepared = await prepareSolanaIntent(
      fixture.workflow,
      passkeyTransfer(),
    )
    const sign = vi.fn(passkey.sign)
    const signed = await signSolanaIntent({
      prepared,
      owner: { ...passkey, sign },
      now,
    })

    expect(sign).toHaveBeenCalledWith({ hash: challenge })
    expect(signed.proofs[0]).toEqual({
      kind: 'webauthn',
      assertion: {
        credentialId: 'AQIDBA',
        authenticatorData: concat([
          sha256(stringToBytes('app.example')),
          '0x0500000001',
        ]),
        // The raw text the authenticator returned, not base64 and not
        // re-serialized.
        clientDataJSON: JSON.stringify({
          type: 'webauthn.get',
          challenge: base64urlnopad.encode(hexToBytes(challenge)),
          origin: 'https://app.example',
          crossOrigin: false,
        }),
        // r‖s, not the DER the authenticator produced.
        signature: expect.stringMatching(/^0x[0-9a-f]{128}$/u),
      },
    })
    await submitSolanaIntent(fixture.workflow, signed)
    expect(fixture.submitIntent).toHaveBeenCalledWith(
      { intentId: 'solana-intent', proofs: signed.proofs },
      expect.anything(),
    )
  })

  test('refuses an assertion over a different challenge before submitting', async () => {
    const elsewhere = signingPasskey({
      signs: (requested) => requested.map((byte) => byte ^ 1),
    })
    const fixture = context(passkeyQuote())
    const prepared = await prepareSolanaIntent(
      fixture.workflow,
      passkeyTransfer(),
    )
    await expect(
      signSolanaIntent({ prepared, owner: elsewhere.account, now }),
    ).rejects.toThrow(/does not sign the requested challenge/)
    expect(fixture.submitIntent).not.toHaveBeenCalled()
  })

  test('refuses an ECDSA signer and a personal-sign proof for a passkey owner', async () => {
    const fixture = context(passkeyQuote())
    const prepared = await prepareSolanaIntent(
      fixture.workflow,
      passkeyTransfer(),
    )
    await expect(signSolanaIntent({ prepared, owner, now })).rejects.toThrow(
      /authority is a passkey/,
    )
    await expect(
      submitSolanaIntent(fixture.workflow, {
        prepared,
        proofs: [
          {
            kind: 'personalSign',
            signature: await owner.signMessage({ message }),
          },
        ],
      }),
    ).rejects.toThrow(/does not match the configured Solana authority/)
    expect(fixture.submitIntent).not.toHaveBeenCalled()
  })

  test('checks the assertion shape and leaves the signature to the orchestrator', async () => {
    const assertion = await signedProof()
    const check = (changes: Partial<WebAuthnAssertion>) => () =>
      validateSolanaWebAuthnAssertion(
        { challenge },
        { ...assertion, ...changes },
      )

    expect(check({})).not.toThrow()
    expect(check({ clientDataJSON: '{"type":' })).toThrow(
      InvalidSolanaTransactionArtifactError,
    )
    expect(check({ clientDataJSON: '{"type":' })).toThrow(/must be JSON/)
    expect(
      check({
        clientDataJSON: assertion.clientDataJSON.replace(
          'webauthn.get',
          'webauthn.create',
        ),
      }),
    ).toThrow(/webauthn\.get/)
    expect(
      check({
        clientDataJSON: JSON.stringify({
          ...JSON.parse(assertion.clientDataJSON),
          challenge: base64urlnopad.encode(hexToBytes(`0x${'00'.repeat(32)}`)),
        }),
      }),
    ).toThrow(/does not sign the requested challenge/)
    // DER is what the authenticator returns; the wire wants r‖s.
    expect(check({ signature: `0x30${'44'.repeat(70)}` })).toThrow(/64-byte/)
    // A well-formed but wrong signature passes: the orchestrator verifies it
    // before anything is recorded.
    expect(check({ signature: `0x${'11'.repeat(64)}` })).not.toThrow()
  })
})
