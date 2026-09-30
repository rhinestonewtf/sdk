import { p256 } from '@noble/curves/nist'
import { bytesToHex, type Hex, hexToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test, vi } from 'vitest'
import { authorityQuote } from '../../../test/utils/caucasus'
import { signingPasskey } from '../../../test/utils/passkeys'
import { solanaAddress, solanaDevnet } from '../../chains/non-evm'
import { projectCompatibleIntentInput } from '../../clients/orchestrator/normalized'
import type {
  SigningPayload,
  SolanaAuthorityDisclosure,
  SwigAuthority,
} from '../../clients/orchestrator/public'
import { projectSponsorshipApproval } from '../../clients/orchestrator/sponsorship-approval'
import type { OrchestratorExecutionQuote } from '../../clients/orchestrator/types'
import {
  InvalidSolanaTransactionArtifactError,
  SolanaQuoteExpiredError,
} from '../../errors/execution'
import {
  buildSolanaIntentRequest,
  prepareSolanaIntent,
  reconstructSolanaIntent,
  type SolanaAuthorityChangeInput,
  type SolanaTransferInput,
  signSolanaIntent,
  submitSolanaIntent,
} from './solana'

const owner = privateKeyToAccount(`0x${'12'.repeat(32)}`)
const wallet = solanaAddress('DfBX7Po1bmnXt4GuEF3Eg5UYUHAjs9m5n8nbb9WUqgw2')
const swig = solanaAddress('9fTE4gQnweN345EGzy6jnXNFW8VryvZ8QwLZqgBubmMs')
const mint = solanaAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const DEVNET_ID = 792703810
const message = 'ab'.repeat(32)
const challenge = `0x${'a3'.repeat(32)}` as const
const now = () => 1_900_000_000_000

// Computed by noble, not the code under test.
const added = bytesToHex(
  p256.getPublicKey(hexToBytes(`0x${'42'.repeat(32)}`), true),
) as Hex
const ecdsaOwner: SwigAuthority = { kind: 'secp256k1', address: owner.address }
const sponsorSettings = { gas: true, bridgeFees: false, swapFees: false }

const add: SolanaAuthorityChangeInput = {
  action: 'add',
  key: added,
  permission: 'allButManageAuthority',
}
const remove: SolanaAuthorityChangeInput = { action: 'remove', key: added }

function authorityInput(
  change: SolanaAuthorityChangeInput = add,
  overrides: Partial<SolanaTransferInput> = {},
): SolanaTransferInput {
  return {
    chain: solanaDevnet,
    action: { kind: 'authority', change },
    accountAddress: wallet,
    authority: ecdsaOwner,
    walletAddress: wallet,
    swigAddress: swig,
    namespace: 'dev-v1',
    endpoint: 'https://dev.example',
    sponsorSettings,
    ...overrides,
  }
}

function disclosureOf(
  change: SolanaAuthorityChangeInput,
  overrides: Partial<SolanaAuthorityDisclosure> = {},
): SolanaAuthorityDisclosure {
  return {
    action: change.action,
    key: { kind: 'secp256r1', publicKey: change.key },
    ...(change.permission ? { permission: change.permission } : {}),
    roleId: 2,
    rent: { amount: '325120', usd: 0.05 },
    ...overrides,
  }
}

const personalSign: SigningPayload = {
  kind: 'personalSign',
  message: { encoding: 'utf8', value: message },
}

function routeFor(
  change: SolanaAuthorityChangeInput = add,
  options: {
    readonly acting?: SwigAuthority
    readonly payload?: SigningPayload
    readonly disclosure?: SolanaAuthorityDisclosure
  } = {},
): OrchestratorExecutionQuote {
  return authorityQuote({
    chainId: DEVNET,
    wallet,
    swigAccount: swig,
    acting: options.acting ?? ecdsaOwner,
    disclosure: options.disclosure ?? disclosureOf(change),
    payload: options.payload ?? personalSign,
  })
}

function context(candidate = routeFor()) {
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
      now,
    },
  }
}

/** Replaces one path of a quote with a structured clone, so fixtures never alias. */
function mutate(
  change: (quote: any) => void,
  base = routeFor(),
): OrchestratorExecutionQuote {
  const copy = structuredClone(base)
  change(copy)
  return copy
}

