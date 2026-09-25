import type { Hex, TypedDataDefinition } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, mainnet } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { passkeyAccount } from '../../../test/consts'
import {
  quote as caucasusQuote,
  delegationRequest,
  eip712Request,
} from '../../../test/utils/caucasus'
import type {
  AccountAdapter,
  AccountRuntime,
  AccountRuntimePort,
  AccountSignatureEnvelopeInput,
} from '../../accounts/adapter'
import { wrapKernelMessageHash } from '../../accounts/kernel-signing'
import type { AccountConstruction } from '../../accounts/types'
import { parseCaip2, toEvmChainReference } from '../../chains/caip2'
import { projectCompatibleIntentInput } from '../../clients/orchestrator/normalized'
import type { SigningProof } from '../../clients/orchestrator/public'
import type {
  OrchestratorExecutionQuote,
  OrchestratorIntentRequest,
} from '../../clients/orchestrator/types'
import { defineValidator } from '../../modules/validators/definition'
import {
  buildQuorumMerkleTree,
  getQuorumMerkleRootSignableHash,
  getQuorumSignableHash,
} from '../../modules/validators/quorum'
import { toSession } from '../../modules/validators/smart-sessions/resolve'
import { createAccountSigningContext } from '../../signing/context'
import type {
  IntentSigningInput,
  IntentSigningRequest,
} from '../../signing/intent-plans/types'
import { buildIntentSigningInput, prepareIntent } from './prepare'
import { sendIntent } from './send'
import { buildSessionIntentPlanInput } from './session-signing'
import {
  assembleIntent,
  signIntent,
  signIntentAsOwner,
} from './sign-transaction'
import { submitIntent } from './submit'
import type { IntentInput, IntentWorkflowContext } from './types'

const chain = toEvmChainReference(1)
const account = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000001',
)
const secondAccount = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000002',
)
const address = '0x0000000000000000000000000000000000000010' as const
const signature = `0x${'11'.repeat(64)}1b` as const
const passkeyResult = {
  signature: `0x${'33'.repeat(64)}` as const,
  webauthn: {
    authenticatorData: '0x1234' as const,
    clientDataJSON: '{"type":"webauthn.get","challenge":"value"}',
    challengeIndex: 0,
    typeIndex: 0,
    userVerificationRequired: false,
  },
}
const testPasskey = {
  ...passkeyAccount,
  sign: vi.fn(async () => passkeyResult),
  signTypedData: vi.fn(async () => passkeyResult),
} as unknown as WebAuthnAccount

// Numeric fields arrive as JSON strings and are normalized to bigints before
// hashing, so anything reaching `hashTypedData` directly has to pass bigints.
function intentTypedData(
  chainId: number,
  value: string | bigint = '1',
): TypedDataDefinition {
  return {
    domain: { chainId, verifyingContract: address },
    types: { Test: [{ name: 'value', type: 'uint256' }] },
    primaryType: 'Test',
    message: { value },
  } as unknown as TypedDataDefinition
}

function originRequest(chainId = 1, value: string | bigint = '1') {
  return eip712Request({ chainId, typedData: intentTypedData(chainId, value) })
}

// A same-chain intent authorises the claim and the fill with the same payload,
// which is how the destination slot comes to reuse the origin signature.
function destinationRequest(chainId = 1, value: string | bigint = '1') {
  return eip712Request({
    chainId,
    purpose: 'destinationAuthorization',
    typedData: intentTypedData(chainId, value),
  })
}

function quote(
  overrides: Parameters<typeof caucasusQuote>[0] = {},
): OrchestratorExecutionQuote {
  return caucasusQuote({
    signingRequests: [originRequest(), destinationRequest()],
    ...overrides,
  })
}

function eip712Slot(
  signing: IntentSigningInput,
  index: number,
): Extract<IntentSigningRequest, { kind: 'eip712' }> {
  const request = signing.requests[index]
  if (request?.kind !== 'eip712') {
    throw new Error(`Signing request ${index} is not an EIP-712 request`)
  }
  return request
}

function hexProof(proof: SigningProof | undefined): Hex {
  if (proof?.kind !== 'eip712' || typeof proof.signature !== 'string') {
    throw new Error('Expected a single EIP-712 signature')
  }
  return proof.signature
}

function claimPairProof(proof: SigningProof | undefined) {
  if (proof?.kind !== 'eip712' || typeof proof.signature === 'string') {
    throw new Error('Expected a Smart Session claim pair')
  }
  return proof.signature
}

function smartAccount(request: OrchestratorIntentRequest) {
  const evm = request.account.evm
  if (evm?.type !== 'erc7579') {
    throw new Error('Expected an ERC-7579 account on the request')
  }
  return evm
}

