import type { Address } from 'viem'
import { describe, expect, test } from 'vitest'
import { mapIntentRequestToWire } from '../../clients/orchestrator/mappers'
import { projectCompatibleIntentInput } from '../../clients/orchestrator/normalized'
import { assertSponsorshipApproval } from '../../clients/orchestrator/sponsorship-approval'
import { UnsupportedSponsorshipApprovalError } from '../../errors/execution'
import { computeIntentInputDigest } from '../../jwt-server/digest'
import { shouldSponsor } from '../../jwt-server/sponsorship'
import type { IntentAccountProjection } from './account'
import { buildIntentRequest } from './request'
import type { IntentInput } from './types'

const ACCOUNT = '0x0000000000000000000000000000000000000010' as Address
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Address
const FACTORY = '0x0000000000000000000000000000000000000020' as Address

const account: IntentAccountProjection = {
  kind: 'erc7579',
  address: ACCOUNT,
  setupOps: [{ to: FACTORY, data: '0xdeadbeef' }],
}

function build(
  overrides: Partial<IntentInput> = {},
  calls: Parameters<typeof buildIntentRequest>[0]['calls'] = [
    { target: USDC, value: 0n, data: '0xabcd' },
  ],
) {
  return buildIntentRequest({
    transaction: {
      destination: { kind: 'evm', id: 8453, caip2: 'eip155:8453' },
      calls: [],
      tokenRequests: [{ token: USDC, amount: 1_000_000n }],
      accountAccessList: {
        chainIds: [8453],
        chainTokenAmounts: { 1: { [USDC]: 5n } },
      },
      options: {
        sponsorSettings: { gas: true, bridgeFees: true, swapFees: false },
      },
      ...overrides,
    },
    account,
    calls,
    sourceCalls: {},
    providedFunds: {},
  })
}

// The wire migration is not allowed to change what an integrator's sponsorship
// policy sees, or what its JWT digest commits to. Both would silently
// invalidate every grant already issued.
describe('sponsorship callback compatibility', () => {
  test('the normalized input keeps numeric chain ids and its original names', () => {
    const input = projectCompatibleIntentInput(build().normalized)

    expect(input.destinationChainId).toBe(8453)
    expect(input.accountAccessList).toEqual({
      chainIds: [8453],
      chainTokenAmounts: { 1: { [USDC]: '5' } },
    })
    expect(input.options.sponsorSettings).toEqual({
      gas: true,
      bridgeFees: true,
      swapFees: false,
    })
    // Not the Caucasus spelling: the callback contract predates it.
    expect(input.options).not.toHaveProperty('sponsorship')
    expect(input).not.toHaveProperty('destination')
    expect(input).not.toHaveProperty('source')
  })

  test('the bundled /jwt-server filter still parses it', async () => {
    const input = projectCompatibleIntentInput(build().normalized)

    await expect(
      shouldSponsor(input, {
        chain: ({ id }) => id === 8453,
        account: (address) => address === ACCOUNT,
        calls: (calls) =>
          calls.length === 1 && calls[0]?.to === USDC && calls[0]?.value === 0n,
      }),
    ).resolves.toBe(true)
  })

  test('the digest is stable across builds of the same transaction', async () => {
    const digest = async () =>
      computeIntentInputDigest(projectCompatibleIntentInput(build().normalized))
    expect(await digest()).toBe(await digest())
  })

  test('the digest covers the normalized input, not the Caucasus request', async () => {
    const { request, normalized } = build()
    expect(
      await computeIntentInputDigest(projectCompatibleIntentInput(normalized)),
    ).not.toBe(await computeIntentInputDigest(request as never))
  })

  // The input stays the released one even where the Caucasus body cannot say
  // the same thing; such a request is refused for an intent-scoped grant, never
  // approved under an input that claims more than the body carries.
  test.each([
    ['chain ids beside per-chain assets', {}, 'accountAccessList.chainIds'],
    [
      'one token both capped and uncapped',
      {
        accountAccessList: {
          chainTokens: { 1: [USDC] },
          chainTokenAmounts: { 1: { [USDC]: 5n } },
        },
      },
      'accountAccessList.chainTokens',
    ],
    [
      'a HyperCore action on an EVM destination',
      {
        accountAccessList: undefined,
        options: {
          hyperCore: {
            action: { type: 'cancel', cancels: [{ a: 0, o: 1 }] },
          },
        },
      },
      'options.hyperCore',
    ],
    [
      'a configured recipient on a Solana destination',
      {
        destination: {
          kind: 'non-evm',
          namespace: 'solana',
          reference: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
          caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        },
        tokenRequests: [],
        accountAccessList: undefined,
        recipient: {
          kind: 'account',
          accountKind: 'erc7579',
          address: ACCOUNT,
          setupOps: [],
        },
      },
      'recipient.accountType',
    ],
  ] as const)(
    'refuses intent-scoped approval for %s',
    (_label, overrides, field) => {
      const { request, normalized } = build(
        overrides as never,
        'destination' in overrides ? [] : undefined,
      )
      let error: unknown
      try {
        assertSponsorshipApproval(
          mapIntentRequestToWire(request),
          projectCompatibleIntentInput(normalized),
        )
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

  test('binds the input of a request the body can represent', () => {
    const { request, normalized } = build({
      accountAccessList: { chainTokenAmounts: { 1: { [USDC]: 5n } } },
    })
    expect(() =>
      assertSponsorshipApproval(
        mapIntentRequestToWire(request),
        projectCompatibleIntentInput(normalized),
      ),
    ).not.toThrow()
  })
})
