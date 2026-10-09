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
        settlementLayers: ['SAME_CHAIN'],
      },
      'development',
    )
    expect(afterOnly.claim).toMatchObject({
      // source: shared-configs generated development address book
      spenders: ['0x8fA7720Eee299223f25De8DC03C68A28541dCD10'],
      sourceTokens: [{ chain: base, address: source }],
      destinationTokens: [{ chain: arbitrum, address: destination }],
      recipients: [{ chain: arbitrum, address: recipient }],
      permitDeadline: { min: 100n, max: undefined },
    })
    expect(afterOnly.fallbackPolicies).toEqual([
      { type: 'spending-limits', limits: [{ token: source, amount: 10n }] },
    ])

    const untilOnly = expandCrossChainPermit({ validUntil: 200n }, 'production')
    expect(untilOnly.claim.permitDeadline).toEqual({
      min: undefined,
      max: 200n,
    })
    expect(untilOnly.fallbackPolicies).toEqual([])
    expect(expandCrossChainPermit({}, 'production').fallbackPolicies).toEqual(
      [],
    )
  })

  test('bounds the permit deadline by the once-policy deadline', () => {
    expect(
      expandCrossChainPermit({ validUntil: 200n }, 'production', 150n).claim
        .permitDeadline,
    ).toEqual({ min: undefined, max: 150n })
    expect(
      expandCrossChainPermit({}, 'production', 150n).claim.permitDeadline,
    ).toEqual({ min: undefined, max: 150n })
  })

  test('refuses the retired Permit2 ECO arbiter, alone or beside others', () => {
    for (const settlementLayers of [['ECO'], ['ACROSS', 'ECO']] as const) {
      expect(() =>
        expandCrossChainPermit(
          { settlementLayers: [...settlementLayers] },
          'production',
        ),
      ).toThrow(expect.objectContaining({ code: 'RETIRED_PERMIT2_LAYER' }))
    }
  })

  test('admits only ACROSS when no layer is named', () => {
    for (const settlementLayers of [undefined, []]) {
      expect(
        expandCrossChainPermit(
          settlementLayers ? { settlementLayers } : {},
          'production',
        ).claim.spenders,
      ).toEqual([
        '0x28a4D41776968c1201A807ec51fFB405362B8882',
        '0xA162fabb9a0EeF2736485A587aAAB3d015e14224',
      ])
    }
  })

  test('keeps solver-network ECO blocked instead of authorizing the generic IntentExecutor adapter', () => {
    const { claim } = expandCrossChainPermit({}, 'production')
    // source: shared-configs generated production address book
    const intentExecutorAdapter =
      '0xa5DAC04a6cCF0eb19cE091b6B400Fc4FCD13Da1e' as const

    expect(claim.spenders).not.toContain(intentExecutorAdapter)
    expect(
      permit2ClaimPolicyMatchesMessage(claim, {
        ...message,
        spender: intentExecutorAdapter,
      }),
    ).toBe(false)
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
