import {
  type Hex,
  isAddressEqual,
  keccak256,
  slice,
  type TypedDataDefinition,
  toHex,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, mainnet, sepolia } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { passkeyAccount } from '../../../test/consts'
import { SETTLEMENT_CATALOG } from '../../../test/utils/settlement-catalog'
import type {
  AccountAdapter,
  AccountRuntime,
  AccountRuntimePort,
  AccountSignatureEnvelopeInput,
} from '../../accounts/adapter'
import { wrapKernelMessageHash } from '../../accounts/kernel-signing'
import type { AccountConstruction } from '../../accounts/types'
import { toEvmChainReference } from '../../chains/caip2'
import type { OrchestratorQuote } from '../../clients/orchestrator/types'
import { defineValidator } from '../../modules/validators/definition'
import {
  buildQuorumMerkleTree,
  getQuorumMerkleRootSignableHash,
  getQuorumSignableHash,
} from '../../modules/validators/quorum'
import { ONE_TIME_USE_ID_POLICY_ADDRESS_DEV } from '../../modules/validators/smart-sessions/policies/addresses'
import {
  DUMMY_PRECLAIMOP_SELECTOR,
  DUMMY_PRECLAIMOP_TARGET,
  toSession,
} from '../../modules/validators/smart-sessions/resolve'
import type { SessionDefinition } from '../../modules/validators/smart-sessions/types'
import { createAccountSigningContext } from '../../signing/context'
import { buildIntentSigningInput, prepareIntent } from './prepare'
import { sendIntent } from './send'
import { buildSessionIntentPlanInput } from './session-signing'
import { signIntent, signIntentAsOwner } from './sign-transaction'
import { submitIntent } from './submit'
import type { IntentWorkflowContext } from './types'

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

