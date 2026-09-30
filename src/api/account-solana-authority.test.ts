import { p256 } from '@noble/curves/nist'
import { secp256k1 } from '@noble/curves/secp256k1'
import {
  type Account,
  bytesToHex,
  type Hex,
  hexToBytes,
  recoverMessageAddress,
} from 'viem'
import { privateKeyToAccount, toAccount } from 'viem/accounts'
import { describe, expect, test, vi } from 'vitest'
import { authorityQuote } from '../../test/utils/caucasus'
import { signingPasskey } from '../../test/utils/passkeys'
import { asSwigNamespace, locateSwig } from '../accounts/solana/address'
import {
  addEcdsaKey,
  addPasskey,
  removeEcdsaKey,
  removePasskey,
} from '../actions/solana'
import { solanaDevnet } from '../chains/non-evm'
import {
  parseErrorEnvelope,
  SolanaAccountNotCreatedError,
  SolanaAuthorityChangeRefusedError,
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
  SolanaQuoteExpiredError,
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
    readonly expiresAt?: number
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
          ...(options.expiresAt === undefined
            ? {}
            : { expiresAt: options.expiresAt }),
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
      | { type: 'ecdsa'; account: Account }
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
      keyType: 'passkey',
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
      'a tampered key type',
      (p: any) => {
        p.execution.keyType = 'ecdsa'
      },
    ],
    [
      'a tampered transaction key type',
      (p: any) => {
        p.transaction.authority.key.type = 'ecdsa'
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
      { ...add(), permission: 'programAll' },
      'authority.permission',
    ],
    [
      'an unknown key type',
      { ...add(), key: { type: 'ed25519', publicKey: added } },
      'authority.key.type',
    ],
    [
      'an EVM address as an ECDSA key',
      { ...add(), key: { type: 'ecdsa', publicKey: owner.address } },
      'authority.key.publicKey',
    ],
    [
      'an uncompressed P-256 key as an ECDSA key',
      {
        ...add(),
        key: {
          type: 'ecdsa',
          publicKey: bytesToHex(p256.getPublicKey(secret, false)),
        },
      },
      'authority.key.publicKey',
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

  test('checks authority status through the managed Solana entry', async () => {
    const { facade, submitIntent } = composite(
      workflows({
        refuse: refusal({
          reason: 'authority_exists',
          roleId: 1,
          permission: 'manageAuthority',
        }),
      }),
    )
    await expect(
      facade.getAuthorityStatus({ chain: solanaDevnet, authority: enroll() }),
    ).resolves.toStrictEqual({ status: 'applied', roleId: 1 })
    expect(submitIntent).not.toHaveBeenCalled()
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
    await expect(
      (facade as never as SolanaStatusReader).getAuthorityStatus({
        chain: solanaDevnet,
        authority: add(),
      }),
    ).rejects.toThrow(/managed Solana source is not configured/)
  })
})

type SolanaStatusReader = {
  getAuthorityStatus(transaction: unknown): Promise<unknown>
}

// The recovery key: secp256k1, its compressed encoding computed by noble.
const recoverySecret = `0x${'56'.repeat(32)}` as Hex
const recovery = privateKeyToAccount(recoverySecret)
const recoveryKey = bytesToHex(
  secp256k1.getPublicKey(hexToBytes(recoverySecret), true),
) as Hex
const enroll = () =>
  addEcdsaKey(recovery.publicKey, { permission: 'manageAuthority' })

function refusal(context: Record<string, unknown>) {
  return parseErrorEnvelope(
    {
      code: 'VALIDATION_ERROR',
      message: 'refused',
      traceId: 'trace',
      details: [
        {
          message: 'refused',
          context: {
            swig: location.swig,
            ...context,
            domain: 'strategy-gate',
            code: 'SWIG_AUTHORITY_CHANGE_REFUSED',
          },
        },
      ],
    },
    400,
  )
}

/** A viem custom account: the signer is external and exposes no private or public key. */
function externalSigner(signMessage = vi.fn(recovery.signMessage)) {
  const account = toAccount({
    address: recovery.address,
    signMessage,
    signTransaction: async () => {
      throw new Error('not used')
    },
    signTypedData: async () => {
      throw new Error('not used')
    },
  })
  return { account, signMessage }
}

