import { p256 } from '@noble/curves/nist'
import { bytesToHex, type Hex, hexToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test, vi } from 'vitest'
import { authorityQuote } from '../../test/utils/caucasus'
import { signingPasskey } from '../../test/utils/passkeys'
import { asSwigNamespace, locateSwig } from '../accounts/solana/address'
import { addPasskey, removePasskey } from '../actions/solana'
import { solanaDevnet } from '../chains/non-evm'
import {
  parseErrorEnvelope,
  ValidationError,
} from '../clients/orchestrator/errors'
import type {
  SigningPayload,
  SolanaAuthorityDisclosure,
  SwigAuthority,
} from '../clients/orchestrator/public'
import type { OrchestratorIntentRequest } from '../clients/orchestrator/types'
import type { LegacyAccountConfig } from '../config/legacy'
import { resolveSdkConfig } from '../config/resolve'
import { UnsupportedAccountCapabilityError } from '../errors/capability'
import {
  IntentFailedError,
  InvalidSolanaTransactionArtifactError,
} from '../errors/execution'
import type { EvmAccountConfig } from '../evm/index'
import {
  prepareSolanaIntent,
  reconstructSolanaIntent,
  type SolanaTransferInput,
  signSolanaIntent,
  submitSolanaIntent,
} from '../transactions/intents/solana'
import { createAccountFacade, createSolanaAccountFacade } from './account'

const DEV_ORCHESTRATOR_URL = 'https://dev.v1.orchestrator.rhinestone.dev'
const DEVNET_ID = 792703810
const owner = privateKeyToAccount(`0x${'02'.repeat(32)}`)
const location = locateSwig(asSwigNamespace('dev-v1'), owner.address)
const message = 'ab'.repeat(32)
const challenge = `0x${'a3'.repeat(32)}` as const
const now = () => 1_900_000_000_000
const sdk = resolveSdkConfig({
  apiKey: 'offline',
  endpointUrl: DEV_ORCHESTRATOR_URL,
  useDevContracts: true,
})

const secret = hexToBytes(`0x${'42'.repeat(32)}`)
const added = bytesToHex(p256.getPublicKey(secret, true)) as Hex
const addedXy =
  `0x${bytesToHex(p256.getPublicKey(secret, false)).slice(4)}` as Hex
const ecdsaAuthority: SwigAuthority = {
  kind: 'secp256k1',
  address: owner.address,
}
const personalSign: SigningPayload = {
  kind: 'personalSign',
  message: { encoding: 'utf8', value: message },
}

function disclosureFor(
  request: OrchestratorIntentRequest,
): SolanaAuthorityDisclosure {
  const destination = request.destination
  const change =
    destination.vm === 'svm' &&
    destination.execution &&
    'authority' in destination.execution
      ? destination.execution.authority
      : undefined
  if (!change) throw new Error('not an authority change request')
  return {
    ...structuredClone(change),
    roleId: 2,
    rent: { amount: '325120', usd: 0.05 },
  } as SolanaAuthorityDisclosure
}

/**
 * The real Solana workflow against a fake orchestrator that answers each quote
 * with a well-formed authority route for the change it was sent.
 */
function workflows(
  options: {
    readonly acting?: SwigAuthority
    readonly payload?: SigningPayload
    readonly roleId?: number
    readonly refuse?: unknown
  } = {},
) {
  const createQuote = vi.fn(async (request: OrchestratorIntentRequest) => {
    if (options.refuse) throw options.refuse
    return {
      traceId: 'quote-trace',
      routes: [
        authorityQuote({
          chainId: solanaDevnet.caip2,
          wallet: location.wallet,
          swigAccount: location.swig,
          acting: options.acting ?? ecdsaAuthority,
          disclosure: disclosureFor(request),
          payload: options.payload ?? personalSign,
          ...(options.roleId === undefined ? {} : { roleId: options.roleId }),
        }),
      ],
    }
  })
  const submitIntent = vi.fn(async ({ intentId }: { intentId: string }) => ({
    traceId: 'submit-trace',
    intentId,
  }))
  const context = {
    quoteClient: { createQuote },
    submissionClient: { submitIntent },
    now,
  }
  const solana = {
    prepareSolanaIntent: vi.fn((input: SolanaTransferInput) =>
      prepareSolanaIntent(context as never, input),
    ),
    reconstructSolanaIntent: vi.fn(reconstructSolanaIntent),
    signSolanaIntent: (input: Parameters<typeof signSolanaIntent>[0]) =>
      signSolanaIntent({ ...input, now }),
    submitSolanaIntent: (input: Parameters<typeof submitSolanaIntent>[1]) =>
      submitSolanaIntent(context as never, input),
  }
  const waitForIntentStatus = vi.fn(async (intentId: string) => ({
    traceId: `status-${intentId}`,
    intentId,
    purpose: 'execution' as const,
    status: 'COMPLETED' as const,
    operations: [],
  }))
  return { createQuote, submitIntent, solana, waitForIntentStatus }
}

