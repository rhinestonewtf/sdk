import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import type { Call } from '../../calls/types'
import { toEvmChainReference } from '../../chains/caip2'
import { toSession } from '../../modules/validators/smart-sessions/resolve'
import type { Session } from '../../modules/validators/smart-sessions/types'
import { projectPreparedBinding, restorePreparedBinding } from './compatibility'
import { buildIntentRequest } from './request'
import {
  assertSessionQuoteCompatible,
  sameSessionRequest,
} from './session-quote'
import { constrainSessionIntent } from './session-routing'
import type { PreparedIntentSessions } from './sessions'
import type { IntentInput } from './types'

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const sourceChain = toEvmChainReference(1)
const destinationChain = toEvmChainReference(42161)
const token = '0x0000000000000000000000000000000000000001' as const
const target = '0x0000000000000000000000000000000000000002' as const
const baseSession = toSession({
  chain: mainnet,
  owners: { type: 'ecdsa', accounts: [account] },
})
const preClaim = { target, value: 3n, data: '0xaBcD' as const }
const burn = { target: token, value: 4n, data: '0xdEf0' as const }

function intent(overrides: Partial<IntentInput> = {}): IntentInput {
  return {
    source: { chain: sourceChain, token },
    destination: destinationChain,
    calls: [{ target, value: 1n, data: '0x1234' }],
    token,
    amount: 10n,
    signers: {
      kind: 'smart-session',
      byChain: { 1: { session: baseSession } },
    },
    ...overrides,
  }
}

function sessions(
  overrides: Partial<PreparedIntentSessions> = {},
): PreparedIntentSessions {
  return {
    signatureMode: 5,
    byChain: {
      1: {
        kind: 'smart-session',
        session: baseSession,
        verifyExecutions: true,
      },
    },
    mockSignatures: { 1: '0xaaaa' },
    preClaimCalls: [preClaim],
    destinationBurn: burn,
    ...overrides,
  }
}

function quoted(input: IntentInput, prepared = sessions()) {
  const constrained = constrainSessionIntent(
    input,
    account.address,
    Object.keys(prepared.byChain).map(Number),
  )
  return buildIntentRequest({
    transaction: { ...constrained, signatureMode: prepared.signatureMode },
    account: { kind: 'erc7579', address: account.address, setupOps: [] },
    mockSignatures: prepared.mockSignatures,
    calls: [
      ...(prepared.destinationBurn ? [prepared.destinationBurn] : []),
      ...(input.calls as readonly Call[]),
    ],
    sourceCalls: prepared.preClaimCalls,
    providedFunds: 0n,
  }).request
}

function expectIncompatible(input: {
  readonly intent?: IntentInput
  readonly request?: ReturnType<typeof quoted>
  readonly sessions?: PreparedIntentSessions
}) {
  expect(() =>
    assertSessionQuoteCompatible({
      intent: input.intent ?? intent(),
      account: account.address,
      request:
        input.request ?? quoted(input.intent ?? intent(), input.sessions),
      sessions: input.sessions ?? sessions(),
    }),
  ).toThrow('incompatible')
}

describe('sameSessionRequest', () => {
  test('canonically compares object keys, bigints, primitives, and nested arrays', () => {
    expect(
      sameSessionRequest(
        { z: [true, { b: 2n, a: 'one' }], a: null, n: 1n },
        { n: '1', a: null, z: [true, { a: 'one', b: '2' }] },
      ),
    ).toBe(true)
    expect(sameSessionRequest([1, { a: 2 }], [{ a: 2 }, 1])).toBe(false)
    expect(sameSessionRequest(undefined, null)).toBe(false)
  })
})