describe('Swig authority change requests', () => {
  test.each([
    ['add', add],
    ['remove', remove],
  ] as const)(
    'builds the gas-sponsored %s request and its projection',
    (_name, change) => {
      const authority =
        change.action === 'add'
          ? {
              action: 'add',
              key: { kind: 'secp256r1', publicKey: added },
              permission: 'allButManageAuthority',
            }
          : { action: 'remove', key: { kind: 'secp256r1', publicKey: added } }
      const svm = {
        type: 'swig',
        address: wallet,
        swigAccount: swig,
        authorization: ecdsaOwner,
      }
      const { request, normalized } = buildSolanaIntentRequest(
        authorityInput(change),
      )
      expect(request).toStrictEqual({
        account: { svm },
        destination: {
          vm: 'svm',
          chainId: DEVNET,
          tokenRequests: [],
          execution: { authority },
        },
        source: { selection: { chains: { only: [DEVNET] }, tokens: 'all' } },
        options: { sponsorship: sponsorSettings },
      })
      expect(normalized).toStrictEqual({
        account: { address: wallet, svm },
        destinationChainId: DEVNET_ID,
        destinationExecutions: [],
        tokenRequests: [],
        destinationAuthority: authority,
        accountAccessList: { chainIds: [DEVNET_ID] },
        options: { sponsorSettings },
      })
      // The grant binds exactly what the orchestrator derives from the body.
      expect(projectSponsorshipApproval(request)).toStrictEqual(
        projectCompatibleIntentInput(normalized),
      )
    },
  )

  test('names a passkey owner by its compressed key', () => {
    const { compressedPublicKey } = signingPasskey()
    const acting: SwigAuthority = {
      kind: 'secp256r1',
      publicKey: compressedPublicKey,
    }
    const { request } = buildSolanaIntentRequest(
      authorityInput(add, { authority: acting }),
    )
    expect(request.account).toStrictEqual({
      svm: {
        type: 'swig',
        address: wallet,
        swigAccount: swig,
        authorization: acting,
      },
    })
  })

  test.each([
    ['app fees', authorityInput(add, { appFees: { feeBps: 10 } }), /fees/],
    [
      'protocol fees',
      authorityInput(add, { protocolFees: { feeBps: 10 } }),
      /fees/,
    ],
    [
      'no sponsorship',
      authorityInput(add, { sponsorSettings: undefined }),
      /gas-sponsored/,
    ],
    [
      'a wider sponsorship',
      authorityInput(add, {
        sponsorSettings: { gas: true, bridgeFees: true, swapFees: false },
      }),
      /gas-sponsored/,
    ],
    [
      'a paired EVM account',
      authorityInput(add, { accountType: 'ERC7579' }),
      /gas-sponsored/,
    ],
    [
      'an uncompressed key',
      authorityInput({ ...add, key: `0x04${'11'.repeat(64)}` }),
      /compressed passkey/,
    ],
    [
      'an upper-case key',
      authorityInput({ ...add, key: added.toUpperCase() as Hex }),
      /compressed passkey/,
    ],
    [
      'an add without a permission',
      authorityInput({ action: 'add', key: added }),
      /compressed passkey/,
    ],
    [
      'a remove with a permission',
      authorityInput({ ...remove, permission: 'all' }),
      /compressed passkey/,
    ],
  ] as const)('refuses %s', (_name, input, matcher) => {
    expect(() => buildSolanaIntentRequest(input)).toThrow(matcher)
  })
})