describe('enrolling a recovery key on a passkey-root Swig', () => {
  const { account: root, compressedPublicKey } = signingPasskey()
  const rootAuthority: SwigAuthority = {
    kind: 'secp256r1',
    publicKey: compressedPublicKey,
  }

  function passkeyRoot(options: { readonly expiresAt?: number } = {}) {
    const sign = vi.fn(root.sign)
    const fake = workflows({
      acting: rootAuthority,
      payload: { kind: 'webauthn', challenge },
      ...options,
    })
    return {
      sign,
      ...standalone(fake, {
        owner: { type: 'passkey', account: { ...root, sign } },
      }),
    }
  }

  test('adds a manage-only secp256k1 key with one WebAuthn prompt', async () => {
    const { facade, createQuote, submitIntent, sign } = passkeyRoot()
    const prepared = await facade.prepareTransaction({
      chain: solanaDevnet,
      authority: enroll(),
    })
    const request = createQuote.mock.calls[0]?.[0] as OrchestratorIntentRequest
    expect(request.destination).toMatchObject({
      execution: {
        authority: {
          action: 'add',
          key: { kind: 'secp256k1', publicKey: recoveryKey },
          permission: 'manageAuthority',
        },
      },
    })
    expect(request.account.svm?.authorization).toEqual(rootAuthority)
    expect(prepared.execution).toMatchObject({
      kind: 'solana-authority',
      authority: compressedPublicKey,
      action: 'add',
      keyType: 'ecdsa',
      key: recoveryKey,
      permission: 'manageAuthority',
    })
    expect(prepared.transaction).toStrictEqual({
      chain: solanaDevnet,
      authority: {
        action: 'add',
        key: { type: 'ecdsa', publicKey: recoveryKey },
        permission: 'manageAuthority',
      },
    })
    const signed = await facade.signTransaction(prepared)
    expect(sign).toHaveBeenCalledOnce()
    expect(sign).toHaveBeenCalledWith({ hash: challenge })
    await facade.submitTransaction(signed)
    expect(submitIntent).toHaveBeenCalledOnce()
    expect(
      (submitIntent.mock.calls[0]?.[0] as { proofs?: unknown[] }).proofs,
    ).toEqual([expect.objectContaining({ kind: 'webauthn' })])
  })

  test('canonicalizes a literal ECDSA change the same as a built one', async () => {
    const { facade } = passkeyRoot()
    const prepared = await facade.prepareTransaction({
      chain: solanaDevnet,
      authority: {
        action: 'add',
        key: {
          type: 'ecdsa',
          publicKey: `0x${recovery.publicKey.slice(4).toUpperCase()}` as Hex,
        },
        permission: 'manageAuthority',
      },
    })
    expect(prepared.transaction).toStrictEqual({
      chain: solanaDevnet,
      authority: enroll(),
    })
  })

  test('refuses an expired quote before prompting', async () => {
    const { facade, sign, submitIntent } = passkeyRoot({
      expiresAt: 1_800_000_000,
    })
    const prepared = await facade.prepareTransaction({
      chain: solanaDevnet,
      authority: enroll(),
    })
    await expect(facade.signTransaction(prepared)).rejects.toBeInstanceOf(
      SolanaQuoteExpiredError,
    )
    expect(sign).not.toHaveBeenCalled()
    expect(submitIntent).not.toHaveBeenCalled()
  })

  test('removes the key by its public key', async () => {
    const { facade } = passkeyRoot()
    const prepared = await facade.prepareTransaction({
      chain: solanaDevnet,
      authority: removeEcdsaKey(recovery),
    })
    expect(prepared.intentInput.destinationAuthority).toStrictEqual({
      action: 'remove',
      key: { kind: 'secp256k1', publicKey: recoveryKey },
    })
    expect(prepared.execution).toMatchObject({
      keyType: 'ecdsa',
      key: recoveryKey,
    })
    expect(prepared.execution).not.toHaveProperty('permission')
  })

  test('survives a JSON round trip and signs on a second instance', async () => {
    const first = passkeyRoot()
    const prepared = await first.facade.prepareTransaction({
      chain: solanaDevnet,
      authority: enroll(),
    })
    const second = passkeyRoot()
    const signed = await second.facade.signTransaction(
      JSON.parse(JSON.stringify(prepared)),
    )
    await second.facade.submitTransaction(signed)
    expect(second.sign).toHaveBeenCalledOnce()
    expect(second.submitIntent).toHaveBeenCalledOnce()
  })
})

