import type { Address } from 'viem'
import { describe, expect, test } from 'vitest'
import { projectCompatibleIntentInput } from '../../clients/orchestrator/normalized'
import type { IntentAccountProjection } from './account'
import { buildIntentRequest } from './request'
import type { IntentInput } from './types'

const ACCOUNT = '0x0000000000000000000000000000000000000010' as Address
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Address
const FACTORY = '0x0000000000000000000000000000000000000020' as Address
const DELEGATE = '0x0000000000000000000000000000000000000030' as Address
const BASE = 'eip155:8453'
const SOLANA_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'

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
  caip2: SOLANA_CAIP2,
} as const

function transaction(overrides: Partial<IntentInput> = {}): IntentInput {
  return {
    destination: evmChain,
    calls: [],
    tokenRequests: [{ token: USDC, amount: 1_000_000n }],
    ...overrides,
  }
}

function build(input: Partial<Parameters<typeof buildIntentRequest>[0]> = {}) {
  return buildIntentRequest({
    transaction: transaction(),
    account: smartAccount,
    calls: [],
    sourceCalls: {},
    providedFunds: {},
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

  // A true EOA permits neither setup operations nor simulation stubs.
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

  // An adopted 7702 account is ERC-7579 WITH delegations, not a stripped EOA:
  // it still routes through its setup op and its signature is still validated
  // by the account.
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
  test('nests chain, tokens and calls under an EVM destination', () => {
    const calls = [{ target: USDC, value: 0n, data: '0xabcd' as const }]
    const { request } = build({
      transaction: transaction({ gasLimit: 100_000n }),
      calls,
    })
    expect(request.destination).toEqual({
      vm: 'evm',
      chainId: BASE,
      tokenRequests: [{ tokenAddress: USDC, amount: 1_000_000n }],
      execution: {
        calls: [{ to: USDC, value: 0n, data: '0xabcd' }],
        gasLimit: 100_000n,
      },
    })
  })

  // An execution block with no calls is not the same request as a plain
  // delivery, so it is omitted rather than sent empty.
  test('omits an empty execution block', () => {
    expect(build().request.destination).not.toHaveProperty('execution')
  })

  test('tags a Solana destination as svm', () => {
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const recipient = 'EEnKdeMRGrhKq1Z2rkRubkrkTxCZigLZ5QgUYqAMvPnU'
    const { request } = build({
      transaction: transaction({
        destination: solanaChain,
        tokenRequests: [{ token: mint, amount: 5n }],
        recipient: { kind: 'bare', address: recipient },
      }),
    })
    expect(request.destination).toEqual({
      vm: 'svm',
      chainId: SOLANA_CAIP2,
      recipient: { address: recipient },
      tokenRequests: [{ tokenAddress: mint, amount: 5n }],
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

  test.each(['tron:mainnet', 'stellar:pubnet'] as const)(
    'sends a %s delivery to its explicit recipient',
    (caip2) => {
      const { request } = build({
        transaction: transaction({
          destination: {
            kind: 'non-evm',
            namespace: caip2.split(':')[0]!,
            reference: caip2.split(':')[1]!,
            caip2,
          },
          recipient: { kind: 'bare', address: 'TRecipient' },
        }),
      })
      expect(request.destination).toMatchObject({
        chainId: caip2,
        recipient: { address: 'TRecipient' },
      })
    },
  )

  test('omits an amount for a max-out request', () => {
    const { request } = build({
      transaction: transaction({ tokenRequests: [{ token: USDC }] }),
    })
    expect(request.destination.tokenRequests).toEqual([{ tokenAddress: USDC }])
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

describe('buildIntentRequest — normalized sponsorship input', () => {
  // The normalized input is the shape a sponsorship JWT's digest commits to.
  // It keeps its numeric chain ids and its original field names across the
  // wire migration, or every issued grant stops matching.
  test('keeps the historical field names and numeric chain ids', () => {
    const { normalized } = build({
      transaction: transaction({
        options: {
          sponsorSettings: { gas: true, bridgeFees: true, swapFees: true },
        },
        accountAccessList: { chainIds: [8453] },
      }),
    })

    expect(projectCompatibleIntentInput(normalized)).toEqual({
      account: {
        address: ACCOUNT,
        accountType: 'ERC7579',
        setupOps: [{ to: FACTORY, data: '0xdeadbeef' }],
        delegations: undefined,
      },
      destinationChainId: 8453,
      destinationExecutions: [],
      tokenRequests: [{ tokenAddress: USDC, amount: '1000000' }],
      accountAccessList: { chainIds: [8453] },
      options: {
        sponsorSettings: { gas: true, bridgeFees: true, swapFees: true },
        signatureMode: 1,
      },
    })
  })

  test('describes the same transaction in both views', () => {
    const { request, normalized } = build({
      transaction: transaction({ accountAccessList: { chainIds: [8453] } }),
    })
    expect(normalized.destinationChainId).toBe(8453)
    expect(request.destination.chainId).toBe(BASE)
    expect(normalized.tokenRequests).toEqual(request.destination.tokenRequests)
  })
})

describe('buildIntentRequest — source', () => {
  test('folds provided funds into auxiliary funds under source', () => {
    const { request } = build({
      providedFunds: { 8453: { [USDC]: 250n } },
    })
    expect(request.source?.auxiliaryFunds).toEqual({ [BASE]: { [USDC]: 250n } })
  })

  test('sums configured and call-provided auxiliary funds on the same token', () => {
    const { request } = build({
      transaction: transaction({
        options: { auxiliaryFunds: { 8453: { [USDC]: 100n } } },
      }),
      providedFunds: { 8453: { [USDC]: 250n } },
    })
    expect(request.source?.auxiliaryFunds).toEqual({ [BASE]: { [USDC]: 350n } })
  })

  test('moves source calls to tagged source executions', () => {
    const { request, normalized } = build({
      sourceCalls: { 8453: [{ target: USDC, value: 0n, data: '0x01' }] },
    })
    expect(request.source?.executions).toEqual([
      {
        vm: 'evm',
        chainId: BASE,
        calls: [{ to: USDC, value: 0n, data: '0x01' }],
      },
    ])
    // The normalized view keeps the name its digest was built with.
    expect(normalized.preClaimExecutions).toEqual({
      8453: [{ to: USDC, value: 0n, data: '0x01' }],
    })
  })
})
