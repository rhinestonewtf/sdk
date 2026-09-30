import { describe, expect, test } from 'vitest'
import { UnsupportedSponsorshipApprovalError } from '../../errors/execution'
import type { SerializedIntentInput } from './public'
import {
  assertSponsorshipApproval,
  isSponsoredIntentInput,
  projectSponsorshipApproval,
  toSponsorshipApprovalInput,
} from './sponsorship-approval'

const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000b2'
const T1 = '0x0000000000000000000000000000000000000071'
const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const WALLET = 'DfBX7Po1bmnXt4GuEF3Eg5UYUHAjs9m5n8nbb9WUqgw2'
const SWIG = '9fTE4gQnweN345EGzy6jnXNFW8VryvZ8QwLZqgBubmMs'
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const call = { to: B, value: '1', data: '0x12' }

const evmAccount = { evm: { type: 'erc7579', address: A, signatureMode: 1 } }
const evmDestination = { vm: 'evm', chainId: 'eip155:8453' }

function body(overrides: Record<string, unknown> = {}) {
  return { account: evmAccount, destination: evmDestination, ...overrides }
}

const CONTRACT_VERSION = 'sdk-caucasus-singular-2026-09-v1'

describe('projectSponsorshipApproval', () => {
  test('projects a minimal EVM body into the envelope, with source omitted', () => {
    expect(projectSponsorshipApproval(body())).toEqual({
      contractVersion: CONTRACT_VERSION,
      account: evmAccount,
      destination: evmDestination,
      options: {},
    })
  })

  test('accepts every field the SDK emits, verbatim', () => {
    const account = {
      evm: {
        type: 'erc7579',
        address: A,
        initData: { setupOps: [{ to: B, data: '0xfa' }] },
        signatureMode: 2,
        delegations: {
          default: { contract: B },
          chains: { 'eip155:10': { contract: A } },
        },
        simulation: {
          mockSignature: '0x01',
          mockSignaturesByChain: { 'eip155:10': '0xabcd' },
        },
      },
      svm: {
        type: 'swig',
        address: WALLET,
        swigAccount: SWIG,
        authorization: { kind: 'secp256k1', address: A },
        initData: {
          authority: { kind: 'secp256k1', publicKey: `0x02${'11'.repeat(32)}` },
          id: `0x${'07'.repeat(32)}`,
        },
      },
    }
    const source = {
      vm: 'evm',
      chainId: 'eip155:1',
      token: T1,
      maxAmount: '100',
      auxiliaryFunds: '5',
      execution: { calls: [call] },
    }
    const destination = {
      vm: 'evm',
      chainId: 'eip155:8453',
      token: T1,
      amount: '10',
      recipient: {
        type: 'erc7579',
        address: B,
        initData: { setupOps: [{ to: A, data: '0x01' }] },
        delegations: { default: { contract: A } },
        simulation: { mockSignature: '0x02' },
      },
      execution: { calls: [call], gasLimit: '100' },
    }
    const options = {
      appFees: { feeBps: 10 },
      protocolFees: { feeBps: 5 },
      customDeadline: 1_900_000_000,
      settlementLayers: { include: ['ACROSS'] },
      quoters: { exclude: ['ZEROX'] },
      sponsorship: { gas: true, bridgeFees: false, swapFees: false },
    }
    const sent = { account, source, destination, options }
    expect(projectSponsorshipApproval(sent)).toEqual({
      contractVersion: CONTRACT_VERSION,
      account,
      source,
      destination,
      options,
    })
  })

  test('drops undefined members via the JSON round trip', () => {
    const sent = {
      account: { evm: { type: 'erc7579', address: A }, svm: undefined },
      destination: {
        ...evmDestination,
        token: undefined,
        amount: undefined,
        recipient: undefined,
      },
      options: undefined,
    }
    expect(projectSponsorshipApproval(sent)).toEqual({
      contractVersion: CONTRACT_VERSION,
      account: { evm: { type: 'erc7579', address: A } },
      destination: evmDestination,
      options: {},
    })
  })

  test('maps Solana instructions and lookup tables', () => {
    const destination = {
      vm: 'svm',
      chainId: DEVNET,
      token: MINT,
      execution: {
        instructions: [{ programId: MINT, accounts: [], data: 'AQ' }],
        addressLookupTables: [SWIG],
      },
    }
    expect(
      projectSponsorshipApproval(body({ destination })).destination,
    ).toEqual(destination)
  })

  test('maps a Solana authority change destination', () => {
    const destination = {
      vm: 'svm',
      chainId: DEVNET,
      execution: {
        authority: {
          action: 'add',
          key: { kind: 'secp256r1', publicKey: `0x03${'22'.repeat(32)}` },
          permission: 'all',
        },
      },
    }
    expect(
      projectSponsorshipApproval(body({ destination })).destination,
    ).toEqual(destination)
  })

  test('maps a HyperCore action and settlement calls', () => {
    const action = { type: 'order', orders: [] }
    const destination = {
      vm: 'hypercore',
      chainId: 'hypercore:perp',
      execution: { actions: [action], settlement: { calls: [call] } },
    }
    expect(
      projectSponsorshipApproval(body({ destination })).destination,
    ).toEqual(destination)
  })

  test('maps a Tron delivery', () => {
    const destination = {
      vm: 'tvm',
      chainId: 'tron:mainnet',
      token: 'TTOKEN',
      amount: '5',
      recipient: { address: 'TXYZ' },
    }
    expect(
      projectSponsorshipApproval(body({ destination })).destination,
    ).toEqual(destination)
  })

  describe('toSponsorshipApprovalInput', () => {
    test('performs no validation, mirroring whatever body it is given', () => {
      const garbage = {
        account: { evm: { type: 'unknown-type', address: A } },
        destination: { vm: 'move', tokenRequests: [] },
        extraRootField: 'ignored by projection, not by validation',
      }
      expect(() => toSponsorshipApprovalInput(garbage)).not.toThrow()
      expect(toSponsorshipApprovalInput(garbage)).toEqual({
        contractVersion: CONTRACT_VERSION,
        account: garbage.account,
        destination: garbage.destination,
        options: {},
      })
    })

    test('omits source when absent, and keeps it when present', () => {
      expect(toSponsorshipApprovalInput(body())).not.toHaveProperty('source')
      const withSource = body({ source: { vm: 'evm', chainId: 'eip155:1' } })
      expect(toSponsorshipApprovalInput(withSource)).toHaveProperty('source', {
        vm: 'evm',
        chainId: 'eip155:1',
      })
    })
  })

  test.each([
    ['a non-object body', null, ''],
    ['an unknown root key', body({ intent: {} }), 'intent'],
    ['an account with no entry', body({ account: {} }), 'account'],
    [
      'an unknown key on account.evm',
      body({ account: { evm: { type: 'erc7579', address: A, foo: 1 } } }),
      'account.evm.foo',
    ],
    [
      'an unknown EVM account type',
      body({ account: { evm: { type: 'safe', address: A } } }),
      'account.evm.type',
    ],
    [
      'a non-Swig SVM account',
      body({ account: { svm: { type: 'pda', address: WALLET } } }),
      'account.svm.type',
    ],
    [
      'an unknown key on source',
      body({
        source: { vm: 'evm', chainId: 'eip155:1', token: T1, foo: 1 },
      }),
      'source.foo',
    ],
    [
      'legacy source.selection',
      body({
        source: { selection: { chains: 'all', tokens: 'all' } },
      }),
      'source.selection',
    ],
    [
      'legacy source.limits',
      body({
        source: {
          limits: [{ chainId: 'eip155:1', tokenAddress: T1, maxAmount: '1' }],
        },
      }),
      'source.limits',
    ],
    [
      'legacy source.executions',
      body({
        source: { executions: [{ vm: 'evm', chainId: 'eip155:1', calls: [] }] },
      }),
      'source.executions',
    ],
    [
      'an SVM source with an execution',
      body({
        source: {
          vm: 'svm',
          chainId: DEVNET,
          token: MINT,
          execution: { calls: [] },
        },
      }),
      'source.execution',
    ],
    [
      'an unknown key on destination',
      body({ destination: { ...evmDestination, foo: 1 } }),
      'destination.foo',
    ],
    [
      'legacy destination.tokenRequests',
      body({ destination: { ...evmDestination, tokenRequests: [] } }),
      'destination.tokenRequests',
    ],
    [
      'a non-string destination.amount',
      body({ destination: { ...evmDestination, token: T1, amount: 1 } }),
      'destination.amount',
    ],
    [
      'destination.amount with no token',
      body({ destination: { ...evmDestination, amount: '1' } }),
      'destination.amount',
    ],
    [
      'a null optional field',
      body({ destination: { ...evmDestination, token: null } }),
      'destination.token',
    ],
    [
      'a null source.maxAmount',
      body({
        source: {
          vm: 'evm',
          chainId: 'eip155:1',
          token: T1,
          maxAmount: null,
        },
      }),
      'source.maxAmount',
    ],
    [
      'a null options.customDeadline',
      body({ options: { customDeadline: null } }),
      'options.customDeadline',
    ],
    [
      'two HyperCore actions',
      body({
        destination: {
          vm: 'hypercore',
          chainId: 'hypercore:perp',
          execution: { actions: [{}, {}] },
        },
      }),
      'destination.execution.actions',
    ],
    [
      'no HyperCore actions',
      body({
        destination: {
          vm: 'hypercore',
          chainId: 'hypercore:perp',
          execution: { actions: [] },
        },
      }),
      'destination.execution.actions',
    ],
    [
      'a Tron destination without a recipient',
      body({
        destination: { vm: 'tvm', chainId: 'tron:mainnet', token: 'T' },
      }),
      'destination.recipient',
    ],
    [
      'an SVM destination mixing authority and instructions',
      body({
        destination: {
          vm: 'svm',
          chainId: DEVNET,
          execution: {
            authority: {
              action: 'remove',
              key: { kind: 'secp256r1', publicKey: `0x03${'22'.repeat(32)}` },
            },
            instructions: [],
          },
        },
      }),
      'destination.execution.instructions',
    ],
    ['an unknown key on options', body({ options: { foo: 1 } }), 'options.foo'],
    [
      'a non-boolean sponsorship category',
      body({ options: { sponsorship: { gas: 'yes' } } }),
      'options.sponsorship.gas',
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

describe('isSponsoredIntentInput', () => {
  test('is true when options.sponsorship is present, including all-false', () => {
    const input = projectSponsorshipApproval(
      body({ options: { sponsorship: { gas: false } } }),
    )
    expect(isSponsoredIntentInput(input)).toBe(true)
  })

  test('is false when options carries no sponsorship', () => {
    const input = projectSponsorshipApproval(body())
    expect(isSponsoredIntentInput(input)).toBe(false)
  })
})

describe('assertSponsorshipApproval', () => {
  const input = projectSponsorshipApproval(body())

  test('accepts an equal input regardless of key order or undefined members', () => {
    const reordered = {
      options: {},
      destination: evmDestination,
      account: {
        evm: {
          address: A,
          signatureMode: 1,
          type: 'erc7579',
          delegations: undefined,
        },
      },
      contractVersion: CONTRACT_VERSION,
    } as unknown as SerializedIntentInput
    expect(() => assertSponsorshipApproval(body(), reordered)).not.toThrow()
  })

  test.each([
    [
      'a changed value',
      { ...input, destination: { ...input.destination, chainId: 'eip155:1' } },
      'destination.chainId',
    ],
    [
      'an extra field',
      { ...input, source: { vm: 'evm', chainId: 'eip155:1', token: T1 } },
      'source',
    ],
    [
      'reordered array entries',
      {
        ...input,
        account: {
          evm: {
            ...input.account.evm,
            delegations: { default: { contract: B } },
          },
        },
      },
      'account.evm.delegations',
    ],
  ])(
    'refuses %s, naming the first differing field',
    (_label, intentInput, field) => {
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
    },
  )

  test('refuses an input whose call order differs from the body', () => {
    const calls = [call, { ...call, value: '2' }]
    const sent = body({
      destination: { ...evmDestination, token: T1, execution: { calls } },
    })
    const approved = projectSponsorshipApproval(sent)
    expect(() => assertSponsorshipApproval(sent, approved)).not.toThrow()
    const destination = approved.destination as {
      execution?: { calls: unknown[] }
    }
    expect(() =>
      assertSponsorshipApproval(sent, {
        ...approved,
        destination: {
          ...approved.destination,
          execution: {
            ...destination.execution,
            calls: [...(destination.execution?.calls ?? [])].reverse(),
          },
        },
      } as SerializedIntentInput),
    ).toThrow(UnsupportedSponsorshipApprovalError)
  })
})