describe('Swig authority change quotes', () => {
  test('quotes as sponsored and accepts a well-formed route', async () => {
    const fixture = context()
    const prepared = await prepareSolanaIntent(
      fixture.workflow,
      authorityInput(),
    )
    expect(fixture.createQuote).toHaveBeenCalledWith(prepared.request, {
      intentInput: projectCompatibleIntentInput(prepared.normalized),
      sponsored: true,
    })
    expect(prepared.quote.intentId).toBe('authority-intent')
  })

  test('accepts a disclosure echoing the key in upper case', async () => {
    const upper = `0x${added.slice(2).toUpperCase()}` as Hex
    const disclosure = disclosureOf(add, {
      key: { kind: 'secp256r1', publicKey: upper },
    })
    await expect(
      prepareSolanaIntent(
        context(routeFor(add, { disclosure })).workflow,
        authorityInput(),
      ),
    ).resolves.toBeDefined()
  })

  const refusals: [string, OrchestratorExecutionQuote, RegExp][] = [
    [
      'a cross-chain layer',
      mutate((q) => {
        q.settlementLayer = 'RELAY'
      }),
      /SAME_CHAIN/,
    ],
    [
      'no signing request',
      mutate((q) => {
        q.signingRequests = []
      }),
      /exactly one signing request/,
    ],
    [
      'two signing requests',
      mutate((q) => {
        q.signingRequests = [q.signingRequests[0], q.signingRequests[0]]
      }),
      /exactly one signing request/,
    ],
    [
      'a spend scope',
      mutate((q) => {
        q.signingRequests[0].scope = {
          vm: 'svm',
          action: 'spend',
          accounts: [{ chainId: DEVNET, address: wallet }],
          instructions: [],
          addressLookupTables: [],
          feePayer: { kind: 'role', role: 'relayer' },
          slotWindow: { from: '100', to: '200' },
        }
      }),
      /authorize a Swig authority change/,
    ],
    [
      'another wallet',
      mutate((q) => {
        q.signingRequests[0].account.wallet = mint
      }),
      /configured Swig wallet and state account/,
    ],
    [
      'another scope account',
      mutate((q) => {
        q.signingRequests[0].scope.accounts = [
          { chainId: DEVNET, address: wallet },
        ]
      }),
      /Swig state account on the requested cluster/,
    ],
    [
      'another cluster',
      mutate((q) => {
        q.signingRequests[0].scope.accounts = [
          {
            chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
            address: swig,
          },
        ]
      }),
      /Swig state account on the requested cluster/,
    ],
    [
      'another acting authority',
      mutate((q) => {
        q.signingRequests[0].authority.authority = {
          kind: 'secp256k1',
          address: '0x0000000000000000000000000000000000000001',
        }
      }),
      /configured Solana authority/,
    ],
    [
      'a bare authority instead of a Swig role',
      mutate((q) => {
        q.signingRequests[0].authority = ecdsaOwner
      }),
      /origin authorization by a Swig role/,
    ],
    [
      'a destination purpose',
      mutate((q) => {
        q.signingRequests[0].purpose = 'destinationAuthorization'
      }),
      /origin authorization by a Swig role/,
    ],
    [
      'a negative acting role',
      mutate((q) => {
        q.signingRequests[0].authority.roleId = -1
      }),
      /origin authorization by a Swig role/,
    ],
    [
      'another action',
      mutate((q) => {
        q.signingRequests[0].scope.authority.action = 'remove'
      }),
      /disclose the requested authority change/,
    ],
    [
      'another key',
      mutate((q) => {
        q.signingRequests[0].scope.authority.key.publicKey = `0x02${'11'.repeat(32)}`
      }),
      /disclose the requested authority change/,
    ],
    [
      'another permission',
      mutate((q) => {
        q.signingRequests[0].scope.authority.permission = 'all'
      }),
      /disclose the requested authority change/,
    ],
    [
      'no permission on an add',
      mutate((q) => {
        delete q.signingRequests[0].scope.authority.permission
      }),
      /disclose the requested authority change/,
    ],
    [
      'no role id',
      mutate((q) => {
        delete q.signingRequests[0].scope.authority.roleId
      }),
      /disclose the requested authority change/,
    ],
    [
      'a negative role id',
      mutate((q) => {
        q.signingRequests[0].scope.authority.roleId = -1
      }),
      /disclose the requested authority change/,
    ],
    [
      'a non-decimal rent',
      mutate((q) => {
        q.signingRequests[0].scope.authority.rent.amount = '0x10'
      }),
      /disclose the requested authority change/,
    ],
    [
      'a plan disclosure differing from the scope',
      mutate((q) => {
        q.plan.destination.execution.authority.roleId = 3
      }),
      /disclose the signed authority change/,
    ],
    [
      'another executor',
      mutate((q) => {
        q.plan.destination.execution.executedBy.address = wallet
      }),
      /run by the Swig state account/,
    ],
    [
      'a solver executor',
      mutate((q) => {
        q.plan.destination.execution.executedBy.kind = 'solver'
      }),
      /run by the Swig state account/,
    ],
    [
      'a plan on another wallet',
      mutate((q) => {
        q.plan.destination.account.wallet = mint
      }),
      /name the configured Swig wallet, state account and authority/,
    ],
    [
      'a plan naming another acting authority',
      mutate((q) => {
        q.plan.destination.account.authority = {
          kind: 'secp256k1',
          address: '0x0000000000000000000000000000000000000001',
        }
      }),
      /name the configured Swig wallet, state account and authority/,
    ],
    [
      'a plan on another cluster',
      mutate((q) => {
        q.plan.destination.chainId = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
      }),
      /name the configured Swig wallet, state account and authority/,
    ],
    [
      'a source block',
      mutate((q) => {
        q.plan.source = [q.plan.destination]
      }),
      /source, deploy, require and move nothing/,
    ],
    [
      'a deployment',
      mutate((q) => {
        q.plan.deployments = [q.plan.destination]
      }),
      /source, deploy, require and move nothing/,
    ],
    [
      'a requirement',
      mutate((q) => {
        q.requirements = [{ kind: 'wrapNative' }]
      }),
      /source, deploy, require and move nothing/,
    ],
    [
      'an input cost',
      mutate((q) => {
        q.cost.input = [
          {
            chainId: DEVNET,
            tokenAddress: mint,
            symbol: null,
            decimals: null,
            price: null,
            amount: 1n,
          },
        ]
      }),
      /source, deploy, require and move nothing/,
    ],
    [
      'an output cost',
      mutate((q) => {
        q.cost.output = [
          {
            chainId: DEVNET,
            tokenAddress: mint,
            symbol: null,
            decimals: null,
            price: null,
            amount: 1n,
          },
        ]
      }),
      /source, deploy, require and move nothing/,
    ],
    [
      'a bridge fill',
      mutate((q) => {
        q.bridgeFill = {
          type: 'RELAY',
          requestId: 'r',
          destinationChainId: DEVNET,
          fillStatusTimeout: 1,
        }
      }),
      /source, deploy, require and move nothing/,
    ],
  ]

  test.each(refusals)('refuses %s', async (_name, candidate, matcher) => {
    const refusal = prepareSolanaIntent(
      context(candidate).workflow,
      authorityInput(),
    )
    await expect(refusal).rejects.toBeInstanceOf(
      InvalidSolanaTransactionArtifactError,
    )
    await expect(refusal).rejects.toThrow(matcher)
  })

  test('refuses a permission on a removal disclosure', async () => {
    const disclosure = disclosureOf(remove, { permission: 'all' })
    await expect(
      prepareSolanaIntent(
        context(routeFor(remove, { disclosure })).workflow,
        authorityInput(remove),
      ),
    ).rejects.toThrow(/disclose the requested authority change/)
  })

  test('refuses an authority route for a spend', async () => {
    const spend: SolanaTransferInput = {
      ...authorityInput(),
      sponsorSettings: undefined,
      action: {
        kind: 'transfer',
        mint,
        amount: 1n,
        delivery: {
          kind: 'same-chain',
          recipient: solanaAddress('11111111111111111111111111111112'),
        },
      },
    }
    await expect(
      prepareSolanaIntent(context().workflow, spend),
    ).rejects.toThrow(/authorize a Solana spend/)
  })

  test('checks every route, not only the best', async () => {
    const fixture = context()
    fixture.createQuote.mockResolvedValueOnce({
      traceId: 'quote-trace',
      routes: [
        routeFor(),
        mutate((q) => {
          q.intentId = 'second'
          q.plan.destination.execution.authority.roleId = 9
        }),
      ],
    })
    await expect(
      prepareSolanaIntent(fixture.workflow, authorityInput()),
    ).rejects.toThrow(/disclose the signed authority change/)
  })
})

