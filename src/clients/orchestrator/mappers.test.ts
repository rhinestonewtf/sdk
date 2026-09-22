import { describe, expect, test } from 'vitest'
import {
  mapIntentRequestToWire,
  mapIntentStatusFromWire,
  mapQuoteResponseFromWire,
  mapSignedIntentToWire,
  mapSigningRequestFromWire,
} from './mappers'
import type {
  OrchestratorIntentRequest,
  OrchestratorSignedIntent,
} from './types'

const address = '0x0000000000000000000000000000000000000001' as const
const BASE = 'eip155:8453'
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'

const typedData = {
  domain: { chainId: 1, verifyingContract: address },
  types: { Test: [{ name: 'value', type: 'uint256' }] },
  primaryType: 'Test',
  message: { value: '1' },
}

function signingRequest(payload: unknown) {
  return {
    account: { vm: 'evm', address },
    authority: { kind: 'account', vm: 'evm', address },
    scope: { vm: 'evm', action: 'claim', accounts: [] },
    chainIds: [BASE],
    purpose: 'originAuthorization',
    validity: [],
    payload,
  }
}

function route(overrides: Record<string, unknown> = {}) {
  return {
    intentId: 'intent-1',
    purpose: 'execution',
    expiresAt: 1,
    estimatedFillTime: { seconds: 1 },
    settlementLayer: 'SAME_CHAIN',
    plan: { source: [], destination: {}, deployments: [] },
    cost: {
      input: [],
      output: [],
      fees: { total: { usd: 0 }, breakdown: {} },
    },
    requirements: [],
    signingRequests: [
      signingRequest({ kind: 'eip712', typedData, signatureFormat: 'account' }),
    ],
    ...overrides,
  }
}

describe('mapQuoteResponseFromWire', () => {
  test('parses the quoted outcome', () => {
    const mapped = mapQuoteResponseFromWire({
      status: 'quoted',
      traceId: 'trace',
      routes: [route()],
    } as never)

    expect(mapped.traceId).toBe('trace')
    expect(mapped.routes).toHaveLength(1)
    expect(mapped.routes[0]?.signingRequests[0]?.payload).toEqual({
      kind: 'eip712',
      typedData,
      signatureFormat: 'account',
    })
  })

  // A reserved future outcome carries no routes. Reading it as an empty success
  // would report "no route available" for a quote the orchestrator did answer.
  test('refuses an outcome it does not recognise instead of reading it as empty', () => {
    expect(() =>
      mapQuoteResponseFromWire({ status: 'deferred', routes: [] } as never),
    ).toThrow(/unsupported quote outcome: deferred/)
  })

  test('converts requirement and cost amounts to bigint', () => {
    const mapped = mapQuoteResponseFromWire({
      status: 'quoted',
      routes: [
        route({
          requirements: [
            {
              kind: 'erc20Approval',
              vm: 'evm',
              chainId: BASE,
              account: { address, type: 'erc7579' },
              tokenAddress: address,
              amount: '1000',
              spender: address,
            },
          ],
          cost: {
            input: [
              {
                chainId: SOLANA,
                tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                symbol: 'USDC',
                decimals: 6,
                price: { usd: 1 },
                amount: '100000',
              },
            ],
            output: [],
            fees: { total: { usd: 0 }, breakdown: {} },
          },
        }),
      ],
    } as never)

    expect(mapped.routes[0]?.requirements[0]?.amount).toBe(1000n)
    const cost = mapped.routes[0]?.cost.input[0]
    // Native identity survives: a CAIP-2 chain and a case-sensitive base58 mint.
    expect(cost?.chainId).toBe(SOLANA)
    expect(cost?.tokenAddress).toBe(
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    )
    expect(cost?.amount).toBe(100000n)
  })

  test('preserves optional Swig authority across plan and requirement disclosures', () => {
    const wallet = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
    const swigAccount = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const passkey = `0x02${'11'.repeat(32)}`
    const withoutAuthority = { wallet, swigAccount }
    const mapped = mapQuoteResponseFromWire({
      status: 'quoted',
      traceId: 'trace',
      routes: [
        route({
          plan: {
            source: [{ vm: 'svm', chainId: SOLANA, account: withoutAuthority }],
            destination: {
              vm: 'svm',
              chainId: SOLANA,
              account: {
                wallet,
                swigAccount,
                authority: { kind: 'secp256k1', address },
              },
            },
            deployments: [
              {
                vm: 'svm',
                chainId: SOLANA,
                account: {
                  wallet,
                  swigAccount,
                  authority: { kind: 'secp256r1', publicKey: passkey },
                },
              },
            ],
          },
          requirements: [
            {
              kind: 'wrapNative',
              vm: 'svm',
              chainId: SOLANA,
              account: withoutAuthority,
              tokenAddress: 'So11111111111111111111111111111111111111112',
              amount: '1',
            },
          ],
        }),
      ],
    } as never)

    const plan = mapped.routes[0]?.plan
    expect(plan?.source[0]?.account).not.toHaveProperty('authority')
    expect(plan?.destination.account).toHaveProperty('authority', {
      kind: 'secp256k1',
      address,
    })
    expect(plan?.deployments[0]?.account).toHaveProperty('authority', {
      kind: 'secp256r1',
      publicKey: passkey,
    })
    expect(mapped.routes[0]?.requirements[0]?.account).not.toHaveProperty(
      'authority',
    )
  })

  test('drops an unknown bridge fill without failing the quote', () => {
    const mapped = mapQuoteResponseFromWire({
      status: 'quoted',
      routes: [
        route({ bridgeFill: { type: 'FUTURE', destinationChainId: BASE } }),
      ],
    } as never)
    expect(mapped.routes[0]?.bridgeFill).toBeUndefined()
  })

  test('keeps a bridge fill chain reference as CAIP-2', () => {
    const mapped = mapQuoteResponseFromWire({
      status: 'quoted',
      routes: [
        route({
          bridgeFill: {
            type: 'RELAY',
            destinationChainId: BASE,
            fillStatusTimeout: 30,
            requestId: 'req-1',
          },
        }),
      ],
    } as never)
    expect(mapped.routes[0]?.bridgeFill).toMatchObject({
      type: 'RELAY',
      destinationChainId: BASE,
      requestId: 'req-1',
    })
  })
})

