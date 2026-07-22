import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { passkeyAccount } from '../../../test/consts'
import type {
  AccountAdapter,
  AccountRuntime,
  AccountRuntimePort,
} from '../../accounts/adapter'
import type { AccountConstruction } from '../../accounts/types'
import { toEvmChainReference } from '../../chains/caip2'
import type { OrchestratorQuote } from '../../clients/orchestrator/types'
import { defineValidator } from '../../modules/validators/definition'
import { toSession } from '../../modules/validators/smart-sessions/resolve'
import { buildIntentSigningInput, prepareIntent } from './prepare'
import { sendIntent } from './send'
import { signIntent } from './sign-transaction'
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
    clientDataJSON: '{}',
    challengeIndex: 0,
    typeIndex: 0,
    userVerificationRequired: false,
  },
}
const testPasskey = {
  ...passkeyAccount,
  sign: vi.fn(async () => passkeyResult),
  signTypedData: vi.fn(async () => passkeyResult),
}

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
          gas: { usd: 0 },
          bridge: { usd: 0 },
          swap: { usd: 0 },
          app: { usd: 0 },
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
    encodeSignatureEnvelope: ({ validatorContribution }) =>
      validatorContribution,
  } as AccountAdapter
  return {
    adapter,
    construction,
    identity: { definition: construction.account, address },
  }
}

function context(overrides: Partial<IntentWorkflowContext> = {}) {
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
    clock: { now: () => 0, sleep: vi.fn(async () => undefined) },
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

  test('signs through the shared plan executor', async () => {
    const workflow = context()
    const prepared = await prepareIntent(workflow, input)
    const signed = await signIntent(workflow, prepared)

    expect(signed.originSignatures).toHaveLength(1)
    expect(signed.destinationSignature).toBe(signed.originSignatures[0])
    expect(signed.transcript.planKind).toBe('intent-full')
    expect(workflow.signerInvoker.invoke).toHaveBeenCalledOnce()
  })

  test('uses an explicit owner selection for preparation and signing', async () => {
    const workflow = context()
    const validator = defineValidator({
      type: 'ecdsa',
      accounts: [secondAccount],
    })
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
      expect.objectContaining({ sponsored: false }),
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
      expect.anything(),
    )
  })
})