describe('acting through a manage-only recovery key', () => {
  const managerAuthority: SwigAuthority = {
    kind: 'secp256k1',
    address: recovery.address,
  }

  test('an external signer adds a passkey to the same Swig', async () => {
    const { account, signMessage } = externalSigner()
    const fake = workflows({ acting: managerAuthority, roleId: 1 })
    const { facade, createQuote, submitIntent } = standalone(fake, {
      owner: { type: 'ecdsa', account },
    })
    expect(facade.getAddress('solana')).toBe(location.wallet)
    const prepared = await facade.prepareTransaction({
      chain: solanaDevnet,
      authority: addPasskey(addedXy, { permission: 'all' }),
    })
    const request = createQuote.mock.calls[0]?.[0] as OrchestratorIntentRequest
    expect(request.account.svm?.authorization).toEqual(managerAuthority)
    expect(request.destination).toMatchObject({
      execution: {
        authority: {
          action: 'add',
          key: { kind: 'secp256r1', publicKey: added },
          permission: 'all',
        },
      },
    })
    const signed = await facade.signTransaction(prepared)
    expect(signMessage).toHaveBeenCalledOnce()
    expect(signMessage).toHaveBeenCalledWith({ message })
    const [proof] = signed.proofs as [{ kind: string; signature: Hex }]
    expect(proof.kind).toBe('personalSign')
    await expect(
      recoverMessageAddress({ message, signature: proof.signature }),
    ).resolves.toBe(recovery.address)
    await facade.submitTransaction(signed)
    expect(submitIntent).toHaveBeenCalledOnce()
  })

  test('a rejecting external signer submits nothing', async () => {
    const rejection = new Error('enclave refused')
    const { account } = externalSigner(
      vi.fn(async () => {
        throw rejection
      }),
    )
    const fake = workflows({ acting: managerAuthority, roleId: 1 })
    const { facade, submitIntent } = standalone(fake, {
      owner: { type: 'ecdsa', account },
    })
    const prepared = await facade.prepareTransaction({
      chain: solanaDevnet,
      authority: addPasskey(addedXy, { permission: 'all' }),
    })
    await expect(facade.signTransaction(prepared)).rejects.toBe(rejection)
    expect(submitIntent).not.toHaveBeenCalled()
  })

  test('its own spend is refused by the orchestrator before signing', async () => {
    const roleRefusal = parseErrorEnvelope(
      {
        code: 'VALIDATION_ERROR',
        message: 'role cannot spend',
        traceId: 'trace',
        details: [
          {
            message: 'role cannot spend',
            context: {
              code: 'UNSUPPORTED_ACCOUNT_TYPE',
              reason: 'role_permission',
            },
          },
        ],
      },
      400,
    )
    const { account, signMessage } = externalSigner()
    const fake = workflows({ refuse: roleRefusal })
    const { facade, submitIntent } = standalone(fake, {
      owner: { type: 'ecdsa', account },
    })
    const refused = facade.prepareTransaction({
      chain: solanaDevnet,
      instructions: [{ programId: location.swig, accounts: [], data: 'AQID' }],
    })
    await expect(refused).rejects.toBeInstanceOf(ValidationError)
    await expect(refused).rejects.toMatchObject({
      issues: [
        {
          context: {
            code: 'UNSUPPORTED_ACCOUNT_TYPE',
            reason: 'role_permission',
          },
        },
      ],
    })
    expect(signMessage).not.toHaveBeenCalled()
    expect(submitIntent).not.toHaveBeenCalled()
  })
})

