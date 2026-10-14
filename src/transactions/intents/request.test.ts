import type { Address } from 'viem'
import { describe, expect, test } from 'vitest'
import type { IntentAccountProjection } from './account'
import { buildIntentRequest } from './request'
import type { IntentInput } from './types'

const ACCOUNT = '0x0000000000000000000000000000000000000010' as Address
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Address
const FACTORY = '0x0000000000000000000000000000000000000020' as Address
const DELEGATE = '0x0000000000000000000000000000000000000030' as Address
const BASE = 'eip155:8453'

const smartAccount: IntentAccountProjection = {
  kind: 'erc7579',
  address: ACCOUNT,
  setupOps: [{ to: FACTORY, data: '0xdeadbeef' }],
}

const evmChain = { kind: 'evm', id: 8453, caip2: BASE } as const
const solanaChain = {
  kind: 'non-evm',
  namespace: 'solana',
  reference: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
} as const

function transaction(overrides: Partial<IntentInput> = {}): IntentInput {
  return {
    destination: evmChain,
    calls: [],
    token: USDC,
    amount: 1_000_000n,
    ...overrides,
  }
}

function build(input: Partial<Parameters<typeof buildIntentRequest>[0]> = {}) {
  return buildIntentRequest({
    transaction: transaction(),
    account: smartAccount,
    calls: [],
    sourceCalls: [],
    providedFunds: 0n,
    ...input,
  })
}

describe('buildIntentRequest — account', () => {
  test('sends an ERC-7579 account with its setup ops under initData', () => {
    expect(build().request.account).toEqual({
      evm: {
        type: 'erc7579',
        address: ACCOUNT,
        initData: { setupOps: [{ to: FACTORY, data: '0xdeadbeef' }] },
        signatureMode: 1,
      },
    })
  })

  test('sends a bare EOA without setup or simulation', () => {
    const { request } = build({
      account: { kind: 'eoa', address: ACCOUNT, setupOps: [] },
    })
    expect(request.account.evm).toEqual({
      type: 'eoa',
      address: ACCOUNT,
      signatureMode: 1,
    })
  })

  test('keeps an adopted 7702 account ERC-7579 and adds a default delegation', () => {
    const { request } = build({
      account: { ...smartAccount, delegationContract: DELEGATE },
    })
    expect(request.account.evm).toMatchObject({
      type: 'erc7579',
      delegations: { default: { contract: DELEGATE } },
      initData: { setupOps: [{ to: FACTORY, data: '0xdeadbeef' }] },
    })
  })

  test('moves session mock signatures into simulation, keyed by CAIP-2', () => {
    const { request } = build({
      mockSignatures: { 8453: '0xaa' },
    })
    expect(request.account.evm).toMatchObject({
      simulation: { mockSignaturesByChain: { [BASE]: '0xaa' } },
    })
  })
})

describe('buildIntentRequest — destination', () => {
  test('nests chain, token/amount and calls under an EVM destination (exact-out)', () => {
    const calls = [{ target: USDC, value: 0n, data: '0xabcd' as const }]
    const { request } = build({
      transaction: transaction({ gasLimit: 100_000n }),
      calls,
    })
    expect(request.destination).toEqual({
      vm: 'evm',
      chainId: BASE,
      token: USDC,
      amount: 1_000_000n,
      execution: {
        calls: [{ to: USDC, value: 0n, data: '0xabcd' }],
        gasLimit: 100_000n,
      },
    })
  })

  test('omits an empty execution block', () => {
    expect(build().request.destination).not.toHaveProperty('execution')
  })

  test('omits an amount for a max-out request', () => {
    const { request } = build({
      transaction: transaction({ amount: undefined }),
    })
    expect(request.destination).toMatchObject({ token: USDC })
    expect(request.destination).not.toHaveProperty('amount')
  })

  test('sends no delivery fields for a token-less execution', () => {
    const { request } = build({
      transaction: transaction({ token: undefined, amount: undefined }),
    })
    expect(request.destination).not.toHaveProperty('token')
    expect(request.destination).not.toHaveProperty('amount')
  })

  test('tags a Solana destination as svm', () => {
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const recipient = 'EEnKdeMRGrhKq1Z2rkRubkrkTxCZigLZ5QgUYqAMvPnU'
    const { request } = build({
      transaction: transaction({
        destination: solanaChain,
        token: mint,
        amount: 5n,
        recipient: { kind: 'bare', address: recipient },
      }),
    })
    expect(request.destination).toEqual({
      vm: 'svm',
      chainId: solanaChain.caip2,
      recipient: { address: recipient },
      token: mint,
      amount: 5n,
    })
  })

  // HyperCore is EVM-addressed but not an EVM chain: its VM tag is its own, and
  // the caller's calls are the HyperEVM transaction that settles the actions.
  test('splits HyperCore actions from the settlement calls', () => {
    const action = {
      type: 'updateLeverage' as const,
      asset: 0,
      isCross: true,
      leverage: 5,
    }
    const { request } = build({
      transaction: transaction({
        destination: {
          kind: 'evm',
          id: 1337002,
          caip2: 'hypercore:perp',
        } as never,
        options: { hyperCore: { action } },
      }),
      calls: [{ target: USDC, value: 0n, data: '0x01' }],
    })
    expect(request.destination).toMatchObject({
      vm: 'hypercore',
      chainId: 'hypercore:perp',
      execution: {
        actions: [action],
        settlement: { calls: [{ to: USDC, value: 0n, data: '0x01' }] },
      },
    })
  })

  test.each(['tvm', 'stellar'] as const)(
    'refuses a %s delivery with no recipient: the account holds no identity there',
    (vm) => {
      const caip2 = vm === 'tvm' ? 'tron:mainnet' : 'stellar:pubnet'
      expect(() =>
        build({
          transaction: transaction({
            destination: {
              kind: 'non-evm',
              namespace: caip2.split(':')[0]!,
              reference: caip2.split(':')[1]!,
              caip2,
            },
          }),
        }),
      ).toThrow(/requires an explicit recipient/)
    },
  )

  test('sends a Tron delivery to its explicit recipient', () => {
    const caip2 = 'tron:mainnet'
    const { request } = build({
      transaction: transaction({
        destination: {
          kind: 'non-evm',
          namespace: 'tron',
          reference: 'mainnet',
          caip2,
        },
        recipient: { kind: 'bare', address: 'TRecipient' },
      }),
    })
    expect(request.destination).toMatchObject({
      chainId: caip2,
      recipient: { address: 'TRecipient' },
    })
  })

  // A bare address is a payee and nothing more: labelling it as an account
  // would read on the wire as "this recipient can execute".
  test('sends a bare recipient without an account type', () => {
    const { request } = build({
      transaction: transaction({
        recipient: { kind: 'bare', address: ACCOUNT },
      }),
    })
    expect(request.destination.recipient).toEqual({ address: ACCOUNT })
  })

  test('preserves a configured smart-account recipient', () => {
    const { request } = build({
      transaction: transaction({
        recipient: {
          kind: 'account',
          accountKind: 'erc7579',
          address: ACCOUNT,
          setupOps: [{ to: FACTORY, data: '0x01' }],
        },
      }),
    })
    expect(request.destination.recipient).toEqual({
      type: 'erc7579',
      address: ACCOUNT,
      initData: { setupOps: [{ to: FACTORY, data: '0x01' }] },
    })
  })
})