describe('Swig authority change binding', () => {
  async function prepared() {
    return prepareSolanaIntent(context().workflow, authorityInput())
  }

  function reconstructInput(
    value: Awaited<ReturnType<typeof prepared>>,
    overrides: Partial<Parameters<typeof reconstructSolanaIntent>[0]> = {},
  ) {
    return {
      traceId: value.traceId,
      transfer: value.input,
      request: value.request,
      intentInput: projectCompatibleIntentInput(value.normalized),
      quote: value.quote,
      quotes: value.quotes,
      ...overrides,
    }
  }

  test('reconstructs the same intent', async () => {
    const value = await prepared()
    expect(reconstructSolanaIntent(reconstructInput(value)).quote).toEqual(
      value.quote,
    )
  })

  test.each([
    [
      'another key',
      { ...add, key: `0x02${'11'.repeat(32)}` as Hex },
      /persisted request/,
    ],
    [
      'another permission',
      { ...add, permission: 'all' as const },
      /persisted request/,
    ],
    ['another action', remove, /persisted request/],
  ])('refuses a transaction with %s', async (_name, change, matcher) => {
    const value = await prepared()
    expect(() =>
      reconstructSolanaIntent(
        reconstructInput(value, { transfer: authorityInput(change) }),
      ),
    ).toThrow(matcher)
  })

  test('refuses a tampered intent input', async () => {
    const value = await prepared()
    const intentInput = structuredClone(
      projectCompatibleIntentInput(value.normalized),
    ) as Record<string, any>
    intentInput.destinationAuthority.permission = 'all'
    expect(() =>
      reconstructSolanaIntent(
        reconstructInput(value, { intentInput: intentInput as never }),
      ),
    ).toThrow(/canonical intent input/)
  })

  test('refuses a tampered quote', async () => {
    const value = await prepared()
    const quote = mutate((q) => {
      q.signingRequests[0].scope.authority.roleId = 7
    }, value.quote)
    expect(() =>
      reconstructSolanaIntent(reconstructInput(value, { quote })),
    ).toThrow(/differs from the prepared quote set/)
  })
})