describe('getAuthorityStatus', () => {
  function withRefusal(refuse?: unknown) {
    const fake = workflows(refuse ? { refuse } : {})
    const signMessage = vi.fn(owner.signMessage)
    return {
      signMessage,
      ...standalone(fake, {
        owner: { type: 'ecdsa', account: { ...owner, signMessage } },
      }),
    }
  }

  test.each(['all', 'allButManageAuthority', 'manageAuthority'] as const)(
    'reports an add already holding %s as applied',
    async (permission) => {
      const { facade } = withRefusal(
        refusal({ reason: 'authority_exists', roleId: 1, permission }),
      )
      await expect(
        facade.getAuthorityStatus({
          chain: solanaDevnet,
          authority: addEcdsaKey(recoveryKey, { permission }),
        }),
      ).resolves.toStrictEqual({ status: 'applied', roleId: 1 })
    },
  )

  test('reports the key on another permission as a conflict', async () => {
    const { facade } = withRefusal(
      refusal({
        reason: 'authority_exists',
        roleId: 1,
        permission: 'manageAuthority',
      }),
    )
    await expect(
      facade.getAuthorityStatus({
        chain: solanaDevnet,
        authority: addEcdsaKey(recoveryKey, { permission: 'all' }),
      }),
    ).resolves.toStrictEqual({
      status: 'conflict',
      roleId: 1,
      permission: 'manageAuthority',
    })
  })

  test('reports the key on an unreadable permission as a conflict', async () => {
    const { facade } = withRefusal(
      refusal({ reason: 'authority_exists', roleId: 4 }),
    )
    await expect(
      facade.getAuthorityStatus({ chain: solanaDevnet, authority: enroll() }),
    ).resolves.toStrictEqual({ status: 'conflict', roleId: 4 })
  })

  test('reports a quotable change as not applied, without signing or submitting', async () => {
    const { facade, createQuote, submitIntent, signMessage } = withRefusal()
    await expect(
      facade.getAuthorityStatus({ chain: solanaDevnet, authority: enroll() }),
    ).resolves.toStrictEqual({ status: 'notApplied' })
    expect(createQuote).toHaveBeenCalledOnce()
    expect(signMessage).not.toHaveBeenCalled()
    expect(submitIntent).not.toHaveBeenCalled()
  })

  test('reports a removal of a missing key as applied', async () => {
    const { facade } = withRefusal(refusal({ reason: 'authority_not_found' }))
    await expect(
      facade.getAuthorityStatus({
        chain: solanaDevnet,
        authority: removeEcdsaKey(recoveryKey),
      }),
    ).resolves.toStrictEqual({ status: 'applied' })
  })

  test('reports a removal still to make as not applied', async () => {
    const { facade } = withRefusal()
    await expect(
      facade.getAuthorityStatus({
        chain: solanaDevnet,
        authority: removePasskey(added),
      }),
    ).resolves.toStrictEqual({ status: 'notApplied' })
  })

  test.each([
    ['acting_permission', refusal({ reason: 'acting_permission', roleId: 1 })],
    ['root_role', refusal({ reason: 'root_role', roleId: 0 })],
    ['an unknown reason', refusal({ reason: 'future_reason' })],
    [
      'authority_exists without a role id',
      refusal({ reason: 'authority_exists', permission: 'manageAuthority' }),
    ],
    [
      'authority_not_found on an add',
      refusal({ reason: 'authority_not_found' }),
    ],
    [
      'a refusal naming another Swig',
      refusal({
        reason: 'authority_exists',
        roleId: 1,
        permission: 'manageAuthority',
        swig: '11111111111111111111111111111112',
      }),
    ],
    [
      'an uncreated Swig',
      new SolanaAccountNotCreatedError({
        code: 'VALIDATION_ERROR',
        message: 'no swig',
        statusCode: 400,
      } as never),
    ],
    ['a network error', new TypeError('fetch failed')],
  ])('rethrows %s', async (_name, error) => {
    const { facade } = withRefusal(error)
    await expect(
      facade.getAuthorityStatus({ chain: solanaDevnet, authority: enroll() }),
    ).rejects.toBe(error)
  })

  test('rethrows authority_exists on a removal', async () => {
    const error = refusal({ reason: 'authority_exists', roleId: 1 })
    const { facade } = withRefusal(error)
    await expect(
      facade.getAuthorityStatus({
        chain: solanaDevnet,
        authority: removeEcdsaKey(recoveryKey),
      }),
    ).rejects.toBe(error)
    expect(error).toBeInstanceOf(SolanaAuthorityChangeRefusedError)
  })

  test.each([
    [
      'a transfer',
      { chain: solanaDevnet, tokenRequests: [], recipient: location.wallet },
    ],
    ['nothing', undefined],
    [
      'a malformed change',
      { chain: solanaDevnet, authority: { action: 'add' } },
    ],
  ])('refuses %s before quoting', async (_name, transaction) => {
    const { facade, createQuote } = withRefusal()
    await expect(
      facade.getAuthorityStatus(transaction as never),
    ).rejects.toBeInstanceOf(UnsupportedAccountCapabilityError)
    expect(createQuote).not.toHaveBeenCalled()
  })

  test('resolves an uncertain submit without resubmitting', async () => {
    const fake = workflows()
    fake.submitIntent.mockRejectedValueOnce(new TypeError('socket hang up'))
    const { facade, submitIntent, createQuote } = standalone(fake)
    const change = { chain: solanaDevnet, authority: enroll() }
    const signed = await facade.signTransaction(
      await facade.prepareTransaction(change),
    )
    await expect(facade.submitTransaction(signed)).rejects.toThrow(
      'socket hang up',
    )
    // The change landed; the orchestrator now refuses to quote it again.
    createQuote.mockRejectedValueOnce(
      refusal({
        reason: 'authority_exists',
        roleId: 1,
        permission: 'manageAuthority',
      }),
    )
    await expect(facade.getAuthorityStatus(change)).resolves.toStrictEqual({
      status: 'applied',
      roleId: 1,
    })
    expect(submitIntent).toHaveBeenCalledOnce()
  })
})
