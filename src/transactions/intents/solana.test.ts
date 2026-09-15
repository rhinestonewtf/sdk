import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test, vi } from 'vitest'
import {
  solanaAddress,
  solanaDevnet,
  solanaMainnet,
} from '../../chains/non-evm'
import type { OrchestratorQuote } from '../../clients/orchestrator/types'
import {
  InvalidSolanaTransactionArtifactError,
  SolanaQuoteExpiredError,
} from '../../errors/execution'
import { projectCompatibleIntentInput } from './compatibility'
import {
  assertSolanaNotExpired,
  buildSolanaIntentRequest,
  prepareSolanaIntent,
  reconstructSolanaIntent,
  type SolanaTransferInput,
  signSolanaIntent,
  solanaChainId,
  submitSolanaIntent,
  validateSolanaSignature,
} from './solana'

const owner = privateKeyToAccount(`0x${'12'.repeat(32)}`)
const mint = solanaAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const recipient = solanaAddress('11111111111111111111111111111112')
const wallet = solanaAddress('DfBX7Po1bmnXt4GuEF3Eg5UYUHAjs9m5n8nbb9WUqgw2')
const swig = solanaAddress('9fTE4gQnweN345EGzy6jnXNFW8VryvZ8QwLZqgBubmMs')
const message = 'ab'.repeat(32)

const destinationToken = '0x036cbd53842c5426634e7929541ec2318f3dcf7e' as const
const destinationRecipient =
  '0xabc82222eaa155331bac89b87c20a584a8e05add' as const
const baseSepoliaId = 84532

function transfer(
  overrides: Partial<SolanaTransferInput> = {},
): SolanaTransferInput {
  return {
    chain: solanaDevnet,
    mint,
    amount: 100_000n,
    delivery: { kind: 'same-chain', recipient },
    accountAddress: '0x29b406a587dd2a8ba87b9431262ee4fe732f5f0b',
    accountType: 'ERC7579',
    authority: owner.address,
    walletAddress: wallet,
    swigAddress: swig,
    namespace: 'dev-v1',
    endpoint: 'https://dev.example',
    ...overrides,
  }
}