describe('mapSigningRequestFromWire', () => {
  test('accepts every supported payload kind', () => {
    expect(
      mapSigningRequestFromWire(
        signingRequest({
          kind: 'personalSign',
          message: { encoding: 'utf8', value: 'ab'.repeat(32) },
        }),
      ).payload.kind,
    ).toBe('personalSign')
    expect(
      mapSigningRequestFromWire(
        signingRequest({
          kind: 'eip7702',
          authorization: { chainId: 8453, address },
        }),
      ).payload.kind,
    ).toBe('eip7702')
    expect(
      mapSigningRequestFromWire(
        signingRequest({ kind: 'webauthn', challenge: '0xaa' }),
      ).payload.kind,
    ).toBe('webauthn')
  })

  // Narrowing an unknown variant onto a familiar one would sign something other
  // than what the request describes.
  test.each([
    [
      'payload kind',
      signingRequest({ kind: 'blsAggregate' }),
      /unsupported signing payload kind: blsAggregate/,
    ],
    [
      'authority',
      {
        ...signingRequest({ kind: 'webauthn', challenge: '0x' }),
        authority: { kind: 'schnorr' },
      },
      /unsupported authority: schnorr/,
    ],
    [
      'account vm',
      {
        ...signingRequest({ kind: 'webauthn', challenge: '0x' }),
        account: { vm: 'mvm', address },
      },
      /unsupported account: mvm/,
    ],
    [
      'scope vm',
      {
        ...signingRequest({ kind: 'webauthn', challenge: '0x' }),
        scope: { vm: 'mvm' },
      },
      /unsupported scope: mvm/,
    ],
    [
      'purpose',
      {
        ...signingRequest({ kind: 'webauthn', challenge: '0x' }),
        purpose: 'refundAuthorization',
      },
      /unsupported purpose: refundAuthorization/,
    ],
  ])('refuses an unsupported %s', (_name, value, matcher) => {
    expect(() => mapSigningRequestFromWire(value as never)).toThrow(matcher)
  })

  test('accepts either Swig role authority and refuses any other', () => {
    const swigRole = (authority: unknown) => ({
      ...signingRequest({
        kind: 'webauthn',
        challenge: `0x${'aa'.repeat(32)}`,
      }),
      authority: { kind: 'swigRole', roleId: 1, authority },
    })
    const passkey = { kind: 'secp256r1', publicKey: `0x02${'11'.repeat(32)}` }

    expect(mapSigningRequestFromWire(swigRole(passkey)).authority).toEqual({
      kind: 'swigRole',
      roleId: 1,
      authority: passkey,
    })
    expect(
      mapSigningRequestFromWire(swigRole({ kind: 'secp256k1', address }))
        .authority,
    ).toMatchObject({ authority: { kind: 'secp256k1', address } })
    expect(() =>
      mapSigningRequestFromWire(
        swigRole({ kind: 'ed25519', publicKey: 'base58' }),
      ),
    ).toThrow(/unsupported Swig role authority: ed25519/)
    expect(() =>
      mapSigningRequestFromWire(swigRole({ kind: 'secp256r1' })),
    ).toThrow(/unsupported Swig role authority: secp256r1/)
    expect(() => mapSigningRequestFromWire(swigRole(undefined))).toThrow(
      /unsupported Swig role authority: undefined/,
    )
  })

  test('refuses a malformed EIP-712 payload', () => {
    expect(() =>
      mapSigningRequestFromWire(
        signingRequest({
          kind: 'eip712',
          typedData: { domain: {}, types: {}, primaryType: 1, message: {} },
          signatureFormat: 'account',
        }),
      ),
    ).toThrow(/invalid EIP-712 signing payload/)
  })

  test('refuses an EIP-712 payload with an unknown signature format', () => {
    expect(() =>
      mapSigningRequestFromWire(
        signingRequest({ kind: 'eip712', typedData, signatureFormat: 'bls' }),
      ),
    ).toThrow(/invalid EIP-712 signing payload/)
  })
})