describe('signing and submitting a Swig authority change', () => {
  test('an ECDSA owner signs once and submits one proof', async () => {
    const fixture = context()
    const prepared = await prepareSolanaIntent(
      fixture.workflow,
      authorityInput(),
    )
    const signMessage = vi.fn(owner.signMessage)
    const signed = await signSolanaIntent({
      prepared,
      owner: { ...owner, signMessage },
      now,
    })
    expect(signMessage).toHaveBeenCalledOnce()
    expect(signMessage).toHaveBeenCalledWith({ message })
    expect(signed.proofs).toHaveLength(1)
    expect(signed.proofs[0].kind).toBe('personalSign')
    const result = await submitSolanaIntent(fixture.workflow, signed)
    expect(fixture.submitIntent).toHaveBeenCalledWith({
      intentId: 'authority-intent',
      proofs: signed.proofs,
    })
    expect(result).toEqual({
      type: 'intent',
      traceId: 'submit-trace',
      intentId: 'authority-intent',
      sourceChains: [DEVNET_ID],
      targetChain: DEVNET_ID,
    })
  })

  describe('with a passkey owner', () => {
    const { account: passkey, compressedPublicKey } = signingPasskey()
    const acting: SwigAuthority = {
      kind: 'secp256r1',
      publicKey: compressedPublicKey,
    }
    const webauthn: SigningPayload = { kind: 'webauthn', challenge }

    function passkeyInput() {
      return authorityInput(remove, { authority: acting })
    }

    function passkeyRoute() {
      return routeFor(remove, { acting, payload: webauthn })
    }

    test('prompts once for the scope challenge and submits the assertion', async () => {
      const fixture = context(passkeyRoute())
      const prepared = await prepareSolanaIntent(
        fixture.workflow,
        passkeyInput(),
      )
      const sign = vi.fn(passkey.sign)
      const signed = await signSolanaIntent({
        prepared,
        owner: { ...passkey, sign },
        now,
      })
      expect(sign).toHaveBeenCalledOnce()
      expect(sign).toHaveBeenCalledWith({ hash: challenge })
      expect(signed.proofs).toHaveLength(1)
      expect(signed.proofs[0].kind).toBe('webauthn')
      await submitSolanaIntent(fixture.workflow, signed)
      expect(fixture.submitIntent).toHaveBeenCalledOnce()
    })

    test('propagates a rejected prompt and submits nothing', async () => {
      const fixture = context(passkeyRoute())
      const prepared = await prepareSolanaIntent(
        fixture.workflow,
        passkeyInput(),
      )
      const rejection = Object.assign(new Error('The operation was denied'), {
        name: 'NotAllowedError',
      })
      await expect(
        signSolanaIntent({
          prepared,
          owner: {
            ...passkey,
            sign: async () => {
              throw rejection
            },
          },
          now,
        }),
      ).rejects.toBe(rejection)
      expect(fixture.submitIntent).not.toHaveBeenCalled()
    })

    test('refuses a personal-sign payload for a passkey owner', async () => {
      await expect(
        prepareSolanaIntent(
          context(routeFor(remove, { acting })).workflow,
          passkeyInput(),
        ),
      ).rejects.toThrow(/WebAuthn authority change authorization/)
    })

    test('refuses a WebAuthn payload for an ECDSA owner', async () => {
      await expect(
        prepareSolanaIntent(
          context(routeFor(remove, { payload: webauthn })).workflow,
          authorityInput(remove),
        ),
      ).rejects.toThrow(/UTF-8 personal-sign authority change authorization/)
    })
  })

  test('refuses an expired quote before prompting and before submitting', async () => {
    const fixture = context()
    const prepared = await prepareSolanaIntent(
      fixture.workflow,
      authorityInput(),
    )
    const signMessage = vi.fn(owner.signMessage)
    await expect(
      signSolanaIntent({
        prepared,
        owner: { ...owner, signMessage },
        now: () => 2_000_000_000_000,
      }),
    ).rejects.toBeInstanceOf(SolanaQuoteExpiredError)
    expect(signMessage).not.toHaveBeenCalled()

    const signed = await signSolanaIntent({ prepared, owner, now })
    await expect(
      submitSolanaIntent(
        { ...fixture.workflow, now: () => 2_000_000_000_000 },
        signed,
      ),
    ).rejects.toBeInstanceOf(SolanaQuoteExpiredError)
    expect(fixture.submitIntent).not.toHaveBeenCalled()
  })
})