function standalone(
  fake = workflows(),
  owned: {
    readonly owner?:
      | { type: 'ecdsa'; account: typeof owner }
      | {
          type: 'passkey'
          account: ReturnType<typeof signingPasskey>['account']
        }
  } = {},
) {
  const configured = owned.owner ?? { type: 'ecdsa' as const, account: owner }
  const facade = createSolanaAccountFacade(
    {
      owner: configured,
      walletAddress: location.wallet,
      swigAddress: location.swig,
      environment: sdk.environment,
      endpoint: sdk.orchestratorUrl,
    },
    { solana: { owner: configured, swig: location.swig } },
    {
      config: sdk,
      project: {
        solana: fake.solana,
        waitForIntentStatus: fake.waitForIntentStatus,
      } as never,
      createAccount: () => {
        throw new Error('a standalone Solana account has no EVM context')
      },
    },
  )
  return { facade, ...fake }
}

const add = () => addPasskey(addedXy, { permission: 'allButManageAuthority' })

describe('Swig authority changes on a standalone Solana account', () => {
  test('prepares, signs once, submits and waits', async () => {
    const { facade, createQuote, submitIntent, waitForIntentStatus } =
      standalone()
    const prepared = await facade.prepareTransaction({
      chain: solanaDevnet,
      authority: add(),
    })

    const [request, quoteContext] = createQuote.mock.calls[0] as never as [
      OrchestratorIntentRequest,
      { sponsored: boolean },
    ]
    expect(request).toStrictEqual({
      account: {
        svm: {
          type: 'swig',
          address: location.wallet,
          swigAccount: location.swig,
          authorization: ecdsaAuthority,
        },
      },
      destination: {
        vm: 'svm',
        chainId: solanaDevnet.caip2,
        tokenRequests: [],
        execution: {
          authority: {
            action: 'add',
            key: { kind: 'secp256r1', publicKey: added },
            permission: 'allButManageAuthority',
          },
        },
      },
      source: {
        selection: { chains: { only: [solanaDevnet.caip2] }, tokens: 'all' },
      },
      options: {
        sponsorship: { gas: true, bridgeFees: false, swapFees: false },
      },
    })
    expect(quoteContext.sponsored).toBe(true)
    expect(prepared.execution).toStrictEqual({
      kind: 'solana-authority',
      namespace: 'dev-v1',
      endpoint: DEV_ORCHESTRATOR_URL,
      chain: DEVNET_ID,
      caip2: solanaDevnet.caip2,
      accountAddress: location.wallet,
      authority: owner.address,
      swigAddress: location.swig,
      walletAddress: location.wallet,
      action: 'add',
      key: added,
      permission: 'allButManageAuthority',
    })
    expect(prepared.transaction).toStrictEqual({
      chain: solanaDevnet,
      authority: {
        action: 'add',
        key: { type: 'passkey', publicKey: added },
        permission: 'allButManageAuthority',
      },
    })
    expect(prepared.quotes.best.plan.destination.execution).toMatchObject({
      executedBy: { kind: 'account', address: location.swig },
      authority: { action: 'add', roleId: 2 },
    })

    const messages = facade.getTransactionMessages(prepared)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.scope).toMatchObject({ action: 'manageAuthority' })

    const signed = await facade.signTransaction(prepared)
    expect(signed.proofs).toHaveLength(1)
    const result = await facade.submitTransaction(signed)
    expect(submitIntent).toHaveBeenCalledWith({
      intentId: 'authority-intent',
      proofs: signed.proofs,
    })
    expect(result).toEqual({
      type: 'intent',
      id: 'authority-intent',
      traceId: 'submit-trace',
      sourceChains: [DEVNET_ID],
      targetChain: DEVNET_ID,
    })
    await expect(facade.waitForExecution(result)).resolves.toMatchObject({
      status: 'COMPLETED',
    })
    expect(waitForIntentStatus).toHaveBeenCalledWith('authority-intent')
  })

  test('omits the permission from a removal everywhere it persists', async () => {
    const { facade } = standalone()
    const prepared = await facade.prepareTransaction({
      chain: solanaDevnet,
      authority: removePasskey(added),
    })
    expect(prepared.execution).not.toHaveProperty('permission')
    expect(prepared.transaction).toStrictEqual({
      chain: solanaDevnet,
      authority: {
        action: 'remove',
        key: { type: 'passkey', publicKey: added },
      },
    })
    expect(prepared.intentInput.destinationAuthority).toStrictEqual({
      action: 'remove',
      key: { kind: 'secp256r1', publicKey: added },
    })
  })

  test('canonicalizes a literal change the same as a built one', async () => {
    const { facade, createQuote } = standalone()
    const prepared = await facade.prepareTransaction({
      chain: solanaDevnet,
      authority: {
        action: 'add',
        key: {
          type: 'passkey',
          publicKey: `0x${addedXy.slice(2).toUpperCase()}` as Hex,
        },
        permission: 'allButManageAuthority',
      },
    })
    expect(prepared.transaction).toStrictEqual({
      chain: solanaDevnet,
      authority: add(),
    })
    expect(
      (createQuote.mock.calls[0]?.[0] as OrchestratorIntentRequest).destination,
    ).toMatchObject({
      execution: { authority: { key: { publicKey: added } } },
    })
  })

  test('survives a JSON round trip and a second instance', async () => {
    const first = standalone()
    const prepared = await first.facade.prepareTransaction({
      chain: solanaDevnet,
      authority: add(),
    })
    const revived = JSON.parse(
      JSON.stringify(prepared, (_key, value) =>
        typeof value === 'bigint' ? { $bigint: value.toString() } : value,
      ),
      (_key, value) =>
        value && typeof value === 'object' && '$bigint' in value
          ? BigInt(value.$bigint)
          : value,
    )
    const second = standalone()
    const signed = await second.facade.signTransaction(revived)
    await second.facade.submitTransaction(signed)
    expect(second.submitIntent).toHaveBeenCalledOnce()
  })

  test.each([
    [
      'a different key',
      (p: any) => {
        p.transaction.authority.key.publicKey = `0x02${'11'.repeat(32)}`
      },
    ],
    [
      'a different permission',
      (p: any) => {
        p.transaction.authority.permission = 'all'
      },
    ],
    [
      'a different action',
      (p: any) => {
        p.transaction.authority = {
          action: 'remove',
          key: p.transaction.authority.key,
        }
      },
    ],
    [
      'tampered metadata',
      (p: any) => {
        p.execution.permission = 'all'
      },
    ],
    [
      'a tampered intent input',
      (p: any) => {
        p.intentInput.destinationAuthority.permission = 'all'
      },
    ],
  ])('refuses %s before signing', async (_name, tamper) => {
    const { facade } = standalone()
    const prepared = structuredClone(
      await facade.prepareTransaction({
        chain: solanaDevnet,
        authority: add(),
      }),
    )
    tamper(prepared)
    await expect(standalone().facade.signTransaction(prepared)).rejects.toThrow(
      InvalidSolanaTransactionArtifactError,
    )
  })

  test.each([
    ['instructions', { instructions: [] }],
    ['token requests', { tokenRequests: [] }],
    ['a recipient', { recipient: location.wallet }],
    ['sponsorship', { sponsored: true }],
    ['app fees', { appFees: { feeBps: 1 } }],
    ['protocol fees', { protocolFees: { feeBps: 1 } }],
    ['address lookup tables', { addressLookupTables: [] }],
  ])(
    'refuses an authority change with %s before quoting',
    async (_name, patch) => {
      const { facade, createQuote } = standalone()
      await expect(
        facade.prepareTransaction({
          chain: solanaDevnet,
          authority: add(),
          ...patch,
        } as never),
      ).rejects.toThrow(UnsupportedAccountCapabilityError)
      expect(createQuote).not.toHaveBeenCalled()
    },
  )

  test.each([
    ['not an object', 'add', 'authority'],
    ['an unknown action', { action: 'replace' }, 'authority.action'],
    ['an unknown field', { ...add(), roleId: 3 }, 'authority.roleId'],
    [
      'a permission on a removal',
      { ...removePasskey(added), permission: 'all' },
      'authority.permission',
    ],
    [
      'no permission on an add',
      { action: 'add', key: add().key },
      'authority.permission',
    ],
    [
      'an unknown permission',
      { ...add(), permission: 'manageAuthority' },
      'authority.permission',
    ],
    [
      'a non-passkey key',
      { ...add(), key: { type: 'ecdsa', publicKey: added } },
      'authority.key.type',
    ],
    [
      'an extra key field',
      { ...add(), key: { ...add().key, kind: 'secp256r1' } },
      'authority.key.kind',
    ],
    [
      'a malformed key',
      { ...add(), key: { type: 'passkey', publicKey: '0x1234' } },
      'authority.key.publicKey',
    ],
  ])('refuses %s', async (_name, authority, field) => {
    const { facade, createQuote } = standalone()
    const refusal = facade.prepareTransaction({
      chain: solanaDevnet,
      authority,
    } as never)
    await expect(refusal).rejects.toBeInstanceOf(
      UnsupportedAccountCapabilityError,
    )
    await expect(refusal).rejects.toMatchObject({
      context: { vm: 'solana', field },
    })
    expect(createQuote).not.toHaveBeenCalled()
  })

  test('surfaces a failed wait', async () => {
    const fake = workflows()
    fake.waitForIntentStatus.mockRejectedValueOnce(
      new IntentFailedError({ context: { intentId: 'authority-intent' } }),
    )
    const { facade } = standalone(fake)
    const prepared = await facade.prepareTransaction({
      chain: solanaDevnet,
      authority: add(),
    })
    const result = await facade.submitTransaction(
      await facade.signTransaction(prepared),
    )
    await expect(facade.waitForExecution(result)).rejects.toBeInstanceOf(
      IntentFailedError,
    )
  })

  test('surfaces a backend refusal as-is, without retrying', async () => {
    const refusal = parseErrorEnvelope(
      {
        code: 'VALIDATION_ERROR',
        message: 'no role',
        traceId: 'trace',
        details: [
          {
            message: 'no role',
            context: {
              code: 'UNSUPPORTED_ACCOUNT_TYPE',
              reason: 'role_not_found',
            },
          },
        ],
      },
      400,
    )
    const fake = workflows({ refuse: refusal })
    const { facade } = standalone(fake)
    await expect(
      facade.prepareTransaction({ chain: solanaDevnet, authority: add() }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fake.createQuote).toHaveBeenCalledOnce()
  })

  test('a passkey owner signs the change with one WebAuthn prompt', async () => {
    const { account: passkey, compressedPublicKey } = signingPasskey()
    const acting: SwigAuthority = {
      kind: 'secp256r1',
      publicKey: compressedPublicKey,
    }
    const sign = vi.fn(passkey.sign)
    const fake = workflows({
      acting,
      payload: { kind: 'webauthn', challenge },
      roleId: 3,
    })
    const { facade, submitIntent } = standalone(fake, {
      owner: { type: 'passkey', account: { ...passkey, sign } },
    })
    const prepared = await facade.prepareTransaction({
      chain: solanaDevnet,
      authority: removePasskey(added),
    })
    expect(prepared.execution).toMatchObject({ authority: compressedPublicKey })
    const signed = await facade.signTransaction(prepared)
    expect(sign).toHaveBeenCalledOnce()
    expect(sign).toHaveBeenCalledWith({ hash: challenge })
    await facade.submitTransaction(signed)
    expect(
      (submitIntent.mock.calls[0]?.[0] as { proofs?: unknown }).proofs,
    ).toEqual([expect.objectContaining({ kind: 'webauthn' })])
  })
})