describe('mapSignedIntentToWire', () => {
  const signed: OrchestratorSignedIntent = {
    intentId: 'intent-1',
    proofs: [
      { kind: 'eip712', signature: '0x03' },
      {
        kind: 'eip712',
        signature: { preClaim: '0x04', notarizedClaim: '0x05' },
      },
      {
        kind: 'eip7702',
        nonce: 7,
        signature: { r: '0x01', s: '0x02', yParity: 1 },
      },
    ],
  }

  test('sends the intent id and the ordered proofs, and nothing else', () => {
    expect(mapSignedIntentToWire(signed)).toEqual({
      intentId: 'intent-1',
      proofs: signed.proofs,
    })
  })

  test('preserves proof order', () => {
    const wire = mapSignedIntentToWire(signed)
    expect(wire.proofs.map(({ kind }) => kind)).toEqual([
      'eip712',
      'eip712',
      'eip7702',
    ])
  })

  test('sends the dry-run option only when requested', () => {
    expect(mapSignedIntentToWire(signed)).not.toHaveProperty('options')
    expect(mapSignedIntentToWire({ ...signed, dryRun: true }).options).toEqual({
      dryRun: true,
    })
  })
})

describe('mapIntentRequestToWire', () => {
  const base: OrchestratorIntentRequest = {
    account: { evm: { type: 'erc7579', address, signatureMode: 1 } },
    destination: {
      vm: 'evm',
      chainId: BASE,
      tokenRequests: [{ tokenAddress: address, amount: 1_000_000n }],
    },
  }

  test('serializes bigints and keeps the native envelope shape', () => {
    const wire = mapIntentRequestToWire(base) as unknown as Record<
      string,
      never
    >
    expect(wire).toEqual({
      account: { evm: { type: 'erc7579', address, signatureMode: 1 } },
      destination: {
        vm: 'evm',
        chainId: BASE,
        tokenRequests: [{ tokenAddress: address, amount: '1000000' }],
      },
    })
  })

  test('omits source and options when the request carries none', () => {
    const wire = mapIntentRequestToWire(base) as unknown as Record<
      string,
      unknown
    >
    expect(wire).not.toHaveProperty('source')
    expect(wire).not.toHaveProperty('options')
  })

  test('carries a quoter pin through, including an empty fail-closed filter', () => {
    // An empty filter is how conflicting per-chain session scopes say "no venue
    // can serve this". Dropping it here would turn a fail-closed request back
    // into an unconstrained one.
    const wire = mapIntentRequestToWire({
      ...base,
      options: { quoters: { include: [] } },
    }) as { options?: { quoters?: unknown } }
    expect(wire.options?.quoters).toEqual({ include: [] })
  })

  // Instruction bytes and account order decide what the wallet executes, so the
  // mapper must not touch them; base58 is case-sensitive.
  test('carries Solana instructions and lookup tables through verbatim', () => {
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const recipient = 'EEnKdeMRGrhKq1Z2rkRubkrkTxCZigLZ5QgUYqAMvPnU'
    const instructions = [
      {
        programId: mint,
        accounts: [
          { pubkey: recipient, isSigner: true, isWritable: false },
          { pubkey: mint, isSigner: false, isWritable: true },
        ],
        data: 'AQID',
      },
    ]
    const wire = mapIntentRequestToWire({
      ...base,
      destination: {
        vm: 'svm',
        chainId: SOLANA,
        tokenRequests: [],
        execution: { instructions, addressLookupTables: [recipient] },
      },
    }) as unknown as { destination: Record<string, unknown> }

    expect(wire.destination.execution).toEqual({
      instructions,
      addressLookupTables: [recipient],
    })
  })

  // The agent authorising a HyperCore action is derived from these bytes, so
  // normalising or reordering anything would forge a different agent.
  test('carries HyperCore actions to the wire byte for byte', () => {
    const action = {
      type: 'order' as const,
      orders: [
        {
          a: 0,
          b: true,
          p: '64572',
          s: '0.00155',
          r: false,
          t: { limit: { tif: 'Ioc' as const } },
        },
      ],
      grouping: 'na' as const,
    }
    const wire = mapIntentRequestToWire({
      ...base,
      destination: {
        vm: 'hypercore',
        chainId: 'hypercore:perp',
        tokenRequests: [],
        execution: { actions: [action] },
      },
    }) as unknown as { destination: { execution?: { actions?: unknown } } }

    expect(JSON.stringify(wire.destination.execution?.actions)).toBe(
      JSON.stringify([action]),
    )
  })
})