function quote(): OrchestratorQuote {
  const typedData = {
    domain: { chainId: 1, verifyingContract: address },
    types: { Test: [{ name: 'value', type: 'uint256' }] },
    primaryType: 'Test',
    message: { value: '1' },
  } as const
  return {
    intentId: 'intent-1',
    expiresAt: 1,
    estimatedFillTime: { seconds: 1 },
    settlementLayer: 'SAME_CHAIN',
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
  }
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
        address,
        setupOps: [{ to: address, data: '0x1234' }],
      },
      destinationExecutions: [{ to: address, value: 2n, data: '0x12' }],
      preClaimExecutions: {
        1: [{ to: address, value: 3n, data: '0x34' }],
      },
      options: { auxiliaryFunds: { 1: { [address]: 4n } } },
    })
    expect(prepared.signing.origins).toHaveLength(1)
    expect(prepared.signing.origins[0]?.typedData.message).toEqual({
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

    expect(prepared.request.account.mockSignatures?.['1']).toMatch(/^0x/u)
    expect(prepared.request.account.mockSignatures?.['1337001']).toBeUndefined()
  })

  test('signs through the shared plan executor', async () => {
    const workflow = context()
    const prepared = await prepareIntent(workflow, input)
    const signed = await signIntent(workflow, prepared)

    expect(signed.originSignatures).toHaveLength(1)
    expect(signed.destinationSignature).toBe(signed.originSignatures[0])
    expect(signed.transcript.planKind).toBe('intent-full')
    expect(workflow.signerInvoker.invoke).toHaveBeenCalledOnce()
  })

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
    const secondOrigin = {
      ...quote().signData.origin[0],
      domain: { chainId: 10, verifyingContract: address },
      message: { value: '2' },
    }
    const workflow = context({
      account: { forChain: vi.fn(async () => quorumRuntime) },
      quoteClient: {
        createQuote: vi.fn(async () => ({
          traceId: 'trace-merkle',
          routes: [
            {
              ...quote(),
              signData: {
                ...quote().signData,
                origin: [quote().signData.origin[0], secondOrigin],
              },
            },
          ],
        })),
      },
    })
    const prepared = await prepareIntent(workflow, input)
    const signed = await signIntent(workflow, prepared)

    expect(workflow.signerInvoker.invoke).toHaveBeenCalledOnce()
    expect(signed.originSignatures).toHaveLength(2)
    const [firstSignature, secondSignature] = signed.originSignatures
    if (
      typeof firstSignature !== 'string' ||
      typeof secondSignature !== 'string'
    ) {
      throw new Error('Expected Quorum Merkle signatures')
    }
    expect(firstSignature).not.toBe(secondSignature)
    expect(firstSignature).toMatch(/^0x01/u)
    expect(firstSignature.slice(4, 68)).toBe(secondSignature.slice(4, 68))
    expect(secondSignature).toMatch(/^0x01/u)
    expect(signed.destinationSignature).toBe(secondSignature)

    const ownerSignature = await signIntentAsOwner(workflow, prepared, {
      signerId: `ecdsa:${account.address.toLowerCase()}`,
    })
    if (ownerSignature.kind !== 'ecdsa') {
      throw new Error('Expected independent ECDSA signature')
    }
    expect(ownerSignature.origin).toHaveLength(2)
    expect(ownerSignature.origin[0]).toBe(ownerSignature.origin[1])
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
    const secondOrigin = {
      ...quote().signData.origin[0],
      domain: { chainId: 10, verifyingContract: address },
      message: { value: '2' },
    }
    const workflow = context({
      account: { forChain: vi.fn(async () => quorumRuntime) },
      quoteClient: {
        createQuote: vi.fn(async () => ({
          traceId: 'trace-kernel-merkle',
          routes: [
            {
              ...quote(),
              signData: {
                ...quote().signData,
                origin: [quote().signData.origin[0], secondOrigin],
              },
            },
          ],
        })),
      },
    })
    const prepared = await prepareIntent(workflow, input)
    const tree = buildQuorumMerkleTree(
      prepared.signing.origins.map((origin) => ({
        account: address,
        digest: getQuorumSignableHash({
          validator: quorumValidator,
          chainId: origin.chain.id,
          account: address,
          hash: wrapKernelMessageHash(origin.id, address),
        }),
      })),
    )
    const expectedRootHash = getQuorumMerkleRootSignableHash({
      validator: quorumValidator,
      root: tree.root,
    })

    const signed = await signIntent(workflow, prepared)

    expect(signed.originSignatures).toHaveLength(2)
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

  test('signs a chain-agnostic multi-leg origin payload', () => {
    // `MultiChainOps` is one signature over every IntentExecutor leg, so its
    // domain carries no chainId and the quote carries ONE origin entry for a
    // bundle of several legs. Deriving the chain from the domain gave
    // `Invalid chain id: NaN` and failed the intent after the user's approval.
    const intentQuote = quote()
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
    } as const

    const signing = buildIntentSigningInput(runtime(), {
      ...intentQuote,
      signData: { ...intentQuote.signData, origin: [multiChainOps] },
    })

    expect(signing.origins).toHaveLength(1)
    expect(signing.origins[0].chain.id).toBe(1)
  })

  test('does not sign an ordinary target execution payload', () => {
    const intentQuote = quote()
    const targetExecution = {
      ...intentQuote.signData.destination,
      domain: {
        ...intentQuote.signData.destination.domain,
        chainId: 421614,
      },
    }

    expect(
      buildIntentSigningInput(
        runtime(),
        {
          ...intentQuote,
          signData: { ...intentQuote.signData, targetExecution },
        },
        undefined,
        toEvmChainReference(421614),
      ).target,
    ).toBeUndefined()
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

    expect(prepared.request.options.signatureMode).toBe(5)
    expect(prepared.request.account.mockSignatures?.['1']).toMatch(/^0x/u)
    expect(prepared.request.preClaimExecutions?.[1]?.[0]).toMatchObject({
      value: 0n,
    })
    const originSignature = signed.originSignatures[0]
    expect(typeof originSignature).toBe('object')
    if (typeof originSignature !== 'object') {
      throw new Error('Expected a Smart Session signature pair')
    }
    expect(originSignature.preClaimSig).toMatch(/^0x01/u)
    expect(originSignature.notarizedClaimSig).toMatch(/^0x/u)
    expect(signed.destinationSignature).toMatch(/^0x01/u)
    expect(read).toHaveBeenCalledTimes(3)
  })

  test('forces verify-execution mode for an already-enabled one-time-use session', async () => {
    const session = toSession({
      chain: mainnet,
      owners: { type: 'ecdsa', accounts: [account] },
      claimPolicies: [
        {
          type: 'permit2',
          spenders: ['0x00000000000000000000000000000000000000ab'],
        },
      ],
      oneTimeUse: { id: 42n },
      policyAddresses: {
        oneTimeUseId: '0x00000000000000000000000000000000000000aa',
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
      signers: { kind: 'smart-session', byChain: { 1: { session } } },
    })
    // A permission-less session enabled on-chain would normally drop to
    // signatureMode 1 (see the multi-factor/passkey enabled cases → 0x00). A
    // one-time-use session must stay in mode 5 so checkAction keeps running on
    // the executor route — otherwise the contract's action-surface guard is inert.
    expect(prepared.request.options.signatureMode).toBe(5)
    // source: cast calldata "consumeFor(uint256,uint256)" 42 0
    expect(prepared.request.preClaimExecutions?.[1]?.[0]).toMatchObject({
      to: '0x00000000000000000000000000000000000000aa',
      value: 0n,
      data: '0x96301d72000000000000000000000000000000000000000000000000000000000000002a0000000000000000000000000000000000000000000000000000000000000000',
    })
    // Same-chain: the source's burn already leads the batch, so the destination
    // calls must not carry a second one (the orchestrator refuses two).
    expect(
      (prepared.request.destinationExecutions ?? []).map((call) =>
        call.to.toLowerCase(),
      ),
    ).not.toContain('0x00000000000000000000000000000000000000aa')
    expect(prepared.request.destinationExecutions?.length).toBe(
      input.calls.length,
    )
  })

  test('keeps an already-enabled reusable scoped Permit2 session in verify-execution mode', async () => {
    // Its Permit2SenderPolicy refuses a pre-claim check through ERC-1271.
    const session = toSession({
      chain: mainnet,
      owners: { type: 'ecdsa', accounts: [account] },
      crossChainPermits: [
        {
          from: {
            chain: mainnet,
            token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          },
          to: {
            chain: arbitrum,
            token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          },
          settlementLayers: ['ACROSS'],
        },
      ],
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
      signers: { kind: 'smart-session', byChain: { 1: { session } } },
    })
    expect(prepared.request.options.signatureMode).toBe(5)
    const [originSignature] = (await signIntent(workflow, prepared))
      .originSignatures
    if (typeof originSignature !== 'object') {
      throw new Error('Expected a Smart Session signature pair')
    }
    expect(originSignature.preClaimSig).toMatch(/^0x00/u)
    expect(originSignature.notarizedClaimSig).toMatch(/^0x/u)
  })

  test.each(['intentExecution', 'sudo'] as const)(
    'keeps an already-enabled %s fallback session in verify-execution mode',
    async (fallback) => {
      const session = toSession({
        chain: mainnet,
        owners: { type: 'ecdsa', accounts: [account] },
        crossChainPermits: [
          {
            from: {
              chain: mainnet,
              token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            },
            to: {
              chain: arbitrum,
              token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
            },
          },
        ],
        fallback,
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
        signers: { kind: 'smart-session', byChain: { 1: { session } } },
      })
      expect(prepared.request.options.signatureMode).toBe(5)
    },
  )

  describe('a session whose claim may not carry pre-claim calls', () => {
    const session = toSession({
      chain: mainnet,
      owners: { type: 'ecdsa', accounts: [account] },
      crossChainPermits: [
        {
          from: {
            chain: mainnet,
            token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          },
          to: {
            chain: arbitrum,
            token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          },
          settlementLayers: ['ACROSS'],
          preClaimOps: 'none',
        },
      ],
    })
    const enableData = {
      userSignature: signature,
      hashesAndChainIds: [
        { chainId: 1n, sessionDigest: `0x${'22'.repeat(32)}` as const },
      ],
      sessionToEnableIndex: 0,
    }
    const permit2Quote = (
      ops: { to: typeof address; value: bigint; data: `0x${string}` }[],
    ): OrchestratorQuote => {
      const typedData = {
        domain: {
          name: 'Permit2',
          chainId: 1,
          verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
        },
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
          Mandate: [
            { name: 'target', type: 'Target' },
            { name: 'minGas', type: 'uint128' },
            { name: 'originOps', type: 'Op' },
            { name: 'destOps', type: 'Op' },
            { name: 'q', type: 'bytes32' },
          ],
          Target: [
            { name: 'recipient', type: 'address' },
            { name: 'tokenOut', type: 'Token[]' },
            { name: 'targetChain', type: 'uint256' },
            { name: 'fillExpiry', type: 'uint256' },
          ],
          Token: [
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          Op: [
            { name: 'vt', type: 'bytes32' },
            { name: 'ops', type: 'Ops[]' },
          ],
          Ops: [
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' },
          ],
        },
        primaryType: 'PermitBatchWitnessTransferFrom',
        message: {
          permitted: [{ token: address, amount: 1n }],
          spender: address,
          nonce: 1n,
          deadline: 1n,
          mandate: {
            target: {
              recipient: address,
              tokenOut: [{ token: address, amount: 1n }],
              targetChain: 42161n,
              fillExpiry: 1n,
            },
            minGas: 0n,
            originOps: { vt: `0x${'00'.repeat(32)}`, ops },
            destOps: { vt: `0x${'00'.repeat(32)}`, ops: [] },
            q: `0x${'00'.repeat(32)}`,
          },
        },
      }
      return {
        ...quote(),
        signData: { ...quote().signData, origin: [typedData as never] },
      }
    }
    const workflowFor = (enabled: boolean, route = quote()) =>
      context({
        checkpoints: {
          read: vi.fn(async (checkpoint) => [
            { kind: 'session-enabled' as const, id: checkpoint.id, enabled },
          ]),
        },
        quoteClient: {
          createQuote: vi.fn(async () => ({
            traceId: 'trace-1',
            routes: [route as never],
          })),
        },
      })
    const signers = (withEnable: boolean) => ({
      kind: 'smart-session' as const,
      byChain: { 1: { session, ...(withEnable && { enableData }) } },
    })

    test('must be enabled before its first intent', async () => {
      await expect(
        prepareIntent(workflowFor(false), { ...input, signers: signers(true) }),
      ).rejects.toThrow(
        "The session's claim may not carry pre-claim calls, so enable it on chain 1 before its first intent",
      )
    })

    test('needs the intent to list its sourceChains', async () => {
      await expect(
        prepareIntent(workflowFor(true), {
          ...input,
          sourceChains: undefined,
          signers: signers(false),
        } as never),
      ).rejects.toThrow('needs the intent to list its sourceChains')
    })

    test('refuses before signing a claim that carries a pre-claim call', async () => {
      const workflow = workflowFor(
        true,
        permit2Quote([{ to: address, value: 0n, data: '0x' }]),
      )
      const prepared = await prepareIntent(workflow, {
        ...input,
        signers: signers(false),
      })
      await expect(signIntent(workflow, prepared)).rejects.toThrow(
        "This intent needs a pre-claim call, which the session's claim may not carry",
      )
      const clean = workflowFor(true, permit2Quote([]))
      await expect(
        signIntent(
          clean,
          await prepareIntent(clean, { ...input, signers: signers(false) }),
        ),
      ).resolves.toBeDefined()
    })
  })

  describe('one-time-use destination burn', () => {
    const POLICY = '0x00000000000000000000000000000000000000aa' as const
    // source: cast calldata "consumeFor(uint256,uint256)" 42 0
    const BURN =
      '0x96301d72000000000000000000000000000000000000000000000000000000000000002a0000000000000000000000000000000000000000000000000000000000000000'
    const baseChain = toEvmChainReference(base.id)
    const sessionOn = (id: number) =>
      toSession({
        chain: id === base.id ? base : mainnet,
        owners: { type: 'ecdsa', accounts: [account] },
        oneTimeUse: { id: 42n },
        policyAddresses: { oneTimeUseId: POLICY },
      })
    const enabledWorkflow = () =>
      context({
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
    const signers = {
      kind: 'smart-session' as const,
      byChain: {
        [base.id]: { session: sessionOn(base.id) },
        [mainnet.id]: { session: sessionOn(mainnet.id) },
      },
    }

    test("leads a cross-chain destination's calls with the burn", async () => {
      const prepared = await prepareIntent(enabledWorkflow(), {
        ...input,
        sourceChains: [baseChain],
        signers,
      })
      const destination = prepared.request.destinationExecutions ?? []
      expect(destination).toHaveLength(input.calls.length + 1)
      expect(destination[0]).toMatchObject({ to: POLICY, data: BURN })
    })

    test('adds no destination burn when there are no destination calls', async () => {
      const prepared = await prepareIntent(enabledWorkflow(), {
        ...input,
        calls: [],
        sourceChains: [baseChain],
        signers,
      })
      expect(prepared.request.destinationExecutions ?? []).toHaveLength(0)
    })

    test('refuses a default policy address on an intent chain it is not deployed on', async () => {
      // The dev deployment is on Base and mainnet but not on Sepolia.
      const devSession = toSession(
        {
          chain: base,
          owners: { type: 'ecdsa', accounts: [account] },
          oneTimeUse: { id: 42n },
        },
        { environment: 'development' },
      )
      const workflow = enabledWorkflow()
      const byChain = (ids: readonly number[]) => ({
        kind: 'smart-session' as const,
        byChain: Object.fromEntries(
          ids.map((id) => [id, { session: devSession }]),
        ),
      })
      await expect(
        prepareIntent(workflow, {
          ...input,
          sourceChains: [toEvmChainReference(sepolia.id)],
          signers: byChain([sepolia.id, input.destination.id]),
        }),
      ).rejects.toThrow(
        `oneTimeUse: no OneTimeUseIdPolicy is deployed on chain ${sepolia.id} (development contracts); pass its address as policyAddresses.oneTimeUseId`,
      )
      expect(workflow.checkpoints.read).not.toHaveBeenCalled()
      await expect(
        prepareIntent(enabledWorkflow(), {
          ...input,
          sourceChains: [baseChain],
          signers: byChain([base.id, input.destination.id]),
        }),
      ).resolves.toBeDefined()
    })

    test('accepts an explicitly pinned canonical policy address on any chain', async () => {
      const pinned = toSession(
        {
          chain: base,
          owners: { type: 'ecdsa', accounts: [account] },
          oneTimeUse: { id: 42n },
          policyAddresses: { oneTimeUseId: ONE_TIME_USE_ID_POLICY_ADDRESS_DEV },
        },
        { environment: 'development' },
      )
      expect(pinned.oneTimeUse?.defaultPolicy).toBeUndefined()
      await expect(
        prepareIntent(enabledWorkflow(), {
          ...input,
          sourceChains: [toEvmChainReference(sepolia.id)],
          signers: {
            kind: 'smart-session',
            byChain: {
              [sepolia.id]: { session: pinned },
              [input.destination.id]: { session: pinned },
            },
          },
        }),
      ).resolves.toBeDefined()
    })

    test('rejects an intent that does not list its sources', async () => {
      const { sourceChains: _omitted, ...withoutSources } = input
      await expect(
        prepareIntent(enabledWorkflow(), { ...withoutSources, signers }),
      ).rejects.toThrow(/list its sourceChains/)
    })

    test('rejects destination calls on a chain that is also one of several sources', async () => {
      await expect(
        prepareIntent(enabledWorkflow(), {
          ...input,
          sourceChains: [baseChain, chain],
          signers,
        }),
      ).rejects.toThrow(/also one of several sources/)
    })
  })

  describe('dummy pre-claim action', () => {
    const POLICY = '0x00000000000000000000000000000000000000aa' as const
    const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
    const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const
    const DUMMY = {
      to: DUMMY_PRECLAIMOP_TARGET,
      data: DUMMY_PRECLAIMOP_SELECTOR,
    } as const
    // source: cast calldata "consume(uint256)" 42
    const CONSUME =
      '0x483f31ab000000000000000000000000000000000000000000000000000000000000002a'
    const owners = { type: 'ecdsa' as const, accounts: [account] }
    const once = {
      oneTimeUse: { id: 42n },
      policyAddresses: { oneTimeUseId: POLICY },
    }
    const definitions = (
      oneTimeUse: boolean,
    ): Record<string, SessionDefinition> => {
      const extra = oneTimeUse ? once : {}
      return {
        'settlement-scoped': {
          chain: base,
          owners,
          account: address,
          ...extra,
          crossChainPermits: [
            {
              // An uncapped IntentExecutor-layer permit needs no oneTimeUse.
              from: oneTimeUse
                ? { chain: base, token: USDC, maxAmount: 100n }
                : { chain: base, token: USDC },
              to: { chain: arbitrum, token: USDC_ARB },
              settlementLayers: ['CCTP'],
            },
          ],
        },
        restricted: {
          chain: base,
          owners,
          ...extra,
          restrictToActions: true,
          actions: [{ target: address, selector: '0x12345678' }],
        },
        unrestricted: {
          chain: base,
          owners,
          ...extra,
          actions: [{ target: address, selector: '0x12345678' }],
        },
      }
    }
    const sessionOf = (definition: SessionDefinition) =>
      toSession(definition, { settlement: SETTLEMENT_CATALOG })
    // The emissary checks an op against the action keyed by its target and selector.
    const hasAction = (
      session: ReturnType<typeof toSession>,
      op: { readonly to: Hex; readonly data: Hex },
    ) =>
      session.actions.some(
        (action) =>
          isAddressEqual(action.actionTarget, op.to) &&
          action.actionTargetSelector === slice(op.data, 0, 4),
      )
    const prepareEnabling = (session: ReturnType<typeof toSession>) =>
      prepareIntent(
        context({
          checkpoints: {
            read: vi.fn(async (checkpoint) => [
              {
                kind: 'session-enabled' as const,
                id: checkpoint.id,
                enabled: false,
              },
            ]),
          },
        }),
        {
          ...input,
          destination: toEvmChainReference(base.id),
          sourceChains: [toEvmChainReference(base.id)],
          calls: [],
          signers: {
            kind: 'smart-session',
            byChain: {
              [base.id]: {
                session,
                enableData: {
                  userSignature: signature,
                  hashesAndChainIds: [
                    {
                      chainId: BigInt(base.id),
                      sessionDigest: `0x${'22'.repeat(32)}`,
                    },
                  ],
                  sessionToEnableIndex: 0,
                },
              },
            },
          },
        },
      )

    test.each(Object.entries(definitions(true)))(
      'a one-time-use %s session admits every op it enables with, and not the dummy',
      async (_, definition) => {
        const session = sessionOf(definition)
        const prepared = await prepareEnabling(session)
        const preClaim = prepared.request.preClaimExecutions?.[base.id] ?? []
        expect(preClaim.length).toBeGreaterThan(0)
        for (const op of preClaim) expect(hasAction(session, op)).toBe(true)
        // The orchestrator rewrites a destination burn to `consume`.
        expect(hasAction(session, { to: POLICY, data: CONSUME })).toBe(true)
        expect(hasAction(session, DUMMY)).toBe(false)
      },
    )

    test.each(Object.entries(definitions(false)))(
      'a %s session without oneTimeUse still enables with the dummy op',
      async (_, definition) => {
        const session = sessionOf(definition)
        const prepared = await prepareEnabling(session)
        expect(prepared.request.preClaimExecutions?.[base.id]).toEqual([
          { ...DUMMY, value: 0n },
        ])
        expect(hasAction(session, DUMMY)).toBe(true)
      },
    )

    // Captured before oneTimeUse dropped the dummy: a changed digest would be a
    // HashMismatch for every session without oneTimeUse already signed.
    test('sessions without oneTimeUse keep their actions', () => {
      const digests = Object.fromEntries(
        Object.entries(definitions(false)).map(([name, definition]) => [
          name,
          keccak256(
            toHex(
              JSON.stringify(sessionOf(definition).actions, (_, v) =>
                typeof v === 'bigint' ? v.toString() : v,
              ),
            ),
          ),
        ]),
      )
      expect(digests).toMatchInlineSnapshot(`
        {
          "restricted": "0xe553b8ac5e91ddd5049d20fb77ef35efeb92efd50c5537ffe594cdccb39df847",
          "settlement-scoped": "0x40cfa455e95fb4899a29f5844cf5c6ee0147cd049ad0a6edea9261bbbb5fbda0",
          "unrestricted": "0x97d438c046b92b5e3c80b4cc720d014a37c8548ed2c7144cac2a9681650df0f6",
        }
      `)
    })
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
        origins: [
          {
            id: `0x${'22'.repeat(32)}`,
            chain: source,
            typedData: typedData(source.id),
          },
        ],
        destination: {
          mode: 'sign',
          artifactId: 'destination',
          payload: {
            id: `0x${'33'.repeat(32)}`,
            chain: destination,
            typedData: typedData(destination.id),
          },
        },
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
    const destinationStage = plan.stages.find(({ id }) => id === 'destination')

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

    expect(signed.originSignatures[0]).toMatch(/^0x00/u)
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

    expect(signed.originSignatures[0]).toMatch(/^0x00/u)
    expect(
      Object.values(signed.transcript.stages[0]?.results ?? {})[0],
    ).toMatchObject({ kind: 'webauthn-assertion' })
  })

  test('quotes with the serialized intent input and whether sponsorship is requested', async () => {
    const workflow = context()
    const prepared = await prepareIntent(workflow, input)

    expect(workflow.quoteClient.createQuote).toHaveBeenCalledWith(
      prepared.request,
      {
        intentInput: expect.objectContaining({
          destinationExecutions: [expect.objectContaining({ value: '1' })],
        }),
        sponsored: false,
      },
    )

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
    expect(workflow.submissionClient.submitIntent).toHaveBeenCalledWith(
      expect.objectContaining({ intentId: 'intent-1' }),
    )
  })

  test('composes prepare, sign, and submit', async () => {
    const workflow = context()
    await expect(sendIntent(workflow, input)).resolves.toMatchObject({
      type: 'intent',
      intentId: 'intent-1',
    })
  })

  test('signs and submits EIP-7702 authorizations in the send workflow', async () => {
    const authorization = {
      address,
      chainId: 1,
      nonce: 0,
      r: `0x${'22'.repeat(32)}`,
      s: `0x${'33'.repeat(32)}`,
      yParity: 0,
    } as const
    const signAuthorizations = vi.fn(async () => [authorization])
    const workflow = context({ signAuthorizations })

    await sendIntent(workflow, {
      ...input,
      eip7702InitSignature: signature,
    })

    expect(signAuthorizations).toHaveBeenCalledWith({
      chains: [chain],
      eip7702InitSignature: signature,
    })
    expect(workflow.submissionClient.submitIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizations: { sponsor: [authorization] },
      }),
    )
  })
})
