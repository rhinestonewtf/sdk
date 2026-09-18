import type { Address } from 'viem'
import { describe, expect, test } from 'vitest'
import { projectCompatibleIntentInput } from '../../clients/orchestrator/normalized'
import { computeIntentInputDigest } from '../../jwt-server/digest'
import { shouldSponsor } from '../../jwt-server/sponsorship'
import type { IntentAccountProjection } from './account'
import { buildIntentRequest } from './request'

const ACCOUNT = '0x0000000000000000000000000000000000000010' as Address
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Address
const FACTORY = '0x0000000000000000000000000000000000000020' as Address

const account: IntentAccountProjection = {
  kind: 'erc7579',
  address: ACCOUNT,
  setupOps: [{ to: FACTORY, data: '0xdeadbeef' }],
}

function build() {
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
    },
    account,
    calls: [{ target: USDC, value: 0n, data: '0xabcd' }],
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
})