describe('mapIntentStatusFromWire', () => {
  const evmTx = {
    vm: 'evm',
    chainId: BASE,
    txHash:
      '0x8e483d74ff15e79f86e0c23e81444a5db5b2ce31c9ec28f84259dfc83f0bbc28',
  }

  const status = (overrides: Record<string, unknown> = {}) => ({
    traceId: 'trace-1',
    intentId: 'intent-1',
    purpose: 'execution',
    status: 'COMPLETED',
    operations: [
      {
        chainId: BASE,
        items: [
          {
            type: 'CLAIM',
            status: 'COMPLETED',
            transaction: evmTx,
            debitsAccount: true,
          },
          { type: 'FILL', status: 'COMPLETED', transaction: evmTx },
        ],
      },
    ],
    refunds: [],
    ...overrides,
  })

  // Caucasus reports every item; a chain can carry a claim and a fill, and
  // flattening to one entry would hide which of them debited the account.
  test('keeps every item in a chain group', () => {
    const mapped = mapIntentStatusFromWire('intent-1', status())
    expect(mapped.operations).toHaveLength(1)
    expect(mapped.operations[0]?.items).toHaveLength(2)
    expect(mapped.operations[0]?.items[0]).toMatchObject({
      type: 'CLAIM',
      debitsAccount: true,
    })
  })

  test('preserves native transaction identity per VM', () => {
    const signature =
      '5KtPn1LGuxhFiKZ9xVLYBu9A2yBqX6gB4XzYGVxV9Dszgvn6YxrY3JQSMNJ4e6d7S5kJqY2LxA2nCE4BrVQCLH5m'
    const mapped = mapIntentStatusFromWire(
      'intent-1',
      status({
        operations: [
          {
            chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
            items: [
              {
                type: 'FILL',
                status: 'COMPLETED',
                transaction: {
                  vm: 'svm',
                  chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
                  signature,
                },
              },
            ],
          },
        ],
      }),
    )
    expect(mapped.operations[0]?.items[0]).toMatchObject({
      transaction: { vm: 'svm', signature },
    })
  })

  // An intent recorded before the registry knew a chain keeps its numeric id.
  // Inventing a CAIP-2 identity, or dropping the record, loses the only
  // evidence the transaction happened.
  test('preserves a historical numeric chain and its unknown-VM transaction', () => {
    const mapped = mapIntentStatusFromWire(
      'intent-1',
      status({
        operations: [
          {
            chainId: 424242,
            items: [
              {
                type: 'CLAIM',
                status: 'COMPLETED',
                transaction: { vm: 'unknown', chainId: 424242, id: 'tx-1' },
              },
            ],
          },
        ],
      }),
    )
    expect(mapped.operations[0]?.chainId).toBe(424242)
    expect(mapped.operations[0]?.items[0]).toMatchObject({
      transaction: { vm: 'unknown', chainId: 424242, id: 'tx-1' },
    })
  })

  // Not a transaction: nothing was broadcast, so it has a result rather than a
  // hash, and it sits alongside the settlement transaction rather than
  // replacing a top-level field.
  test('keeps a HyperCore execution as an operation item with its outcome', () => {
    const mapped = mapIntentStatusFromWire(
      'intent-1',
      status({
        status: 'FAILED',
        operations: [
          {
            chainId: 'hypercore:perp',
            items: [
              {
                type: 'EXECUTION',
                status: 'FAILED',
                result: {
                  vm: 'hypercore',
                  outcome: 'partial',
                  reason: 'action 0 accepted; action 1 refused',
                },
              },
            ],
          },
        ],
      }),
    )
    expect(mapped.operations[0]?.items[0]).toMatchObject({
      type: 'EXECUTION',
      result: { outcome: 'partial' },
    })
    expect(mapped).not.toHaveProperty('hyperCore')
  })

  test('leaves accounts absent rather than fabricating a zero address', () => {
    const mapped = mapIntentStatusFromWire('intent-1', status())
    expect('accounts' in mapped).toBe(false)
  })

  test('surfaces native per-VM accounts when the record has them', () => {
    const wallet = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
    const swigAccount = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const publicKey = `0x02${'11'.repeat(32)}`
    const mapped = mapIntentStatusFromWire(
      'intent-1',
      status({
        accounts: [
          {
            vm: 'evm',
            chainId: BASE,
            account: { address, type: 'erc7579', deployed: true },
          },
          {
            vm: 'svm',
            chainId: SOLANA,
            account: { wallet, swigAccount },
          },
          {
            vm: 'svm',
            chainId: SOLANA,
            account: {
              wallet,
              swigAccount,
              authority: { kind: 'secp256k1', address },
            },
          },
          {
            vm: 'svm',
            chainId: SOLANA,
            account: {
              wallet,
              swigAccount,
              authority: { kind: 'secp256r1', publicKey },
            },
          },
        ],
      }),
    )
    expect(mapped.accounts?.[0]).toEqual({
      vm: 'evm',
      chainId: BASE,
      account: { address, type: 'erc7579', deployed: true },
    })
    expect(mapped.accounts?.[1]?.account).not.toHaveProperty('authority')
    expect(mapped.accounts?.[2]?.account).toHaveProperty('authority', {
      kind: 'secp256k1',
      address,
    })
    expect(mapped.accounts?.[3]?.account).toHaveProperty('authority', {
      kind: 'secp256r1',
      publicKey,
    })
  })

  test('keeps a known-empty refund list distinct from an absent one', () => {
    // `[]` means none were observed; absence means the record does not say.
    expect(mapIntentStatusFromWire('intent-1', status()).refunds).toEqual([])
    const noKey = status()
    delete (noKey as { refunds?: unknown }).refunds
    expect('refunds' in mapIntentStatusFromWire('intent-1', noKey)).toBe(false)
  })

  test('surfaces refund transactions in their native form', () => {
    const mapped = mapIntentStatusFromWire(
      'intent-1',
      status({ status: 'FAILED', refunds: [{ transaction: evmTx }] }),
    )
    expect(mapped.refunds).toEqual([{ transaction: evmTx }])
  })

  test('omits details unless the response carries them', () => {
    expect('details' in mapIntentStatusFromWire('intent-1', status())).toBe(
      false,
    )
  })

  test('preserves absent Swig authority in full-detail deployments', () => {
    const account = {
      wallet: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      swigAccount: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    }
    const leg = {
      chainId: SOLANA,
      tokens: [],
      status: 'COMPLETED',
    }
    const mapped = mapIntentStatusFromWire(
      'intent-1',
      status({
        details: {
          nonce: '1',
          createdAt: 1,
          latencyMs: 2,
          settlementLayer: 'SAME_CHAIN',
          source: [leg],
          destination: leg,
          deployments: [{ vm: 'svm', chainId: SOLANA, account }],
          cost: { sponsored: false },
        },
      }),
    )

    expect(mapped.details?.deployments?.[0]).toMatchObject({
      vm: 'svm',
      chainId: SOLANA,
      account: { wallet: account.wallet, swigAccount: account.swigAccount },
    })
    expect(mapped.details?.deployments?.[0]?.account).not.toHaveProperty(
      'authority',
    )
  })

  test('converts recorded amounts in full details to bigint', () => {
    const leg = {
      chainId: BASE,
      tokens: [{ token: address, symbol: 'USDC', decimals: 6, amount: '500' }],
      status: 'COMPLETED',
    }
    const mapped = mapIntentStatusFromWire(
      'intent-1',
      status({
        details: {
          nonce: '1',
          createdAt: 1,
          latencyMs: 2,
          settlementLayer: 'SAME_CHAIN',
          source: [leg],
          destination: leg,
          cost: { sponsored: true, sponsoredValue: '42' },
        },
      }),
    )
    expect(mapped.details?.source[0]?.tokens[0]?.amount).toBe(500n)
    expect(mapped.details?.cost.sponsoredValue).toBe(42n)
    // Absent recorded facts stay absent rather than becoming empty arrays.
    expect(mapped.details).not.toHaveProperty('executions')
  })
})