describe('assertSessionQuoteCompatible', () => {
  test('requires a complete persisted request', () => {
    const request = quoted(intent())
    expect(() =>
      assertSessionQuoteCompatible({
        intent: intent(),
        account: account.address,
        request: { ...request, account: undefined } as never,
        sessions: sessions(),
      }),
    ).toThrow('complete persisted request')
    expect(() =>
      assertSessionQuoteCompatible({
        intent: intent(),
        account: account.address,
        request: { ...request, destination: undefined } as never,
        sessions: sessions(),
      }),
    ).toThrow('complete persisted request')
  })

  test('accepts the constrained request, including case-insensitive call prefixes', () => {
    const scoped: Session = {
      ...baseSession,
      permit2Sources: [{ chain: mainnet, token, maxAmount: 5n }],
      settlementLayers: ['CCTP'],
      swap: {
        to: account.address,
        sell: { token },
        buy: { token },
        via: [{ id: 'fynd' }],
      },
    }
    const input = intent({
      signers: { kind: 'smart-session', byChain: { 1: { session: scoped } } },
    })
    const prepared = sessions()
    const request = quoted(input, prepared)
    const sourceCalls = request.source!.execution!.calls.map((call) => ({
      ...call,
      to: call.to.toUpperCase() as typeof call.to,
      data: call.data.toUpperCase() as typeof call.data,
    }))
    const destinationCalls =
      request.destination.vm === 'evm'
        ? request.destination.execution!.calls.map((call) => ({
            ...call,
            to: call.to.toUpperCase() as typeof call.to,
            data: call.data.toUpperCase() as typeof call.data,
          }))
        : []
    assertSessionQuoteCompatible({
      intent: input,
      account: account.address,
      request: {
        ...request,
        source: { ...request.source!, execution: { calls: sourceCalls } },
        destination: {
          ...request.destination,
          execution: { calls: destinationCalls },
        } as never,
      },
      sessions: prepared,
    })
  })

  test.each([undefined, 5n])(
    'accepts persisted call values and source cap %s without rehydration',
    (maxAmount) => {
      const input = intent({
        source: { chain: sourceChain, token, maxAmount },
      })
      const request = restorePreparedBinding(
        JSON.parse(JSON.stringify(projectPreparedBinding(quoted(input)))),
      )
      assertSessionQuoteCompatible({
        intent: input,
        account: account.address,
        request,
        sessions: sessions(),
      })
    },
  )

  test.each(['cap', 'pre-claim', 'burn'] as const)(
    'rejects a changed persisted %s amount',
    (field) => {
      const input = intent({
        source: { chain: sourceChain, token, maxAmount: 5n },
      })
      const request = restorePreparedBinding(
        JSON.parse(JSON.stringify(projectPreparedBinding(quoted(input)))),
      )
      if (field === 'cap') {
        Object.assign(request.source!, { maxAmount: '6' })
      } else {
        const execution =
          field === 'pre-claim'
            ? request.source!.execution!
            : request.destination.vm === 'evm'
              ? request.destination.execution!
              : undefined
        Object.assign(execution!.calls[0]!, { value: '99' })
      }
      expectIncompatible({ intent: input, request })
    },
  )

  test.each([
    [
      'signature mode',
      (request: ReturnType<typeof quoted>) => ({
        ...request,
        account: { evm: { ...request.account.evm!, signatureMode: 1 } },
      }),
    ],
    [
      'mock signatures',
      (request: ReturnType<typeof quoted>) => ({
        ...request,
        account: {
          evm: {
            ...request.account.evm!,
            simulation: { mockSignaturesByChain: { 'eip155:1': '0xbbbb' } },
          },
        },
      }),
    ],
    [
      'settlement layers',
      (request: ReturnType<typeof quoted>) => ({
        ...request,
        options: {
          ...request.options,
          settlementLayers: { include: ['ACROSS'] },
        },
      }),
    ],
    [
      'quoters',
      (request: ReturnType<typeof quoted>) => ({
        ...request,
        options: { ...request.options, quoters: { include: ['0x'] } },
      }),
    ],
    [
      'source maximum',
      (request: ReturnType<typeof quoted>) => ({
        ...request,
        source: { ...request.source!, maxAmount: 99n },
      }),
    ],
  ])('rejects a changed %s', (_, change) => {
    const scoped: Session = {
      ...baseSession,
      permit2Sources: [{ chain: mainnet, token, maxAmount: 5n }],
      settlementLayers: ['CCTP'],
      swap: {
        to: account.address,
        sell: { token },
        buy: { token },
        via: [{ id: 'fynd' }],
      },
    }
    const input = intent({
      signers: { kind: 'smart-session', byChain: { 1: { session: scoped } } },
    })
    expectIncompatible({
      intent: input,
      request: change(quoted(input)) as never,
    })
  })

  test.each([
    ['missing', (_calls: readonly unknown[]) => []],
    [
      'target',
      (calls: readonly unknown[]) => [{ ...(calls[0] as object), to: token }],
    ],
    [
      'value',
      (calls: readonly unknown[]) => [{ ...(calls[0] as object), value: 0n }],
    ],
    [
      'data',
      (calls: readonly unknown[]) => [
        { ...(calls[0] as object), data: '0x00' },
      ],
    ],
  ])('rejects a %s pre-claim prefix', (_, alter) => {
    const request = quoted(intent())
    expectIncompatible({
      request: {
        ...request,
        source: {
          ...request.source!,
          execution: {
            calls: alter(request.source!.execution!.calls) as never,
          },
        },
      },
    })
  })

  test('requires a destination burn only when destination calls execute', () => {
    const request = quoted(intent())
    expectIncompatible({
      request: {
        ...request,
        destination: {
          ...request.destination,
          execution: { calls: [] },
        } as never,
      },
    })
    const noCalls = intent({ calls: [] })
    assertSessionQuoteCompatible({
      intent: noCalls,
      account: account.address,
      request: quoted(noCalls),
      sessions: sessions(),
    })
  })

  test('uses empty call fallbacks for no execution and non-EVM source or destination', () => {
    const prepared = sessions({ preClaimCalls: [], destinationBurn: undefined })
    const request = quoted(intent({ calls: [] }), prepared)
    assertSessionQuoteCompatible({
      intent: intent({ calls: [] }),
      account: account.address,
      request,
      sessions: prepared,
    })
    assertSessionQuoteCompatible({
      intent: intent({ calls: [] }),
      account: account.address,
      request: {
        ...request,
        source: { ...request.source!, vm: 'svm' },
        destination: { vm: 'svm', chainId: 'solana:devnet', token: 'mint' },
      },
      sessions: prepared,
    })
  })
})
