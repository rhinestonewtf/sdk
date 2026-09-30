import type { Address } from 'viem'
import { describe, expect, test } from 'vitest'
import { mapIntentRequestToWire } from '../../clients/orchestrator/mappers'
import { projectSponsorshipApproval } from '../../clients/orchestrator/sponsorship-approval'
import type { IntentAccountProjection } from './account'
import { buildIntentRequest } from './request'
import type { IntentInput } from './types'

const ACCOUNT = '0x0000000000000000000000000000000000000010' as Address
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Address
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7' as Address
const FACTORY = '0x0000000000000000000000000000000000000020' as Address
const RECIPIENT_SMART_ACCOUNT =
  '0x0000000000000000000000000000000000000099' as Address

const account: IntentAccountProjection = {
  kind: 'erc7579',
  address: ACCOUNT,
  setupOps: [{ to: FACTORY, data: '0xdeadbeef' }],
}

const evmSource = { kind: 'evm', id: 1, caip2: 'eip155:1' } as const
const evmDestination = { kind: 'evm', id: 8453, caip2: 'eip155:8453' } as const
const hyperEvm = { kind: 'evm', id: 999, caip2: 'eip155:999' } as const
const hyperCoreVenue = {
  kind: 'evm',
  id: 1337002,
  caip2: 'hypercore:perp',
} as const
const tronChain = {
  kind: 'non-evm',
  namespace: 'tron',
  reference: 'mainnet',
  caip2: 'tron:mainnet',
} as const

function build(
  transaction: IntentInput,
  calls: Parameters<typeof buildIntentRequest>[0]['calls'] = [],
) {
  return buildIntentRequest({
    transaction,
    account,
    calls,
    sourceCalls: [],
    providedFunds: 0n,
  })
}

// The wire migration is not allowed to change what a sponsorship-scoped grant
// binds: for every representative shape, the approval input derived straight
// from the buildIntentRequest output (`intentInput`) must equal the one an
// approver derives independently from the wire body it receives
// (`projectSponsorshipApproval(mapIntentRequestToWire(request))`). If those
// ever disagreed, an integrator's grant could be approved against one body and
// bound to another.
describe('buildIntentRequest.intentInput matches projectSponsorshipApproval(wire)', () => {
  test.each([
    [
      'same-chain delivery',
      build({
        destination: evmDestination,
        source: { chain: evmDestination, token: USDC },
        calls: [],
        token: USDC,
        amount: 1_000_000n,
      }),
    ],
    [
      'cross-chain with source calls and auxiliary funds',
      build(
        {
          destination: evmDestination,
          source: {
            chain: evmSource,
            token: USDC,
            maxAmount: 2_000_000n,
            auxiliaryFunds: 100n,
            calls: [{ call: { target: USDC, value: 0n, data: '0x01' } }],
          },
          calls: [],
          token: USDC,
          amount: 1_000_000n,
        },
        [],
      ),
    ],
    [
      'source-free sponsored execution',
      build({
        destination: evmDestination,
        calls: [{ target: USDC, value: 0n, data: '0xabcd' }],
        options: {
          sponsorSettings: { gas: true, bridgeFees: true, swapFees: true },
        },
      }),
    ],
    [
      'HyperCore action with settlement',
      build(
        {
          destination: hyperCoreVenue as never,
          source: { chain: hyperEvm, token: USDC },
          calls: [{ target: USDC, value: 0n, data: '0x01' }],
          options: {
            hyperCore: {
              action: {
                type: 'updateLeverage',
                asset: 0,
                isCross: true,
                leverage: 5,
              },
            },
          },
        },
        [{ target: USDC, value: 0n, data: '0x01' }],
      ),
    ],
    [
      'Tron recipient',
      build({
        destination: tronChain,
        source: { chain: evmSource, token: USDT },
        calls: [],
        token: 'TRecipientToken',
        amount: 5_000n,
        recipient: { kind: 'bare', address: 'TRecipientAddress' },
      }),
    ],
    [
      'smart-account recipient',
      build({
        destination: evmDestination,
        source: { chain: evmSource, token: USDC },
        calls: [],
        token: USDC,
        amount: 1_000_000n,
        recipient: {
          kind: 'account',
          accountKind: 'erc7579',
          address: RECIPIENT_SMART_ACCOUNT,
          setupOps: [{ to: FACTORY, data: '0x01' }],
        },
      }),
    ],
  ])('%s', (_label, { request, intentInput }) => {
    const wire = mapIntentRequestToWire(request)
    expect(intentInput).toEqual(projectSponsorshipApproval(wire))

    const body = JSON.stringify(wire)
    for (const legacyKey of [
      'tokenRequests',
      'selection',
      'limits',
      'executions',
      'accountAccessList',
    ]) {
      expect(body).not.toContain(legacyKey)
    }
  })
})