function quote(overrides: Partial<OrchestratorQuote> = {}): OrchestratorQuote {
  return {
    intentId: 'solana-intent',
    expiresAt: 2_000_000_000,
    estimatedFillTime: { seconds: 2 },
    settlementLayer: 'SAME_CHAIN',
    signData: {
      origin: [{ kind: 'personalSign', message, expiresAtSlot: '123456789' }],
    },
    cost: {
      input: [
        {
          chainId: 792703810,
          tokenAddress: mint,
          symbol: 'USDC',
          decimals: 6,
          price: { usd: 1 },
          amount: 100_100n,
        },
      ],
      output: [
        {
          chainId: 792703810,
          tokenAddress: mint,
          symbol: 'USDC',
          decimals: 6,
          price: { usd: 1 },
          amount: 100_000n,
        },
      ],
      fees: {
        total: { usd: 0.0001 },
        breakdown: {
          gas: { usd: 0.0001, sponsored: false },
          bridge: { usd: 0, sponsored: false },
          swap: { usd: 0, sponsored: false },
          app: { usd: 0, sponsored: false },
          protocol: { usd: 0, sponsored: false },
          sponsorSurcharge: { usd: 0, sponsored: false },
        },
      },
    },
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
  test('builds the narrow no-RPC quote and preserves backend costs', async () => {
    const fixture = context()
    const prepared = await prepareSolanaIntent(fixture.workflow, transfer())

    expect(fixture.createQuote).toHaveBeenCalledWith({
      account: {
        address: '0x29b406a587dd2a8ba87b9431262ee4fe732f5f0b',
        accountType: 'ERC7579',
      },
      destinationChainId: 792703810,
      destinationExecutions: [],
      tokenRequests: [{ tokenAddress: mint, amount: 100_000n }],
      recipient: { address: recipient },
      accountAccessList: { chainIds: [792703810] },
      options: { signatureMode: 1 },
    })
    expect(prepared.quote.cost.input[0]?.amount).toBe(100_100n)
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

    expect(signMessage).toHaveBeenCalledWith({ message })
    expect(signed.signature).toMatch(/^0x[0-9a-f]{130}$/u)
    const submitted = await submitSolanaIntent(fixture.workflow, signed)
    expect(fixture.submitIntent).toHaveBeenCalledWith(
      {
        intentId: 'solana-intent',
        signatures: { origin: [signed.signature] },
      },
      {
        intentInput: projectCompatibleIntentInput(prepared.request),
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
      quote({ settlementLayer: 'ACROSS', signData: { origin: [] } }),
    )
    await expect(
      prepareSolanaIntent(malformed.workflow, transfer()),
    ).rejects.toThrow(InvalidSolanaTransactionArtifactError)

    const valid = context()
    const fresh = await prepareSolanaIntent(valid.workflow, transfer())
    expect(() =>
      reconstructSolanaIntent({
        traceId: fresh.traceId,
        transfer: transfer(),
        intentInput: {
          ...projectCompatibleIntentInput(fresh.request),
          recipient: { address: wallet },
        },
        quote: fresh.quote,
        quotes: fresh.quotes,
      }),
    ).toThrow(/canonical intent input/)
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
    expect(
      buildSolanaIntentRequest(
        transfer({
          chain: solanaMainnet,
          amount: undefined,
          appFees: { feeBps: 1 },
          protocolFees: { feeBps: 2 },
        }),
      ),
    ).toMatchObject({
      destinationChainId: 792703809,
      tokenRequests: [{ tokenAddress: mint }],
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
    quote({ intentId: '' }),
    quote({ signData: { origin: [] } }),
    quote({
      signData: {
        origin: [
          { kind: 'personalSign', message: 'short', expiresAtSlot: '1' },
        ],
      },
    }),
    quote({
      signData: {
        origin: [
          { kind: 'personalSign', message, expiresAtSlot: 'not-a-slot' },
        ],
      },
    }),
    quote({
      signData: {
        origin: [{ kind: 'personalSign', message, expiresAtSlot: '1' }],
        destination: {
          domain: {},
          types: {},
          primaryType: 'Test',
          message: {},
        },
      },
    }),
    quote({ cost: { ...quote().cost, input: [] } }),
    quote({
      cost: {
        ...quote().cost,
        output: quote().cost.output.map((entry) => ({
          ...entry,
          chainId: 792703809,
        })),
      },
    }),
  ])('rejects incoherent quote %#', async (candidate) => {
    const fixture = context(candidate)
    await expect(
      prepareSolanaIntent(fixture.workflow, transfer()),
    ).rejects.toThrow(InvalidSolanaTransactionArtifactError)
  })

  test('rejects an empty quote response', async () => {
    const fixture = context()
    fixture.createQuote.mockResolvedValueOnce({ traceId: 'trace', routes: [] })
    await expect(
      prepareSolanaIntent(fixture.workflow, transfer()),
    ).rejects.toThrow(/returned no quote/)
  })

  test('reconstructs valid plain data and rejects missing or changed quotes', async () => {
    const fixture = context()
    const prepared = await prepareSolanaIntent(fixture.workflow, transfer())
    const plain = {
      traceId: prepared.traceId,
      transfer: transfer(),
      intentInput: projectCompatibleIntentInput(prepared.request),
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
  })

  test('rejects missing, malformed, unrecoverable, and wrong-authority signatures', async () => {
    const fixture = context()
    const prepared = await prepareSolanaIntent(fixture.workflow, transfer())
    await expect(
      signSolanaIntent({
        prepared,
        owner: { address: owner.address, type: 'local' } as never,
        now: fixture.workflow.now,
      }),
    ).rejects.toThrow(/cannot sign messages/)
    await expect(
      validateSolanaSignature(
        owner.address,
        prepared.quote.signData.origin[0] as never,
        '0x12',
      ),
    ).rejects.toThrow(/65-byte/)
    await expect(
      validateSolanaSignature(
        owner.address,
        prepared.quote.signData.origin[0] as never,
        `0x${'ff'.repeat(65)}`,
      ),
    ).rejects.toThrow(/not recoverable/)
    const other = privateKeyToAccount(`0x${'13'.repeat(32)}`)
    const signature = await owner.signMessage({ message })
    await expect(
      validateSolanaSignature(
        other.address,
        prepared.quote.signData.origin[0] as never,
        signature,
      ),
    ).rejects.toThrow(/configured Solana authority/)
  })

  test('rejects non-finite deadlines', () => {
    expect(() =>
      assertSolanaNotExpired(0, quote({ expiresAt: Number.NaN })),
    ).toThrow(SolanaQuoteExpiredError)
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
    overrides: Partial<SolanaTransferInput> = {},
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
        destinationChainId: baseSepoliaId,
      },
      cost: {
        ...base.cost,
        output: [
          {
            chainId: baseSepoliaId,
            // The orchestrator lowercases EVM token addresses.
            tokenAddress: destinationToken,
            symbol: 'USDC',
            decimals: 6,
            price: { usd: 1 },
            amount: 99_500n,
          },
        ],
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
      account: {
        address: '0x29b406a587dd2a8ba87b9431262ee4fe732f5f0b',
        accountType: 'ERC7579',
      },
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
    })
  })

  test('spends the whole balance when no delivery amount is given', () => {
    expect(
      buildSolanaIntentRequest(crossChainTransfer({ amount: undefined })),
    ).toMatchObject({
      tokenRequests: [{ tokenAddress: destinationToken }],
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
            {
              ...crossChainQuote().cost.output[0]!,
              tokenAddress: destinationToken.toUpperCase(),
            },
          ],
        },
      }),
    )
    await expect(
      prepareSolanaIntent(fixture.workflow, crossChainTransfer()),
    ).resolves.toBeDefined()
  })

  test.each([
    [
      'a same-chain settlement layer',
      crossChainQuote({ settlementLayer: 'SAME_CHAIN' }),
    ],
    [
      'a destination signature',
      crossChainQuote({
        signData: {
          origin: [{ kind: 'personalSign', message, expiresAtSlot: '1' }],
          destination: {
            domain: {},
            types: {},
            primaryType: 'Test',
            message: {},
          },
        },
      }),
    ],
    [
      'a target-execution signature',
      crossChainQuote({
        signData: {
          origin: [{ kind: 'personalSign', message, expiresAtSlot: '1' }],
          targetExecution: {
            domain: {},
            types: {},
            primaryType: 'Test',
            message: {},
          },
        },
      }),
    ],
    [
      'an input leg on the wrong chain',
      crossChainQuote({
        cost: {
          ...crossChainQuote().cost,
          input: [{ ...crossChainQuote().cost.input[0]!, chainId: 792703809 }],
        },
      }),
    ],
    [
      'an input leg naming another mint',
      crossChainQuote({
        cost: {
          ...crossChainQuote().cost,
          input: [
            {
              ...crossChainQuote().cost.input[0]!,
              tokenAddress: solanaAddress('11111111111111111111111111111112'),
            },
          ],
        },
      }),
    ],
    [
      'an output leg on the wrong chain',
      crossChainQuote({
        cost: {
          ...crossChainQuote().cost,
          output: [{ ...crossChainQuote().cost.output[0]!, chainId: 1 }],
        },
      }),
    ],
    [
      'an output leg naming another token',
      crossChainQuote({
        cost: {
          ...crossChainQuote().cost,
          output: [
            {
              ...crossChainQuote().cost.output[0]!,
              tokenAddress: '0x0000000000000000000000000000000000000001',
            },
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
})
