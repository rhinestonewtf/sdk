import { describe, expect, test } from 'vitest'
import { UnsupportedSponsorshipApprovalError } from '../../errors/execution'
import type { SerializedIntentInput } from './public'
import {
  assertSponsorshipApproval,
  projectSponsorshipApproval,
} from './sponsorship-approval'

const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000b2'
const T1 = '0x0000000000000000000000000000000000000071'
const T2 = '0x0000000000000000000000000000000000000072'
const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const WALLET = 'DfBX7Po1bmnXt4GuEF3Eg5UYUHAjs9m5n8nbb9WUqgw2'
const SWIG = '9fTE4gQnweN345EGzy6jnXNFW8VryvZ8QwLZqgBubmMs'
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const call = { to: B, value: '1', data: '0x12' }

const evmAccount = { evm: { type: 'erc7579', address: A, signatureMode: 1 } }
const evmDestination = { vm: 'evm', chainId: 'eip155:8453', tokenRequests: [] }

function body(overrides: Record<string, unknown> = {}) {
  return { account: evmAccount, destination: evmDestination, ...overrides }
}

describe('projectSponsorshipApproval', () => {
  test('projects a minimal EVM body into the established spelling', () => {
    expect(projectSponsorshipApproval(body())).toEqual({
      account: { address: A, accountType: 'ERC7579', setupOps: [] },
      destinationChainId: 8453,
      destinationExecutions: [],
      tokenRequests: [],
      options: { signatureMode: 1 },
    })
  })

  test('maps an undeployed, delegated smart account with session mocks', () => {
    const projected = projectSponsorshipApproval(
      body({
        account: {
          evm: {
            type: 'erc7579',
            address: A,
            initData: { setupOps: [{ to: B, data: '0xfa' }] },
            signatureMode: 2,
            delegations: { default: { contract: B } },
            simulation: { mockSignaturesByChain: { 'eip155:10': '0xabcd' } },
          },
        },
      }),
    )
    expect(projected.account).toEqual({
      address: A,
      accountType: 'ERC7579',
      setupOps: [{ to: B, data: '0xfa' }],
      delegations: { 0: { contract: B } },
      mockSignatures: { 10: '0xabcd' },
    })
    expect(projected.options).toEqual({ signatureMode: 2 })
  })

  test('maps an EOA with no setup operations', () => {
    expect(
      projectSponsorshipApproval(
        body({ account: { evm: { type: 'eoa', address: A } } }),
      ),
    ).toMatchObject({
      account: { address: A, accountType: 'EOA', setupOps: [] },
      options: {},
    })
  })

  test('names a standalone Swig verbatim, with no EVM-only fields', () => {
    const svm = {
      type: 'swig',
      address: WALLET,
      swigAccount: SWIG,
      authorization: { kind: 'secp256k1', address: A },
      initData: {
        authority: { kind: 'secp256k1', publicKey: `0x02${'11'.repeat(32)}` },
        id: `0x${'07'.repeat(32)}`,
      },
    }
    expect(
      projectSponsorshipApproval({
        account: { svm },
        destination: { vm: 'svm', chainId: DEVNET, tokenRequests: [] },
        source: { selection: { chains: { only: [DEVNET] }, tokens: 'all' } },
        options: { sponsorship: { gas: true, bridgeFees: false } },
      }),
    ).toEqual({
      account: { address: WALLET, svm },
      destinationChainId: 792703810,
      destinationExecutions: [],
      tokenRequests: [],
      accountAccessList: { chainIds: [792703810] },
      options: { sponsorSettings: { gas: true, bridgeFees: false } },
    })
  })

  test('keeps the EVM executor fields beside the Swig it pairs with', () => {
    const svm = {
      type: 'swig',
      address: WALLET,
      authorization: { kind: 'secp256r1', publicKey: `0x03${'22'.repeat(32)}` },
    }
    expect(
      projectSponsorshipApproval(body({ account: { ...evmAccount, svm } }))
        .account,
    ).toEqual({ address: A, accountType: 'ERC7579', setupOps: [], svm })
  })

  test.each([
    [
      'a bare EVM recipient and destination calls',
      {
        ...evmDestination,
        recipient: { address: B },
        execution: { calls: [call], gasLimit: '100' },
      },
      {
        recipient: { address: B },
        destinationExecutions: [call],
        destinationGasUnits: '100',
      },
    ],
    [
      'a configured EVM recipient',
      {
        ...evmDestination,
        recipient: {
          type: 'erc7579',
          address: B,
          initData: { setupOps: [{ to: A, data: '0x01' }] },
        },
      },
      {
        recipient: {
          address: B,
          accountType: 'ERC7579',
          setupOps: [{ to: A, data: '0x01' }],
        },
      },
    ],
    [
      'Solana instructions and lookup tables',
      {
        vm: 'svm',
        chainId: DEVNET,
        tokenRequests: [],
        execution: {
          instructions: [{ programId: MINT, accounts: [], data: 'AQ' }],
          addressLookupTables: [SWIG],
        },
      },
      {
        destinationChainId: 792703810,
        destinationInstructions: [
          { programId: MINT, accounts: [], data: 'AQ' },
        ],
        addressLookupTableAddresses: [SWIG],
      },
    ],
    [
      'a Tron delivery',
      {
        vm: 'tvm',
        chainId: 'tron:mainnet',
        recipient: { address: 'TXYZ' },
        tokenRequests: [{ tokenAddress: 'TTOKEN', amount: '5' }],
      },
      {
        destinationChainId: 728126428,
        recipient: { address: 'TXYZ' },
        tokenRequests: [{ tokenAddress: 'TTOKEN', amount: '5' }],
        destinationExecutions: [],
      },
    ],
    [
      'a Stellar delivery',
      {
        vm: 'stellar',
        chainId: 'stellar:pubnet',
        recipient: { address: 'GABC' },
        tokenRequests: [],
      },
      { destinationChainId: 1500148, recipient: { address: 'GABC' } },
    ],
  ])('maps %s', (_label, destination, expected) => {
    expect(projectSponsorshipApproval(body({ destination }))).toMatchObject(
      expected,
    )
  })

  test('moves a HyperCore action into the options and its settlement into executions', () => {
    const action = { type: 'order', orders: [] }
    const projected = projectSponsorshipApproval(
      body({
        destination: {
          vm: 'hypercore',
          chainId: 'hypercore:perp',
          tokenRequests: [],
          execution: {
            actions: [action],
            settlement: { calls: [call], gasLimit: '9' },
          },
        },
      }),
    )
    expect(projected).toMatchObject({
      destinationChainId: 1337002,
      destinationExecutions: [call],
      destinationGasUnits: '9',
      options: { signatureMode: 1, hyperCore: { action } },
    })
  })

  describe('source', () => {
    test.each([
      ['no source', undefined, undefined],
      [
        'an unrestricted selection',
        { selection: { chains: 'all', tokens: 'all' } },
        undefined,
      ],
      [
        'a chain allowlist',
        {
          selection: {
            chains: { only: ['eip155:1', 'eip155:10'] },
            tokens: 'all',
          },
        },
        { chainIds: [1, 10] },
      ],
      [
        'a chain and token allowlist',
        {
          selection: { chains: { only: ['eip155:1'] }, tokens: { only: [T1] } },
        },
        { chainIds: [1], tokens: [T1] },
      ],
      [
        'a token allowlist on every chain',
        { selection: { chains: 'all', tokens: { only: [T1] } } },
        { tokens: [T1] },
      ],
      [
        'per-chain assets, uncapped',
        {
          selection: {
            chains: { only: ['eip155:1', 'eip155:10'] },
            tokens: { only: [T1, T2] },
            perChain: {
              'eip155:1': { tokens: { only: [T1] } },
              'eip155:10': { tokens: { only: [T2, T1] } },
            },
          },
        },
        { chainTokens: { 1: [T1], 10: [T2, T1] } },
      ],
      [
        'per-chain assets, capped and uncapped on different tokens',
        {
          selection: {
            chains: { only: ['eip155:1', 'eip155:10'] },
            tokens: { only: [T1, T2] },
            perChain: {
              'eip155:1': { tokens: { only: [T1, T2] } },
              'eip155:10': { tokens: { only: [T2] } },
            },
          },
          limits: [
            { chainId: 'eip155:1', tokenAddress: T2, maxAmount: '7' },
            { chainId: 'eip155:10', tokenAddress: T2, maxAmount: '8' },
          ],
        },
        {
          chainTokens: { 1: [T1] },
          chainTokenAmounts: { 1: { [T2]: '7' }, 10: { [T2]: '8' } },
        },
      ],
      [
        'a named chain with no tokens',
        {
          selection: {
            chains: { only: ['eip155:1'] },
            tokens: { only: [] },
            perChain: { 'eip155:1': { tokens: { only: [] } } },
          },
        },
        { chainTokens: { 1: [] } },
      ],
    ])('maps %s', (_label, source, accountAccessList) => {
      const projected = projectSponsorshipApproval(
        source === undefined ? body() : body({ source }),
      )
      if (accountAccessList === undefined) {
        expect(projected).not.toHaveProperty('accountAccessList')
      } else {
        expect(projected.accountAccessList).toEqual(accountAccessList)
      }
    })

    test('maps auxiliary funds and pre-claim executions by numeric chain', () => {
      expect(
        projectSponsorshipApproval(
          body({
            source: {
              auxiliaryFunds: { 'eip155:1': { [T1]: '3' } },
              executions: [{ vm: 'evm', chainId: 'eip155:10', calls: [call] }],
            },
          }),
        ),
      ).toMatchObject({
        options: { signatureMode: 1, auxiliaryFunds: { 1: { [T1]: '3' } } },
        preClaimExecutions: { 10: [call] },
      })
    })
  })

  test('copies options verbatim, renaming sponsorship and keeping explicit false', () => {
    const options = {
      appFees: { feeBps: 10 },
      protocolFees: { feeBps: 5 },
      customDeadline: 1_900_000_000,
      settlementLayers: { include: ['ACROSS'] },
      quoters: { exclude: ['ZEROX'] },
    }
    expect(
      projectSponsorshipApproval(
        body({
          options: {
            ...options,
            sponsorship: { gas: true, bridgeFees: false, swapFees: false },
          },
        }),
      ).options,
    ).toEqual({
      ...options,
      sponsorSettings: { gas: true, bridgeFees: false, swapFees: false },
      signatureMode: 1,
    })
  })

  const perChain = {
    chains: { only: ['eip155:1'] },
    tokens: { only: [T1] },
    perChain: { 'eip155:1': { tokens: { only: [T1] } } },
  }

  test.each([
    ['a non-object body', null, ''],
    ['an unknown root key', body({ intent: {} }), 'intent'],
    ['an account with no entry', body({ account: {} }), 'account'],
    [
      'an unknown EVM account type',
      body({ account: { evm: { type: 'safe', address: A } } }),
      'account.evm.type',
    ],
    [
      'setup operations on an EOA',
      body({
        account: {
          evm: { type: 'eoa', address: A, initData: { setupOps: [] } },
        },
      }),
      'account.evm.initData',
    ],
    [
      'per-chain delegations',
      body({
        account: {
          evm: {
            type: 'eoa',
            address: A,
            delegations: { chains: { 'eip155:1': { contract: B } } },
          },
        },
      }),
      'account.evm.delegations.chains',
    ],
    [
      'delegations with no default',
      body({ account: { evm: { type: 'eoa', address: A, delegations: {} } } }),
      'account.evm.delegations.default',
    ],
    [
      'a chain-agnostic mock signature',
      body({
        account: {
          evm: {
            type: 'erc7579',
            address: A,
            simulation: { mockSignature: '0x01' },
          },
        },
      }),
      'account.evm.simulation.mockSignature',
    ],
    [
      'a non-Swig SVM account',
      body({ account: { svm: { type: 'pda', address: WALLET } } }),
      'account.svm.type',
    ],
    [
      'an unknown Swig authority',
      body({
        account: {
          svm: {
            type: 'swig',
            address: WALLET,
            authorization: { kind: 'ed25519', publicKey: '0x01' },
          },
        },
      }),
      'account.svm.authorization.kind',
    ],
    [
      'a signature mode on a recipient',
      body({
        destination: {
          ...evmDestination,
          recipient: { type: 'eoa', address: B, signatureMode: 1 },
        },
      }),
      'destination.recipient.signatureMode',
    ],
    [
      'an unknown destination VM',
      body({ destination: { ...evmDestination, vm: 'move' } }),
      'destination.vm',
    ],
    [
      'an unknown CAIP-2 chain',
      body({ destination: { ...evmDestination, chainId: 'cosmos:hub' } }),
      'destination.chainId',
    ],
    [
      'executionTokensReceived',
      body({
        destination: {
          ...evmDestination,
          execution: { calls: [], executionTokensReceived: [T1] },
        },
      }),
      'destination.execution.executionTokensReceived',
    ],
    [
      'an execution on a Tron destination',
      body({
        destination: {
          vm: 'tvm',
          chainId: 'tron:mainnet',
          recipient: { address: 'T' },
          tokenRequests: [],
          execution: {},
        },
      }),
      'destination.execution',
    ],
    [
      'two HyperCore actions',
      body({
        destination: {
          vm: 'hypercore',
          chainId: 'hypercore:perp',
          tokenRequests: [],
          execution: { actions: [{}, {}] },
        },
      }),
      'destination.execution.actions',
    ],
    [
      'an excluded chain',
      body({
        source: {
          selection: { chains: { except: ['eip155:1'] }, tokens: 'all' },
        },
      }),
      'source.selection.chains.except',
    ],
    [
      'an excluded token',
      body({
        source: { selection: { chains: 'all', tokens: { except: [T1] } } },
      }),
      'source.selection.tokens.except',
    ],
    [
      'a limit with no per-chain map',
      body({
        source: {
          selection: { chains: { only: ['eip155:1'] }, tokens: 'all' },
          limits: [{ chainId: 'eip155:1', tokenAddress: T1, maxAmount: '1' }],
        },
      }),
      'source.limits',
    ],
    [
      'a limit with no selection',
      body({
        source: {
          limits: [{ chainId: 'eip155:1', tokenAddress: T1, maxAmount: '1' }],
        },
      }),
      'source.limits',
    ],
    [
      'a limit on a token the per-chain map does not name',
      body({
        source: {
          selection: perChain,
          limits: [{ chainId: 'eip155:1', tokenAddress: T2, maxAmount: '1' }],
        },
      }),
      'source.limits.0',
    ],
    [
      'two limits on one pair',
      body({
        source: {
          selection: perChain,
          limits: [
            { chainId: 'eip155:1', tokenAddress: T1, maxAmount: '1' },
            { chainId: 'eip155:1', tokenAddress: T1, maxAmount: '2' },
          ],
        },
      }),
      'source.limits.1',
    ],
    [
      'global tokens wider than the per-chain union',
      body({
        source: { selection: { ...perChain, tokens: { only: [T1, T2] } } },
      }),
      'source.selection.tokens',
    ],
    [
      'global chains wider than the per-chain map',
      body({
        source: {
          selection: {
            ...perChain,
            chains: { only: ['eip155:1', 'eip155:10'] },
          },
        },
      }),
      'source.selection.chains',
    ],
    [
      'an excluded per-chain token',
      body({
        source: {
          selection: {
            ...perChain,
            perChain: { 'eip155:1': { tokens: { except: [T1] } } },
          },
        },
      }),
      'source.selection.perChain.eip155:1.tokens.except',
    ],
    [
      'a non-EVM pre-claim execution',
      body({
        source: { executions: [{ vm: 'svm', chainId: DEVNET, calls: [] }] },
      }),
      'source.executions.0.vm',
    ],
    [
      'two pre-claim executions on one chain',
      body({
        source: {
          executions: [
            { vm: 'evm', chainId: 'eip155:1', calls: [] },
            { vm: 'evm', chainId: 'eip155:1', calls: [] },
          ],
        },
      }),
      'source.executions.1.chainId',
    ],
    [
      'a selection strategy',
      body({ options: { selectionStrategy: 'cheapest' } }),
      'options.selectionStrategy',
    ],
    [
      'an unknown option',
      body({ options: { dryRun: true } }),
      'options.dryRun',
    ],
    [
      'an unknown sponsorship category',
      body({ options: { sponsorship: { swapValue: true } } }),
      'options.sponsorship.swapValue',
    ],
  ])('refuses %s', (_label, value, field) => {
    let error: unknown
    try {
      projectSponsorshipApproval(value)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(UnsupportedSponsorshipApprovalError)
    expect((error as UnsupportedSponsorshipApprovalError).context).toEqual({
      reason: 'unsupported',
      ...(field ? { field } : {}),
    })
  })
})

describe('assertSponsorshipApproval', () => {
  const input = projectSponsorshipApproval(body())

  test('accepts an equal input regardless of key order or undefined members', () => {
    const reordered = {
      options: { signatureMode: 1 },
      tokenRequests: [],
      destinationExecutions: [],
      destinationChainId: 8453,
      account: {
        setupOps: [],
        delegations: undefined,
        accountType: 'ERC7579',
        address: A,
      },
    } as SerializedIntentInput
    expect(() => assertSponsorshipApproval(body(), reordered)).not.toThrow()
  })

  test.each([
    [
      'a changed value',
      { ...input, destinationChainId: 1 },
      'destinationChainId',
    ],
    [
      'an extra constraint',
      { ...input, accountAccessList: { chainIds: [1] } },
      'accountAccessList',
    ],
    [
      'reordered executions',
      { ...input, destinationExecutions: [call, { ...call, value: '2' }] },
      'destinationExecutions',
    ],
  ])('refuses %s, naming the field', (_label, intentInput, field) => {
    let error: unknown
    try {
      assertSponsorshipApproval(body(), intentInput as SerializedIntentInput)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(UnsupportedSponsorshipApprovalError)
    expect((error as UnsupportedSponsorshipApprovalError).context).toEqual({
      reason: 'mismatch',
      field,
    })
  })

  test('refuses an input whose array order differs from the body', () => {
    const calls = [call, { ...call, value: '2' }]
    const sent = body({
      destination: { ...evmDestination, execution: { calls } },
    })
    const approved = projectSponsorshipApproval(sent)
    expect(() => assertSponsorshipApproval(sent, approved)).not.toThrow()
    expect(() =>
      assertSponsorshipApproval(sent, {
        ...approved,
        destinationExecutions: [...approved.destinationExecutions].reverse(),
      }),
    ).toThrow(UnsupportedSponsorshipApprovalError)
  })
})