describe('a passkey added to a Swig', () => {
  test('owns the same wallet and runs instructions through its own role', async () => {
    const { account: passkey, compressedPublicKey } = signingPasskey()
    const acting: SwigAuthority = {
      kind: 'secp256r1',
      publicKey: compressedPublicKey,
    }
    const fake = workflows()
    const createQuote = vi.fn(async (_request: OrchestratorIntentRequest) => {
      const view = {
        wallet: location.wallet,
        swigAccount: location.swig,
        authority: acting,
      }
      const quote = authorityQuote({
        chainId: solanaDevnet.caip2,
        wallet: location.wallet,
        swigAccount: location.swig,
        acting,
        disclosure: {} as never,
        payload: { kind: 'webauthn', challenge },
        roleId: 4,
      })
      const leg = {
        vm: 'svm' as const,
        chainId: solanaDevnet.caip2,
        account: view,
      }
      return {
        traceId: 'quote-trace',
        routes: [
          {
            ...quote,
            plan: { source: [leg], destination: leg, deployments: [] },
            signingRequests: [
              {
                ...quote.signingRequests[0]!,
                scope: {
                  vm: 'svm' as const,
                  action: 'spend' as const,
                  accounts: [
                    { chainId: solanaDevnet.caip2, address: location.wallet },
                  ],
                  instructions: [],
                  addressLookupTables: [],
                  feePayer: { kind: 'role' as const, role: 'relayer' as const },
                  slotWindow: { from: '100', to: '200' },
                },
              },
            ],
          },
        ],
      }
    })
    const context = {
      quoteClient: { createQuote },
      submissionClient: { submitIntent: fake.submitIntent },
      now,
    }
    const { facade } = standalone(
      {
        ...fake,
        createQuote,
        solana: {
          ...fake.solana,
          prepareSolanaIntent: vi.fn((input: SolanaTransferInput) =>
            prepareSolanaIntent(context as never, input),
          ),
        },
      },
      { owner: { type: 'passkey', account: passkey } },
    )
    expect(facade.getAddress('solana')).toBe(location.wallet)
    const prepared = await facade.prepareTransaction({
      chain: solanaDevnet,
      instructions: [{ programId: location.swig, accounts: [], data: 'AQID' }],
    })
    const request = createQuote.mock.calls[0]?.[0] as OrchestratorIntentRequest
    expect(request.account.svm?.authorization).toEqual(acting)
    expect(prepared.quotes.best.signingRequests[0]?.authority).toMatchObject({
      roleId: 4,
    })
  })
})