function runtime(): AccountRuntime {
  const construction: AccountConstruction = {
    account: {
      kind: 'nexus',
      version: { source: 'explicit', value: '1.2.0' },
      salt: { source: 'explicit', value: '0x' },
    },
    owner: defineValidator({ type: 'ecdsa', accounts: [account] }),
    modules: [],
    setup: { validators: [], executors: [], hooks: [], fallbacks: [] },
    sessions: { enabled: false, environment: 'production' },
    chain,
    deployed: false,
  }
  const adapter = {
    account: construction.account,
    capabilities: {
      modular: true,
      supportsDeployment: true,
      supportsUserOperations: true,
      supportsEip7702Adoption: false,
      supportsSmartSessions: true,
      supportsOriginSignatureReuse: true,
      signatureEnvelope: { kind: 'none' },
    },
    getIdentity: () => ({ definition: construction.account, address }),
    getDeploymentPlan: () => ({
      chain,
      address,
      factory: address,
      factoryData: '0x1234',
      deployed: false,
    }),
    encodeSignatureEnvelope: ({
      validatorContribution,
    }: AccountSignatureEnvelopeInput) => validatorContribution,
  } as unknown as AccountAdapter
  return {
    adapter,
    construction,
    identity: { definition: construction.account, address },
  }
}

function context(
  overrides: Partial<IntentWorkflowContext<{ marker: boolean }>> = {},
): IntentWorkflowContext<{ marker: boolean }> {
  const accountRuntime: AccountRuntimePort = {
    forChain: vi.fn(async () => runtime()),
  }
  return {
    compatibilityConfig: { marker: true },
    account: accountRuntime,
    quoteClient: {
      createQuote: vi.fn(async () => ({
        traceId: 'trace-1',
        routes: [quote()],
      })),
    },
    submissionClient: {
      submitIntent: vi.fn(async () => ({
        traceId: 'trace-2',
        intentId: 'intent-1',
      })),
    },
    statusClient: { getIntentStatus: vi.fn() },
    signerInvoker: {
      has: () => true,
      invoke: vi.fn(async () => ({
        kind: 'ecdsa-signature' as const,
        signature,
      })),
    },
    checkpoints: { read: vi.fn(async () => []) },
    signAuthorizations: vi.fn(async () => []),
    signDelegation: vi.fn(
      async () =>
        ({
          address,
          chainId: 1,
          nonce: 0,
          r: `0x${'22'.repeat(32)}`,
          s: `0x${'33'.repeat(32)}`,
          yParity: 0,
        }) as const,
    ),
    clock: {
      now: () => 0,
      sleep: vi.fn(async () => undefined),
    },
    ...overrides,
  } satisfies IntentWorkflowContext<{ marker: boolean }>
}

const input = {
  destination: chain,
  sourceChains: [chain],
  calls: [{ target: address, value: 1n, data: '0x' as const }],
  tokenRequests: [],
}

