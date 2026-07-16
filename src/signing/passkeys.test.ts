import type { Hex } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  generateCredentialId,
  packSignature,
  packSignatureV0,
  parsePublicKey,
  parseSignature,
} from './passkeys'

describe('rewritten passkey compatibility surface', () => {
  test('preserves parsing, credential, and packing shapes', () => {
    const publicKey = `0x04${'11'.repeat(32)}${'22'.repeat(32)}` as Hex
    const signature = `0x${'33'.repeat(32)}${'44'.repeat(32)}` as Hex
    expect(parsePublicKey(publicKey)).toEqual({
      x: BigInt(`0x${'11'.repeat(32)}`),
      y: BigInt(`0x${'22'.repeat(32)}`),
    })
    expect(parseSignature(signature)).toEqual({
      r: BigInt(`0x${'33'.repeat(32)}`),
      s: BigInt(`0x${'44'.repeat(32)}`),
    })
    const credentialId = generateCredentialId(
      parsePublicKey(publicKey).x,
      parsePublicKey(publicKey).y,
      '0x1111111111111111111111111111111111111111',
    )
    const assertion = {
      authenticatorData: '0x1234' as Hex,
      clientDataJSON: '{}',
      challengeIndex: 0n,
      typeIndex: 1n,
      ...parseSignature(signature),
    }
    expect(packSignature([credentialId], true, [assertion])).toMatch(/^0x/)
    expect(packSignatureV0(assertion, false)).toMatch(/^0x/)
  })
})
