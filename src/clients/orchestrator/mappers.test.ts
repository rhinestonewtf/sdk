import type { SignedAuthorization } from 'viem'
import { describe, expect, test } from 'vitest'
import { mapSignedIntentToWire } from './mappers'
import type { OrchestratorSignedIntent } from './types'

const address = '0x0000000000000000000000000000000000000001' as const

function authorization(chainId: number): SignedAuthorization {
  return {
    chainId,
    address,
    nonce: 7,
    yParity: 1,
    r: '0x01',
    s: '0x02',
  }
}

function signedIntent(
  authorizations?: OrchestratorSignedIntent['authorizations'],
): OrchestratorSignedIntent {
  return {
    intentId: 'intent-1',
    signatures: {
      origin: ['0x03', { preClaimSig: '0x04', notarizedClaimSig: '0x05' }],
      destination: '0x06',
      targetExecution: '0x07',
    },
    ...(authorizations ? { authorizations } : {}),
    dryRun: true,
  }
}

describe('mapSignedIntentToWire', () => {
  test('maps concrete and any-chain sponsor and recipient authorizations', () => {
    const result = mapSignedIntentToWire(
      signedIntent({
        sponsor: [authorization(8453), authorization(0)],
        recipient: [authorization(10), authorization(0)],
      }),
    )

    expect(result).toEqual({
      intentId: 'intent-1',
      signatures: {
        origin: ['0x03', { preClaimSig: '0x04', notarizedClaimSig: '0x05' }],
        destination: '0x06',
        targetExecution: '0x07',
      },
      authorizations: {
        sponsor: [
          {
            chainId: 'eip155:8453',
            address,
            nonce: 7,
            yParity: 1,
            r: '0x01',
            s: '0x02',
          },
          {
            chainId: 0,
            address,
            nonce: 7,
            yParity: 1,
            r: '0x01',
            s: '0x02',
          },
        ],
        recipient: [
          {
            chainId: 'eip155:10',
            address,
            nonce: 7,
            yParity: 1,
            r: '0x01',
            s: '0x02',
          },
          {
            chainId: 0,
            address,
            nonce: 7,
            yParity: 1,
            r: '0x01',
            s: '0x02',
          },
        ],
      },
      options: { dryRun: true },
    })
  })

  test('keeps omitted authorizations omitted', () => {
    expect(mapSignedIntentToWire(signedIntent())).not.toHaveProperty(
      'authorizations',
    )
  })

  test.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
    ['HyperCore L1', 1337],
    ['HyperCore spot', 1337001],
    ['HyperCore perp', 1337002],
    ['Tron', 728126428],
    ['Solana', 792703809],
  ])('rejects %s authorization chain IDs', (_name, chainId) => {
    expect(() =>
      mapSignedIntentToWire(
        signedIntent({ sponsor: [authorization(chainId)] }),
      ),
    ).toThrow(new Error(`Invalid EIP-7702 authorization chain ID: ${chainId}`))
  })
})