describe('intent workflow', () => {
  test('prepares calls, deployment data, request, and signing payloads', async () => {
    const lazy = vi.fn(async ({ config }: { config: { marker: boolean } }) => {
      expect(config.marker).toBe(true)
      return { target: address, value: 2n, data: '0x12' as const }
    })
    const workflow = context()

    const prepared = await prepareIntent(workflow, {
      ...input,
      calls: [{ resolve: lazy }],
      sourceCalls: {
        1: [
          {
            call: { target: address, value: 3n, data: '0x34' },
            provides: [{ token: address, amount: 4n }],
          },
        ],
      },
    })

    expect(lazy).toHaveBeenCalledOnce()
    expect(prepared.request).toMatchObject({
      account: {
        evm: {
          type: 'erc7579',
          address,
          initData: { setupOps: [{ to: address, data: '0x1234' }] },
        },
      },
      destination: {
        chainId: 'eip155:1',
        execution: { calls: [{ to: address, value: 2n, data: '0x12' }] },
      },
      source: {
        executions: [
          {
            chainId: 'eip155:1',
            calls: [{ to: address, value: 3n, data: '0x34' }],
          },
        ],
        auxiliaryFunds: { 'eip155:1': { [address]: 4n } },
      },
    })
    // The sponsorship projection keeps its own spelling and its numeric chain
    // ids, so a sponsorship digest survives the wire migration.
    expect(prepared.normalized).toMatchObject({
      account: { address, setupOps: [{ to: address, data: '0x1234' }] },
      destinationExecutions: [{ to: address, value: 2n, data: '0x12' }],
      preClaimExecutions: {
        1: [{ to: address, value: 3n, data: '0x34' }],
      },
      options: { auxiliaryFunds: { 1: { [address]: 4n } } },
    })
    expect(eip712Slot(prepared.signing, 0).payload.typedData.message).toEqual({
      value: 1n,
    })
  })

  // HyperCore is EVM-ADDRESSED but virtual: no RPC, no accounts. Selecting it as
  // the account chain asks viem for a transport that cannot exist. It went
  // unnoticed while HyperCore was chain 1337, because viem ships a `Localhost`
  // chain with that id and quietly supplied `http://127.0.0.1:8545`; the venue
  // ids have no viem chain, so the synthesised one has empty `rpcUrls` and the
  // call dies with `UrlRequiredError` (RHI-5510).
  test('hosts the account on a source chain for a HyperCore venue', async () => {
    for (const venueId of [1337001, 1337002]) {
      const workflow = context()
      await prepareIntent(workflow, {
        ...input,
        destination: toEvmChainReference(venueId),
        // HyperCore delivery is solver-mediated; the orchestrator builds the
        // core-deposit ops, so a caller passes none.
        calls: [],
      })

      // The SOURCE chain, never the venue.
      expect(workflow.account.forChain).toHaveBeenCalledWith(chain)
      expect(workflow.account.forChain).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: venueId }),
      )
    }
  })

  // The session path repeats the same `kind === 'evm'` conflation, and an EOA
  // end-to-end run does not exercise it: `sessionChains` would demand a smart
  // session on 1337001/1337002, which can never exist — no account is deployed on
  // a virtual chain, and HyperCore delivery is solver-mediated so there is no
  // destination-side authorization for a session to grant (RHI-5510).
  test('requires no session on a HyperCore venue', async () => {
    const session = toSession({
      chain: mainnet,
      owners: { type: 'ecdsa', accounts: [account] },
    })
    const read = vi.fn(async (checkpoint: { id: string }) => [
      { kind: 'session-enabled' as const, id: checkpoint.id, enabled: false },
    ])
    const workflow = context({ checkpoints: { read } })

    // Only chain 1 (the source) has a session configured. Without the fix this
    // throws `No session configured for chain 1337001`.
    const prepared = await prepareIntent(workflow, {
      ...input,
      destination: toEvmChainReference(1337001),
      calls: [],
      signers: {
        kind: 'smart-session',
        byChain: {
          1: {
            session,
            enableData: {
              userSignature: signature,
              hashesAndChainIds: [
                { chainId: 1n, sessionDigest: `0x${'22'.repeat(32)}` },
              ],
              sessionToEnableIndex: 0,
            },
          },
        },
      },
    })

    const mockSignatures = smartAccount(prepared.request).simulation
      ?.mockSignaturesByChain
    expect(mockSignatures?.['eip155:1']).toMatch(/^0x/u)
    expect(mockSignatures?.['eip155:1337001']).toBeUndefined()
  })

  // EVM → Solana delivery: the destination hosts no account runtime and takes
  // no executions, so preparation runs the EVM cross-chain path end to end with
  // the account hosted on a source chain.
  describe('Solana destination delivery', () => {
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const recipient = 'EEnKdeMRGrhKq1Z2rkRubkrkTxCZigLZ5QgUYqAMvPnU'
    const delivery = {
      destination: parseCaip2('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
      sourceChains: [toEvmChainReference(base.id), chain],
      calls: [],
      tokenRequests: [{ token: mint, amount: 50_000n }],
      recipient: { kind: 'bare', address: recipient },
    } satisfies IntentInput<{ marker: boolean }>

    test('hosts the account on the last EVM source and requests no destination execution', async () => {
      const workflow = context()

      const prepared = await prepareIntent(workflow, delivery)

      expect(workflow.account.forChain).toHaveBeenCalledWith(chain)
      expect(prepared.accountChain).toEqual(chain)
      // Base58 is case-sensitive; a normalized mint or recipient delivers
      // somewhere else entirely.
      expect(prepared.request.destination).toEqual({
        vm: 'svm',
        chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        recipient: { address: recipient },
        tokenRequests: [{ tokenAddress: mint, amount: 50_000n }],
      })
      expect(prepared.normalized).toMatchObject({
        destinationChainId: 792703809,
        destinationExecutions: [],
        tokenRequests: [{ tokenAddress: mint, amount: 50_000n }],
        recipient: { address: recipient },
      })
    })

    test('signs the destination by reusing the last origin signature', async () => {
      const prepared = await prepareIntent(context(), delivery)

      const origin = eip712Slot(prepared.signing, 0)
      expect(origin.purpose).toBe('originAuthorization')
      expect(origin.payload.chain).toEqual(chain)
      expect(origin.reuse).toBeUndefined()
      // No EVM destination chain means no separate destination payload to sign:
      // the slot is still its own authorization, satisfied by the origin's bytes.
      const destination = eip712Slot(prepared.signing, 1)
      expect(destination.purpose).toBe('destinationAuthorization')
      expect(destination.reuse).toEqual({
        artifactId: origin.artifactId,
        selection: 'whole',
      })
      expect(
        prepared.signing.requests.some(
          ({ purpose }) => purpose === 'targetExecutionAuthorization',
        ),
      ).toBe(false)
    })

    test('rejects destination calls before quoting', async () => {
      const workflow = context()

      await expect(
        prepareIntent(workflow, {
          ...delivery,
          calls: [{ target: address, value: 1n, data: '0x' }],
        }),
      ).rejects.toThrow(
        'Destination calls are not supported for solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      )
      expect(workflow.quoteClient.createQuote).not.toHaveBeenCalled()
    })

    test('requires an EVM source chain to host the account', async () => {
      await expect(
        prepareIntent(context(), { ...delivery, sourceChains: [] }),
      ).rejects.toThrow(/requires at least one EVM source chain/u)
    })
  })

  test('signs through the shared plan executor', async () => {
    const workflow = context()
    const prepared = await prepareIntent(workflow, input)
    const signed = await signIntent(workflow, prepared)

    // One proof per signing request, in the quoted order; the destination slot
    // is satisfied by the origin's signature rather than signed again.
    expect(signed.proofs).toHaveLength(2)
    expect(eip712Slot(prepared.signing, 1).reuse).toEqual({
      artifactId: 'request-0',
      selection: 'whole',
    })
    expect(signed.proofs[1]).toEqual(signed.proofs[0])
    expect(signed.transcript.planKind).toBe('intent-full')
    expect(workflow.signerInvoker.invoke).toHaveBeenCalledOnce()
  })

  // Every Across route from a smart account carries a target execution
  // authorization. The owners have to sign it themselves, so it is one of
  // their slots and the assembled vector covers it.
  test.each([
    ['an ECDSA validator', undefined],
    [
      'a quorum validator',
      defineValidator({
        type: 'quorum' as const,
        module: '0x0000000000000000000000000000000000000042' as const,
        thresholdWeight: 1n,
        owners: [{ account, weight: 1n }],
      }),
    ],
  ])(
    'signs and assembles a target execution slot with %s',
    async (_label, owner) => {
      const baseRuntime = runtime()
      const accountRuntime: AccountRuntime = owner
        ? {
            ...baseRuntime,
            construction: { ...baseRuntime.construction, owner },
          }
        : baseRuntime
      const workflow = context({
        account: { forChain: vi.fn(async () => accountRuntime) },
        quoteClient: {
          createQuote: vi.fn(async () => ({
            traceId: 'trace-target',
            routes: [
              quote({
                signingRequests: [
                  originRequest(),
                  eip712Request({
                    chainId: 1,
                    purpose: 'targetExecutionAuthorization',
                    typedData: intentTypedData(1, '2'),
                  }),
                  destinationRequest(),
                ],
              }),
            ],
          })),
        },
      })
      const prepared = await prepareIntent(workflow, input)

      const ownerSignature = await signIntentAsOwner(workflow, prepared, {
        signerId: `ecdsa:${account.address.toLowerCase()}`,
      })
      if (ownerSignature.kind !== 'ecdsa') {
        throw new Error('Expected independent ECDSA signature')
      }
      expect(ownerSignature.slots).toHaveLength(2)

      const assembled = await assembleIntent(workflow, prepared, [
        ownerSignature,
      ])
      // Origin, target, and the destination reusing the origin's bytes.
      expect(assembled.proofs).toHaveLength(3)
      expect(hexProof(assembled.proofs[2])).toBe(hexProof(assembled.proofs[0]))
      const target = eip712Slot(prepared.signing, 1)
      expect(target.reuse).toBeUndefined()
      expect(target.exposedForIndependentSigning).toBe(true)
    },
  )

  test('signs a multi-origin quorum once and emits per-origin Merkle proofs', async () => {
    const quorumValidator = '0x0000000000000000000000000000000000000042'
    const baseRuntime = runtime()
    const quorumRuntime: AccountRuntime = {
      ...baseRuntime,
      construction: {
        ...baseRuntime.construction,
        owner: defineValidator({
          type: 'quorum',
          module: quorumValidator,
          thresholdWeight: 1n,
          owners: [{ account, weight: 1n }],
        }),
      },
    }
    const workflow = context({
      account: { forChain: vi.fn(async () => quorumRuntime) },
      quoteClient: {
        createQuote: vi.fn(async () => ({
          traceId: 'trace-merkle',
          routes: [
            quote({
              signingRequests: [
                originRequest(),
                originRequest(10, '2'),
                destinationRequest(),
              ],
            }),
          ],
        })),
      },
    })
    const prepared = await prepareIntent(workflow, input)
    const signed = await signIntent(workflow, prepared)

    expect(workflow.signerInvoker.invoke).toHaveBeenCalledOnce()
    expect(signed.proofs).toHaveLength(3)
    const firstSignature = hexProof(signed.proofs[0])
    const secondSignature = hexProof(signed.proofs[1])
    expect(firstSignature).not.toBe(secondSignature)
    expect(firstSignature).toMatch(/^0x01/u)
    expect(firstSignature.slice(4, 68)).toBe(secondSignature.slice(4, 68))
    expect(secondSignature).toMatch(/^0x01/u)
    // Reuse follows payload identity, not position: this destination authorizes
    // the same payload as the first origin, so it carries the same bytes.
    expect(eip712Slot(prepared.signing, 2).reuse).toEqual({
      artifactId: 'request-0',
      selection: 'whole',
    })
    expect(hexProof(signed.proofs[2])).toBe(firstSignature)

    const ownerSignature = await signIntentAsOwner(workflow, prepared, {
      signerId: `ecdsa:${account.address.toLowerCase()}`,
    })
    if (ownerSignature.kind !== 'ecdsa') {
      throw new Error('Expected independent ECDSA signature')
    }
    expect(ownerSignature.slots).toHaveLength(2)
    expect(ownerSignature.slots[0]).toBe(ownerSignature.slots[1])
  })

  test('signs Kernel quorum Merkle leaves with account wrapping before validator binding', async () => {
    const quorumValidator = '0x0000000000000000000000000000000000000042'
    const baseRuntime = runtime()
    const kernelAccount = {
      kind: 'kernel' as const,
      version: { source: 'explicit' as const, value: '3.3' as const },
      salt: { source: 'explicit' as const, value: '0x' as const },
    }
    const quorumRuntime: AccountRuntime = {
      ...baseRuntime,
      construction: {
        ...baseRuntime.construction,
        account: kernelAccount,
        owner: defineValidator({
          type: 'quorum',
          module: quorumValidator,
          thresholdWeight: 1n,
          owners: [{ account, weight: 1n }],
        }),
      },
      identity: { definition: kernelAccount, address },
    }
    const workflow = context({
      account: { forChain: vi.fn(async () => quorumRuntime) },
      quoteClient: {
        createQuote: vi.fn(async () => ({
          traceId: 'trace-kernel-merkle',
          routes: [
            quote({
              signingRequests: [
                originRequest(),
                originRequest(10, '2'),
                destinationRequest(),
              ],
            }),
          ],
        })),
      },
    })
    const prepared = await prepareIntent(workflow, input)
    const leaves = [
      eip712Slot(prepared.signing, 0),
      eip712Slot(prepared.signing, 1),
    ]
    const tree = buildQuorumMerkleTree(
      leaves.map(({ payload }) => ({
        account: address,
        digest: getQuorumSignableHash({
          validator: quorumValidator,
          chainId: payload.chain.id,
          account: address,
          hash: wrapKernelMessageHash(payload.id, address),
        }),
      })),
    )
    const expectedRootHash = getQuorumMerkleRootSignableHash({
      validator: quorumValidator,
      root: tree.root,
    })

    const signed = await signIntent(workflow, prepared)

    expect(signed.proofs).toHaveLength(3)
    expect(workflow.signerInvoker.invoke).toHaveBeenCalledOnce()
    expect(vi.mocked(workflow.signerInvoker.invoke).mock.calls[0]?.[1]).toEqual(
      {
        kind: 'ecdsa-sign-hash',
        hash: expectedRootHash,
      },
    )
    expect(expectedRootHash).not.toBe(
      wrapKernelMessageHash(expectedRootHash, address),
    )
  })

  test('uses an explicit owner selection for preparation and signing', async () => {
    const workflow = context()
    const validator = defineValidator({
      type: 'ecdsa',
      accounts: [secondAccount],
    })
    if (validator.kind === 'multi-factor') {
      throw new Error('Expected atomic validator')
    }
    const prepared = await prepareIntent(workflow, {
      ...input,
      signers: {
        kind: 'owner',
        validator,
        signerIds: validator.owners.map(({ signerId }) => signerId),
      },
    })

    await signIntent(workflow, prepared)

    expect(prepared.signing.effectiveSelection.signerIds).toEqual([
      `ecdsa:${secondAccount.address.toLowerCase()}`,
    ])
    expect(workflow.signerInvoker.invoke).toHaveBeenCalledWith(
      { id: `ecdsa:${secondAccount.address.toLowerCase()}`, kind: 'ecdsa' },
      expect.anything(),
    )
  })

  // A quote can legitimately name another subject — a configured recipient
  // that adopts EIP-7702 gets its own delegation request. Signing it with our
  // key wastes a prompt and fails at the orchestrator's recovery instead.
  test.each([
    [
      'an account this SDK does not control',
      () =>
        eip712Request({
          chainId: 1,
          account: '0x00000000000000000000000000000000000000ff',
          typedData: intentTypedData(1),
        }),
      /names account 0x00000000000000000000000000000000000000ff/u,
    ],
    [
      'a delegation for a key this account does not hold',
      () =>
        delegationRequest({
          chainId: 1,
          contract: '0x00000000000000000000000000000000000000aa',
          account: address,
          authority: '0x00000000000000000000000000000000000000bb',
        }),
      /EIP-7702 delegation/u,
    ],
    [
      'a raw-key signature a smart account cannot produce',
      () =>
        eip712Request({
          chainId: 1,
          signatureFormat: 'secp256k1',
          typedData: intentTypedData(1),
        }),
      /`secp256k1` signature/u,
    ],
  ])('refuses a signing request naming %s', (_label, request, message) => {
    const base = runtime()
    const eoaBacked: AccountRuntime = {
      ...base,
      construction: { ...base.construction, eoa: account },
    }
    expect(() =>
      buildIntentSigningInput(
        eoaBacked,
        quote({ signingRequests: [request()] }),
      ),
    ).toThrow(message)
  })

  test('signs a chain-agnostic multi-leg origin payload', () => {
    // `MultiChainOps` is one signature over every IntentExecutor leg, so its
    // domain carries no chainId and the quote carries ONE origin request for a
    // bundle of several legs. Deriving the chain from the domain gave
    // `Invalid chain id: NaN` and failed the intent after the user's approval.
    const multiChainOps = {
      domain: {
        name: 'IntentExecutor',
        version: 'v0.0.1',
        verifyingContract: address,
      },
      types: {
        MultiChainOps: [
          { name: 'account', type: 'address' },
          { name: 'ops', type: 'ChainOps[]' },
        ],
        ChainOps: [
          { name: 'chainId', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
      primaryType: 'MultiChainOps',
      message: {
        account: address,
        ops: [
          { chainId: 1n, nonce: 1n },
          { chainId: 8453n, nonce: 2n },
        ],
      },
    } as unknown as TypedDataDefinition

    const signing = buildIntentSigningInput(
      runtime(),
      quote({
        signingRequests: [
          eip712Request({ chainId: 1, typedData: multiChainOps }),
        ],
      }),
    )

    expect(signing.requests).toHaveLength(1)
    expect(eip712Slot(signing, 0).payload.chain.id).toBe(1)
  })

  // Caucasus makes a target execution an explicit request slot: the SDK no
  // longer decides locally whether to sign one, it signs exactly what the quote
  // asks for.
  test('signs a target execution payload only when the quote asks for one', () => {
    expect(
      buildIntentSigningInput(runtime(), quote()).requests.some(
        ({ purpose }) => purpose === 'targetExecutionAuthorization',
      ),
    ).toBe(false)

    const signing = buildIntentSigningInput(
      runtime(),
      quote({
        signingRequests: [
          originRequest(1, 1n),
          eip712Request({
            chainId: 421614,
            purpose: 'targetExecutionAuthorization',
            typedData: intentTypedData(421614, 1n),
          }),
        ],
      }),
    )
    const target = eip712Slot(signing, 1)

    expect(target.payload.usage).toBe('intent-target')
    expect(target.payload.chain.id).toBe(421614)
    // The owners have to sign it themselves, so it is one of their slots.
    expect(target.exposedForIndependentSigning).toBe(true)
  })

  test('freezes and signs a fresh Smart Session route per chain', async () => {
    const session = toSession({
      chain: mainnet,
      owners: { type: 'ecdsa', accounts: [account] },
    })
    const read = vi.fn(async (checkpoint) => [
      { kind: 'session-enabled' as const, id: checkpoint.id, enabled: false },
    ])
    const workflow = context({ checkpoints: { read } })
    const prepared = await prepareIntent(workflow, {
      ...input,
      signers: {
        kind: 'smart-session',
        byChain: {
          1: {
            session,
            enableData: {
              userSignature: signature,
              hashesAndChainIds: [
                { chainId: 1n, sessionDigest: `0x${'22'.repeat(32)}` },
              ],
              sessionToEnableIndex: 0,
            },
          },
        },
      },
    })
    const signed = await signIntent(workflow, prepared)

    expect(smartAccount(prepared.request).signatureMode).toBe(5)
    expect(
      smartAccount(prepared.request).simulation?.mockSignaturesByChain?.[
        'eip155:1'
      ],
    ).toMatch(/^0x/u)
    expect(prepared.request.source?.executions).toMatchObject([
      { chainId: 'eip155:1', calls: [{ value: 0n }] },
    ])
    // A session origin carries both encodings of the one message in one proof.
    const originProof = claimPairProof(signed.proofs[0])
    expect(originProof.preClaim).toMatch(/^0x01/u)
    expect(originProof.notarizedClaim).toMatch(/^0x/u)
    // The destination reuses the pre-claim half of that pair, never the pair.
    expect(eip712Slot(prepared.signing, 1).reuse).toEqual({
      artifactId: 'request-0',
      selection: 'pre-claim',
    })
    expect(hexProof(signed.proofs[1])).toMatch(/^0x01/u)
    // Session state is read again when signing rather than carried over from
    // preparation. The reused destination slot runs no ceremony of its own, so
    // it reads nothing.
    expect(read).toHaveBeenCalledTimes(2)
  })

  test('uses each prepared stage chain for a shorthand cross-chain session', () => {
    const source = toEvmChainReference(base.id)
    const destination = toEvmChainReference(arbitrum.id)
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [account] },
    })
    const selected = {
      kind: 'smart-session' as const,
      session,
      verifyExecutions: false,
      enableData: {
        userSignature: signature,
        hashesAndChainIds: [],
        sessionToEnableIndex: 0,
      },
    }
    const typedData = (chainId: number): TypedDataDefinition => ({
      domain: { chainId, verifyingContract: address },
      types: { Test: [{ name: 'value', type: 'uint256' }] },
      primaryType: 'Test',
      message: { value: 1n },
    })
    const prepared = {
      signing: {
        requests: [
          {
            kind: 'eip712',
            index: 0,
            purpose: 'originAuthorization',
            artifactId: 'request-0',
            signatureFormat: 'account',
            payload: {
              id: `0x${'22'.repeat(32)}`,
              chain: source,
              typedData: typedData(source.id),
              usage: 'intent-origin',
            },
            shape: 'hex',
            exposedForIndependentSigning: false,
          },
          {
            kind: 'eip712',
            index: 1,
            purpose: 'destinationAuthorization',
            artifactId: 'request-1',
            signatureFormat: 'account',
            payload: {
              id: `0x${'33'.repeat(32)}`,
              chain: destination,
              typedData: typedData(destination.id),
              usage: 'intent-destination',
            },
            shape: 'hex',
            exposedForIndependentSigning: false,
          },
        ],
      },
      resolvedSessions: {
        [source.id]: selected,
        [destination.id]: selected,
      },
      sessionEnvironment: 'production',
    } as never
    const signing = createAccountSigningContext({
      runtime: runtime(),
      purpose: 'intent',
      signerInvoker: { invoke: vi.fn() },
    })

    const plan = buildSessionIntentPlanInput(prepared, signing)
    const destinationStage = plan.stages.find(({ id }) => id === 'request-1')

    expect(destinationStage?.tasks).not.toHaveLength(0)
    expect(
      destinationStage?.tasks.every(
        (task) => task.chain?.id === destination.id,
      ),
    ).toBe(true)
    expect(destinationStage?.checkpoint).toMatchObject({
      chain: { id: destination.id },
    })
  })

  test('signs Smart Sessions with a multi-factor owner topology', async () => {
    const session = toSession({
      chain: mainnet,
      owners: {
        type: 'multi-factor',
        threshold: 2,
        validators: [
          { type: 'ecdsa', accounts: [account] },
          { type: 'ecdsa', accounts: [secondAccount] },
        ],
      },
    })
    const workflow = context({
      checkpoints: {
        read: vi.fn(async (checkpoint) => [
          {
            kind: 'session-enabled' as const,
            id: checkpoint.id,
            enabled: true,
          },
        ]),
      },
    })
    const prepared = await prepareIntent(workflow, {
      ...input,
      signers: {
        kind: 'smart-session',
        byChain: { 1: { session } },
      },
    })

    const signed = await signIntent(workflow, prepared)

    expect(hexProof(signed.proofs[0])).toMatch(/^0x00/u)
    expect(prepared.signing.effectiveSelection.signerIds).toHaveLength(2)
    expect(
      Object.keys(signed.transcript.stages[0]?.results ?? {}),
    ).toHaveLength(2)
  })

  test('signs Smart Sessions with a passkey owner', async () => {
    const session = toSession({
      chain: mainnet,
      owners: { type: 'passkey', accounts: [testPasskey] },
    })
    const workflow = context({
      checkpoints: {
        read: vi.fn(async (checkpoint) => [
          {
            kind: 'session-enabled' as const,
            id: checkpoint.id,
            enabled: true,
          },
        ]),
      },
    })
    const prepared = await prepareIntent(workflow, {
      ...input,
      signers: {
        kind: 'smart-session',
        byChain: { 1: { session } },
      },
    })

    const signed = await signIntent(workflow, prepared)

    expect(hexProof(signed.proofs[0])).toMatch(/^0x00/u)
    expect(
      Object.values(signed.transcript.stages[0]?.results ?? {})[0],
    ).toMatchObject({ kind: 'webauthn-assertion' })
  })

  test('submits signed data with source and target metadata', async () => {
    const workflow = context()
    const prepared = await prepareIntent(workflow, input)
    const signed = await signIntent(workflow, prepared)
    const result = await submitIntent(workflow, signed)

    expect(result).toEqual({
      type: 'intent',
      traceId: 'trace-2',
      intentId: 'intent-1',
      sourceChains: [1],
      targetChain: 1,
    })
    // No approval context: the grant rode on the quote and is not asked for again.
    expect(workflow.submissionClient.submitIntent).toHaveBeenCalledWith({
      intentId: 'intent-1',
      proofs: signed.proofs,
    })
    expect(
      vi.mocked(workflow.submissionClient.submitIntent).mock.calls[0],
    ).toHaveLength(1)
  })

  test('quotes with the serialized intent input and whether sponsorship is requested', async () => {
    const workflow = context()
    const prepared = await prepareIntent(workflow, input)

    expect(workflow.quoteClient.createQuote).toHaveBeenCalledWith(
      prepared.request,
      {
        intentInput: projectCompatibleIntentInput(prepared.normalized),
        sponsored: false,
      },
    )
    expect(
      vi.mocked(workflow.quoteClient.createQuote).mock.calls[0]?.[1]
        ?.intentInput,
    ).toMatchObject({
      destinationExecutions: [expect.objectContaining({ value: '1' })],
    })

    const sponsored = context()
    await prepareIntent(sponsored, {
      ...input,
      options: {
        sponsorSettings: { gas: false, bridgeFees: false, swapFees: false },
      },
    })

    expect(sponsored.quoteClient.createQuote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sponsored: true }),
    )
  })

  test('composes prepare, sign, and submit', async () => {
    const workflow = context()
    await expect(sendIntent(workflow, input)).resolves.toMatchObject({
      type: 'intent',
      intentId: 'intent-1',
    })
  })

  // A quote that needs an EIP-7702 delegation asks for it as its own request
  // slot, so the authorization is signed in place and submitted in the proof
  // vector rather than collected into a separate authorization bag.
  test('signs a requested EIP-7702 delegation into the proof vector', async () => {
    const authorization = {
      address,
      chainId: 1,
      nonce: 7,
      r: `0x${'22'.repeat(32)}`,
      s: `0x${'33'.repeat(32)}`,
      yParity: 0,
    } as const
    const signDelegation = vi.fn(async () => authorization)
    const workflow = context({
      signDelegation,
      quoteClient: {
        createQuote: vi.fn(async () => ({
          traceId: 'trace-7702',
          routes: [
            quote({
              signingRequests: [
                originRequest(),
                delegationRequest({ chainId: 1, contract: address }),
              ],
            }),
          ],
        })),
      },
    })

    await sendIntent(workflow, { ...input, eip7702InitSignature: signature })

    expect(signDelegation).toHaveBeenCalledWith({
      chainId: 1,
      contract: address,
    })
    const [submitted] =
      vi.mocked(workflow.submissionClient.submitIntent).mock.calls[0] ?? []
    expect(submitted?.proofs).toHaveLength(2)
    expect(submitted?.proofs[0]).toMatchObject({ kind: 'eip712' })
    expect(submitted?.proofs[1]).toEqual({
      kind: 'eip7702',
      nonce: 7,
      signature: {
        r: authorization.r,
        s: authorization.s,
        yParity: 0,
      },
    })
  })
})