describe('buildIntentRequest — options', () => {
  test('renames sponsorSettings to sponsorship, keeping explicit false', () => {
    const { request } = build({
      transaction: transaction({
        options: {
          sponsorSettings: { gas: true, bridgeFees: false, swapFees: false },
        },
      }),
    })
    expect(request.options?.sponsorship).toEqual({
      gas: true,
      bridgeFees: false,
      swapFees: false,
    })
  })

  test('omits options entirely when the intent sets none', () => {
    expect(build().request).not.toHaveProperty('options')
  })

  test('carries fees, deadline and route filters through', () => {
    const { request } = build({
      transaction: transaction({
        options: {
          appFees: { feeBps: 25 },
          protocolFees: { feeBps: 35 },
          customDeadline: 1_893_456_000,
          settlementLayers: { exclude: ['RELAY'] },
          quoters: { include: ['0x'] },
        },
      }),
    })
    expect(request.options).toEqual({
      appFees: { feeBps: 25 },
      protocolFees: { feeBps: 35 },
      customDeadline: 1_893_456_000,
      settlementLayers: { exclude: ['RELAY'] },
      quoters: { include: ['0x'] },
    })
  })
})

describe('buildIntentRequest — source', () => {
  const sourceChain = { kind: 'evm', id: 1, caip2: 'eip155:1' } as const

  test('sends a single source chain and token', () => {
    const { request } = build({
      transaction: transaction({
        source: { chain: sourceChain, token: USDC },
      }),
    })
    expect(request.source).toEqual({
      vm: 'evm',
      chainId: 'eip155:1',
      token: USDC,
    })
  })

  test('sends no source for a source-free intent', () => {
    expect(build().request).not.toHaveProperty('source')
  })

  test('carries maxAmount through', () => {
    const { request } = build({
      transaction: transaction({
        source: { chain: sourceChain, token: USDC, maxAmount: 500n },
      }),
    })
    expect(request.source?.maxAmount).toBe(500n)
  })

  test('folds call-provided funds into auxiliaryFunds', () => {
    const { request } = build({
      transaction: transaction({
        source: { chain: sourceChain, token: USDC },
      }),
      providedFunds: 250n,
    })
    expect(request.source?.auxiliaryFunds).toBe(250n)
  })

  test('sums configured and call-provided auxiliary funds', () => {
    const { request } = build({
      transaction: transaction({
        source: {
          chain: sourceChain,
          token: USDC,
          auxiliaryFunds: 100n,
        },
      }),
      providedFunds: 250n,
    })
    expect(request.source?.auxiliaryFunds).toBe(350n)
  })

  test('nests source calls under source.execution.calls', () => {
    const { request } = build({
      transaction: transaction({
        source: { chain: sourceChain, token: USDC },
      }),
      sourceCalls: [{ target: USDC, value: 0n, data: '0x01' }],
    })
    expect(request.source?.execution).toEqual({
      calls: [{ to: USDC, value: 0n, data: '0x01' }],
    })
  })

  test('throws when source calls are resolved with no source chain', () => {
    expect(() =>
      build({
        transaction: transaction(),
        sourceCalls: [{ target: USDC, value: 0n, data: '0x01' }],
      }),
    ).toThrow(/Source calls need a source chain/)
  })
})

describe('buildIntentRequest — svm destination', () => {
  test('sends an svm destination without a recipient account type', () => {
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const { request } = build({
      transaction: transaction({
        destination: solanaChain,
        token: mint,
        amount: undefined,
        recipient: undefined,
      }),
    })
    expect(request.destination).toEqual({
      vm: 'svm',
      chainId: solanaChain.caip2,
      token: mint,
    })
  })
})