describe('Swig authority changes on a composite account', () => {
  function composite(fake = workflows()) {
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
      endpointUrl: DEV_ORCHESTRATOR_URL,
      useDevContracts: true,
    }
    const facade = createAccountFacade(
      compatibilityConfig,
      {
        evm: compatibilityConfig as EvmAccountConfig,
        solana: {
          owner: { type: 'ecdsa', account: owner },
          swig: location.swig,
        },
      },
      {
        config: sdk,
        project: {} as never,
        createAccount: (context) => ({
          context,
          workflows: {
            ...fake.solana,
            getAddress: () => owner.address,
            waitForIntentStatus: (_context: unknown, intentId: string) =>
              fake.waitForIntentStatus(intentId),
          } as never,
        }),
      },
    )
    return { facade, ...fake }
  }

  test('changes the Swig alone, never through the EVM account', async () => {
    const { facade, createQuote, submitIntent } = composite()
    const prepared = await facade.prepareTransaction({
      chain: solanaDevnet,
      authority: add(),
    })
    const request = createQuote.mock.calls[0]?.[0] as OrchestratorIntentRequest
    expect(request.account).not.toHaveProperty('evm')
    expect(request.account.svm).not.toHaveProperty('initData')
    expect(prepared.execution).toMatchObject({
      kind: 'solana-authority',
      accountAddress: location.wallet,
    })
    expect(prepared.execution).not.toHaveProperty('accountType')
    const result = await facade.submitTransaction(
      await facade.signTransaction(prepared),
    )
    expect(submitIntent).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      sourceChains: [DEVNET_ID],
      targetChain: DEVNET_ID,
    })
  })

  test('is refused on an account whose Solana entry only receives', async () => {
    const compatibilityConfig: LegacyAccountConfig<unknown> = {
      owners: { type: 'ecdsa', accounts: [owner] },
      endpointUrl: DEV_ORCHESTRATOR_URL,
      useDevContracts: true,
    }
    const facade = createAccountFacade(
      compatibilityConfig,
      {
        evm: compatibilityConfig as EvmAccountConfig,
        solana: { address: location.wallet },
      },
      {
        config: sdk,
        project: {} as never,
        createAccount: () => {
          throw new Error('must not run')
        },
      },
    )
    await expect(
      facade.prepareTransaction({
        chain: solanaDevnet,
        authority: add(),
      } as never),
    ).rejects.toThrow(/managed Solana source is required/)
  })
})
