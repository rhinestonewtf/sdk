import { zeroHash } from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import type { Permit2ClaimMessage } from '../../policies/claim/permit2'
import {
  expandCrossChainPermit,
  permit2ClaimPolicyMatchesMessage,
  resolvePermit2ClaimPolicy,
} from './claim'

const source = '0x0000000000000000000000000000000000000011' as const
const destination = '0x0000000000000000000000000000000000000022' as const
const recipient = '0x0000000000000000000000000000000000000033' as const
const spender = '0x0000000000000000000000000000000000000044' as const

const message = {
  permitted: [{ token: source, amount: 10n }],
  spender,
  nonce: 1n,
  deadline: 2n,
  mandate: {
    target: {
      recipient,
      tokenOut: [{ token: destination, amount: 9n }],
      targetChain: BigInt(arbitrum.id),
      fillExpiry: 3n,
    },
    minGas: 0n,
    originOps: { vt: zeroHash, ops: [] },
    destOps: { vt: zeroHash, ops: [] },
    q: zeroHash,
  },
} as unknown as Permit2ClaimMessage

describe('Smart Sessions claim policies', () => {
  test('expands restrictions and one-sided deadlines without widening them', () => {
    const afterOnly = expandCrossChainPermit(
      {
        from: [{ chain: base, token: source, maxAmount: 10n }],
        to: [{ chain: arbitrum, token: destination, recipient }],
        validAfter: 100n,
        recipientIsAccount: true,
        settlementLayers: ['ECO'],
      },
      'development',
    )
    expect(afterOnly.claim).toMatchObject({
      sourceTokens: [{ chain: base, address: source }],
      destinationTokens: [{ chain: arbitrum, address: destination }],
      recipients: [{ chain: arbitrum, address: recipient }],
      permitDeadline: { min: 100n, max: undefined },
    })
    expect(afterOnly.fallbackPolicies).toHaveLength(2)

    const untilOnly = expandCrossChainPermit({ validUntil: 200n }, 'production')
    expect(untilOnly.fallbackPolicies).toEqual([
      { type: 'time-frame', validUntil: 200_000, validAfter: 0 },
    ])
    expect(expandCrossChainPermit({}, 'production').fallbackPolicies).toEqual(
      [],
    )
  })

  test('checks every message restriction independently', () => {
    const matching = {
      type: 'permit2' as const,
      spenders: [spender],
      sourceTokens: [{ chain: base, address: source }],
      destinationTokens: [{ chain: arbitrum, address: destination }],
      recipients: [{ chain: arbitrum, address: recipient }],
    }
    expect(permit2ClaimPolicyMatchesMessage(matching, message)).toBe(true)
    expect(
      permit2ClaimPolicyMatchesMessage(
        { ...matching, spenders: [recipient] },
        message,
      ),
    ).toBe(false)
    expect(
      permit2ClaimPolicyMatchesMessage(
        {
          ...matching,
          sourceTokens: [{ chain: base, address: destination }],
        },
        message,
      ),
    ).toBe(false)
    expect(
      permit2ClaimPolicyMatchesMessage(
        {
          ...matching,
          destinationTokens: [{ chain: arbitrum, address: source }],
        },
        message,
      ),
    ).toBe(false)
    expect(
      permit2ClaimPolicyMatchesMessage(
        {
          ...matching,
          recipients: [{ chain: arbitrum, address: source }],
        },
        message,
      ),
    ).toBe(false)
    expect(
      permit2ClaimPolicyMatchesMessage(
        {
          ...matching,
          recipients: [{ chain: base, address: source }],
        },
        message,
      ),
    ).toBe(true)
  })

  test('projects every public claim field to Permit2 policy data', () => {
    expect(
      resolvePermit2ClaimPolicy({
        type: 'permit2',
        spenders: [spender],
        sourceTokens: [{ chain: base, address: source }],
        destinationTokens: [{ chain: arbitrum, address: destination }],
        recipients: [{ chain: arbitrum, address: 'any' }],
        recipientIsAccount: true,
        permitDeadline: { min: 1n, max: 2n },
        fillDeadline: [{ chain: arbitrum, min: 3n, max: 4n }],
      }),
    ).toEqual({
      type: 'permit2-claim',
      arbiters: [spender],
      tokensIn: [{ chainId: base.id, token: source }],
      tokensOut: [{ chainId: arbitrum.id, token: destination }],
      recipients: [{ chainId: arbitrum.id, recipient: 'any' }],
      recipientIsSponsor: true,
      expiryBounds: { min: 1n, max: 2n },
      fillExpiryBounds: [{ chainId: arbitrum.id, min: 3n, max: 4n }],
    })
  })
})
