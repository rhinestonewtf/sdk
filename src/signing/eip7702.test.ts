import type { Address, SignedAuthorization } from 'viem'
import { describe, expect, test, vi } from 'vitest'
import {
  createRequestedDelegationPlan,
  signRequestedDelegations,
} from './eip7702'
import type { SignerInvocationPort } from './types'

const signer = { id: 'ecdsa:0x01', kind: 'ecdsa' } as const
const delegate = '0x0000000000000000000000000000000000000099' as Address

const delegations = [
  { chainId: 8453, contract: delegate, nonce: 4 },
  { chainId: 42161, contract: delegate, nonce: 7 },
]

function authorization(chainId: number, nonce: number): SignedAuthorization {
  return { chainId, address: delegate, nonce, yParity: 0, r: '0x01', s: '0x02' }
}

function invoker(
  results: readonly (SignedAuthorization | undefined)[],
): SignerInvocationPort {
  let call = 0
  return {
    has: () => true,
    invoke: vi.fn(async () => {
      const result = results[call++]
      return result
        ? { kind: 'signed-authorization' as const, authorization: result }
        : { kind: 'ecdsa-signature' as const, signature: '0xdead' as const }
    }),
  }
}

describe('createRequestedDelegationPlan', () => {
  test('emits one unconditional stage per requested delegation', () => {
    const { plan, payloads } = createRequestedDelegationPlan({
      signer,
      delegations,
    })

    expect(plan.stages).toHaveLength(2)
    expect(Object.keys(payloads)).toHaveLength(2)
    // No delegation-code checkpoint and no `when` guard: the quote asked for
    // these, so producing fewer than it asked for would submit a proof vector
    // shorter than the request set.
    for (const stage of plan.stages) {
      expect(stage.checkpoint.kind).toBe('none')
      expect(stage.taskTemplates[0]).not.toHaveProperty('when')
      expect(stage.taskTemplates[0]?.invocationKind).toBe('sign-authorization')
    }
  })

  test('binds each payload to its own chain, delegate and nonce', () => {
    const { payloads } = createRequestedDelegationPlan({ signer, delegations })
    expect(Object.values(payloads)).toEqual(
      expect.arrayContaining([
        {
          kind: 'authorization',
          authorization: {
            contractAddress: delegate,
            chainId: 8453,
            nonce: 4,
          },
        },
        {
          kind: 'authorization',
          authorization: {
            contractAddress: delegate,
            chainId: 42161,
            nonce: 7,
          },
        },
      ]),
    )
  })
})

describe('signRequestedDelegations', () => {
  test('returns the authorizations in the order they were requested', async () => {
    const { authorizations } = await signRequestedDelegations({
      planInput: { signer, delegations },
      signerInvoker: invoker([authorization(8453, 4), authorization(42161, 7)]),
      checkpoints: { read: async () => [] },
    })

    expect(authorizations.map(({ chainId }) => chainId)).toEqual([8453, 42161])
  })

  test('refuses to return a short list when a signer did not produce one', async () => {
    await expect(
      signRequestedDelegations({
        planInput: { signer, delegations },
        signerInvoker: invoker([authorization(8453, 4), undefined]),
        checkpoints: { read: async () => [] },
      }),
    ).rejects.toThrow('Requested delegation 1 was not signed')
  })

  test('is a no-op when the quote asked for none', async () => {
    const { authorizations } = await signRequestedDelegations({
      planInput: { signer, delegations: [] },
      signerInvoker: invoker([]),
      checkpoints: { read: async () => [] },
    })
    expect(authorizations).toEqual([])
  })
})
