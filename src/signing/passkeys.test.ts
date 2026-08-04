import type { Hex } from 'viem'
import { decodeAbiParameters, stringToBytes } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  generateCredentialId,
  packSignature,
  packSignatureV0,
  parsePublicKey,
  parseSignature,
} from './passkeys'

const P256_CURVE_ORDER =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
const P256_HALF_CURVE_ORDER = P256_CURVE_ORDER / 2n
const clientDataJSON =
  '{"note":"é","type":"webauthn.get","challenge":"abc","origin":"https://example.com"}'
const credentialId = `0x${'11'.repeat(32)}` as Hex

const currentSignatureParameters = [
  { type: 'bytes32[]', name: 'credIds' },
  { type: 'bool', name: 'usePrecompile' },
  {
    type: 'tuple[]',
    name: 'webAuthns',
    components: [
      { type: 'bytes', name: 'authenticatorData' },
      { type: 'string', name: 'clientDataJSON' },
      { type: 'uint256', name: 'challengeIndex' },
      { type: 'uint256', name: 'typeIndex' },
      { type: 'uint256', name: 'r' },
      { type: 'uint256', name: 's' },
    ],
  },
] as const

const v0SignatureParameters = [
  { type: 'bytes', name: 'authenticatorData' },
  { type: 'string', name: 'clientDataJSON' },
  { type: 'uint256', name: 'responseTypeLocation' },
  { type: 'uint256', name: 'r' },
  { type: 'uint256', name: 's' },
  { type: 'bool', name: 'usePrecompiled' },
] as const

function byteIndex(value: string, literal: string): bigint {
  return BigInt(stringToBytes(value.slice(0, value.indexOf(literal))).length)
}

describe('passkey compatibility surface', () => {
  test('preserves parsing and credential generation', () => {
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
    expect(
      generateCredentialId(
        parsePublicKey(publicKey).x,
        parsePublicKey(publicKey).y,
        '0x1111111111111111111111111111111111111111',
      ),
    ).toHaveLength(66)
  })

  test('derives current byte offsets and normalizes high-s assertions', () => {
    const encoded = packSignature([credentialId], true, [
      {
        authenticatorData: '0x1234',
        clientDataJSON,
        challengeIndex: 0n,
        typeIndex: 0n,
        r: 2n,
        s: P256_HALF_CURVE_ORDER + 1n,
      },
    ])
    const [, usePrecompile, assertions] = decodeAbiParameters(
      currentSignatureParameters,
      encoded,
    )

    expect(usePrecompile).toBe(true)
    expect(assertions[0]).toMatchObject({
      challengeIndex: byteIndex(clientDataJSON, '"challenge":"'),
      typeIndex: byteIndex(clientDataJSON, '"type":"webauthn.get"'),
      r: 2n,
      s: P256_HALF_CURVE_ORDER,
    })
  })

  test('derives the V0 type index and preserves low-s', () => {
    const encoded = packSignatureV0(
      {
        authenticatorData: '0x1234',
        clientDataJSON,
        typeIndex: 0,
        r: 2n,
        s: 3n,
      },
      false,
    )
    const [, , typeIndex, , s, usePrecompile] = decodeAbiParameters(
      v0SignatureParameters,
      encoded,
    )

    const expectedTypeIndex = byteIndex(clientDataJSON, '"type":"webauthn.get"')
    expect(typeIndex).toBe(expectedTypeIndex)
    expect(s).toBe(3n)
    expect(usePrecompile).toBe(false)
  })

  test('rejects client data without required literals', () => {
    expect(() =>
      packSignature([credentialId], false, [
        {
          authenticatorData: '0x1234',
          clientDataJSON: '{"type":"webauthn.get"}',
          challengeIndex: 0n,
          typeIndex: 0n,
          r: 2n,
          s: 3n,
        },
      ]),
    ).toThrow('required challenge field')
    expect(() =>
      packSignatureV0(
        {
          authenticatorData: '0x1234',
          clientDataJSON: '{"type": "webauthn.get"}',
          typeIndex: 0,
          r: 2n,
          s: 3n,
        },
        false,
      ),
    ).toThrow('required type field')
  })
})
