import { concat, decodeAbiParameters, type Hex, pad, toHex } from 'viem'
import { describe, expect, test } from 'vitest'
import { withoutHostCollation } from '../../../test/utils/locale'
import { encodeValidatorContribution } from './contribution'
import { encodeMultiFactorContribution } from './multi-factor'
import { encodeEcdsaValidatorContribution } from './ownable'
import {
  encodeWebauthnSignatures,
  encodeWebauthnSignatureV0,
  encodeWebauthnValidatorContribution,
  generateWebauthnCredentialId,
  parseWebauthnSignature,
  WEBAUTHN_STATELESS_ACCOUNT,
} from './webauthn'

const validator = {
  kind: 'validator' as const,
  address: '0x1111111111111111111111111111111111111111' as const,
}
const account = '0x2222222222222222222222222222222222222222' as const
const p256CurveOrder =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
const p256HalfCurveOrder = p256CurveOrder / 2n
const raw = (byte: string, recovery = '00') =>
  `0x${byte.repeat(64)}${recovery}` as Hex

describe('validator contribution codecs', () => {
  test('orders ECDSA owners and separates signer from validator recovery encoding', () => {
    expect(
      encodeEcdsaValidatorContribution({
        ownerOrder: ['a', 'b'],
        threshold: 2,
        recoveryEncoding: 'validator-offset-4',
        contributions: [
          { ownerId: 'b', signature: raw('22', '1c'), encoding: 'raw-signer' },
          { ownerId: 'a', signature: raw('11'), encoding: 'raw-signer' },
        ],
      }),
    ).toBe(concat([raw('11', '1f'), raw('22', '20')]))

    expect(
      encodeEcdsaValidatorContribution({
        ownerOrder: ['a'],
        threshold: 1,
        recoveryEncoding: 'validator-offset-4',
        contributions: [
          {
            ownerId: 'a',
            signature: raw('11', '1f'),
            encoding: 'validator-contribution',
          },
        ],
      }),
    ).toBe(raw('11', '1f'))
  })

  test('rejects invalid ECDSA contribution sets before encoding', () => {
    const base = {
      ownerOrder: ['a'],
      threshold: 1,
      recoveryEncoding: 'ethereum' as const,
    }
    expect(() =>
      encodeEcdsaValidatorContribution({
        ...base,
        threshold: 0,
        contributions: [],
      }),
    ).toThrow('threshold')
    expect(() =>
      encodeEcdsaValidatorContribution({
        ...base,
        contributions: [
          { ownerId: 'b', signature: raw('11'), encoding: 'raw-signer' },
        ],
      }),
    ).toThrow('Unknown')
    expect(() =>
      encodeEcdsaValidatorContribution({
        ...base,
        contributions: [
          { ownerId: 'a', signature: raw('11'), encoding: 'raw-signer' },
          { ownerId: 'a', signature: raw('22'), encoding: 'raw-signer' },
        ],
      }),
    ).toThrow('Duplicate')
    expect(() =>
      encodeEcdsaValidatorContribution({ ...base, contributions: [] }),
    ).toThrow('Insufficient')
    expect(() =>
      encodeEcdsaValidatorContribution({
        ...base,
        contributions: [
          { ownerId: 'a', signature: '0x12', encoding: 'raw-signer' },
        ],
      }),
    ).toThrow('65 bytes')
    expect(() =>
      encodeEcdsaValidatorContribution({
        ...base,
        recoveryEncoding: 'validator-offset-4',
        contributions: [
          { ownerId: 'a', signature: raw('11', 'ff'), encoding: 'raw-signer' },
        ],
      }),
    ).toThrow('one byte')
  })

  test('packs WebAuthn contributions by credential identity', () => {
    const keys = [
      `0x04${'11'.repeat(32)}${'22'.repeat(32)}` as Hex,
      `0x04${'33'.repeat(32)}${'44'.repeat(32)}` as Hex,
    ]
    const contributions = keys.map((publicKey, index) => ({
      ownerId: `owner-${index}`,
      publicKey,
      signature: raw(index === 0 ? '55' : '66').slice(0, -2) as Hex,
      authenticatorData: `0x${'77'.repeat(37)}` as Hex,
      clientDataJSON: `{"type":"webauthn.get","challenge":"value-${index}"}`,
      challengeIndex: index,
      typeIndex: index + 1,
    }))
    const encoded = encodeWebauthnValidatorContribution({
      ownerOrder: ['owner-0', 'owner-1'],
      threshold: 2,
      account,
      usePrecompile: true,
      format: 'current',
      contributions: [contributions[1], contributions[0]],
    })
    const [credentialIds, usePrecompile, assertions] = decodeAbiParameters(
      [
        { type: 'bytes32[]' },
        { type: 'bool' },
        {
          type: 'tuple[]',
          components: [
            { type: 'bytes' },
            { type: 'string' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'uint256' },
          ],
        },
      ],
      encoded,
    )
    expect(usePrecompile).toBe(true)
    expect(credentialIds).toEqual([...credentialIds].sort())
    expect(assertions).toHaveLength(2)
    expect(assertions.map((assertion) => assertion.slice(2, 4))).toEqual([
      [23n, 1n],
      [23n, 1n],
    ])
  })

  test('normalizes WebAuthn low-level and V0 shapes', () => {
    const signature = {
      authenticatorData: '0x1234' as Hex,
      clientDataJSON: '{"note":"é","type":"webauthn.get","challenge":"value"}',
      challengeIndex: 0n,
      typeIndex: 0n,
      r: 2n,
      s: p256HalfCurveOrder + 1n,
    }
    const [, , assertions] = decodeAbiParameters(
      [
        { type: 'bytes32[]' },
        { type: 'bool' },
        {
          type: 'tuple[]',
          components: [
            { type: 'bytes' },
            { type: 'string' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'uint256' },
          ],
        },
      ],
      encodeWebauthnSignatures([`0x${'11'.repeat(32)}`], false, [signature]),
    )
    expect(assertions[0].slice(2)).toEqual([35n, 13n, 2n, p256HalfCurveOrder])

    const [, , typeIndex, , s] = decodeAbiParameters(
      [
        { type: 'bytes' },
        { type: 'string' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'bool' },
      ],
      encodeWebauthnSignatureV0(signature, false),
    )
    expect(typeIndex).toBe(13n)
    expect(s).toBe(p256HalfCurveOrder)

    expect(() => parseWebauthnSignature('0x12')).toThrow()
    expect(parseWebauthnSignature(raw('11'))).toEqual({
      r: BigInt(`0x${'11'.repeat(32)}`),
      s: BigInt(`0x${'11'.repeat(32)}`),
    })
    expect(generateWebauthnCredentialId(1n, 2n, account)).toHaveLength(66)
  })

  test('orders WebAuthn credential IDs by value, not by host collation', () => {
    const signature = {
      authenticatorData: '0x1234' as Hex,
      clientDataJSON: '{"type":"webauthn.get","challenge":"value"}',
      challengeIndex: 0n,
      typeIndex: 0n,
      r: 1n,
      s: 2n,
    }
    // 0xb1… collates before 0xaa… on Danish-family locales, but the validator
    // requires ascending credential IDs.
    const high = `0xb1${'11'.repeat(31)}` as Hex
    const low = `0xaa${'22'.repeat(31)}` as Hex
    const [credIds] = decodeAbiParameters(
      [
        { type: 'bytes32[]' },
        { type: 'bool' },
        {
          type: 'tuple[]',
          components: [
            { type: 'bytes' },
            { type: 'string' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'uint256' },
          ],
        },
      ],
      withoutHostCollation(() =>
        encodeWebauthnSignatures([high, low], false, [signature, signature]),
      ),
    )
    expect(credIds).toEqual([low, high])
  })

  test('rejects malformed WebAuthn owner sets', () => {
    const base = {
      ownerOrder: ['a'],
      threshold: 1,
      account,
      usePrecompile: false,
      format: 'current' as const,
      contributions: [],
    }
    expect(() =>
      encodeWebauthnValidatorContribution({ ...base, threshold: 0 }),
    ).toThrow('threshold')
    expect(() => encodeWebauthnValidatorContribution(base)).toThrow(
      'Insufficient',
    )
    const value = {
      ownerId: 'a',
      publicKey: `0x${'11'.repeat(64)}` as Hex,
      signature: `0x${'22'.repeat(64)}` as Hex,
      authenticatorData: '0x12' as Hex,
      clientDataJSON: '{}',
      challengeIndex: 0,
      typeIndex: 0,
    }
    expect(() =>
      encodeWebauthnValidatorContribution({
        ...base,
        contributions: [{ ...value, ownerId: 'b' }],
      }),
    ).toThrow('Unknown')
    expect(() =>
      encodeWebauthnValidatorContribution({
        ...base,
        contributions: [value, value],
      }),
    ).toThrow('Duplicate')
    expect(() =>
      encodeWebauthnValidatorContribution({
        ...base,
        format: 'v0',
        ownerOrder: ['a', 'b'],
        threshold: 1,
        contributions: [value, { ...value, ownerId: 'b' }],
      }),
    ).toThrow('exactly one')
  })

  test('carries a passkey factor as the assertions its validator decodes', () => {
    const publicKey = `0x${'44'.repeat(64)}` as Hex
    const factorContribution = encodeValidatorContribution(
      {
        kind: 'ordered-threshold',
        validator,
        ownerOrder: ['passkey'],
        threshold: 1,
        recoveryEncoding: 'ethereum',
        webauthn: {
          account: WEBAUTHN_STATELESS_ACCOUNT,
          usePrecompile: false,
          format: 'stateless',
          credentials: [{ ownerId: 'passkey', publicKey }],
        },
      },
      [
        {
          kind: 'webauthn',
          ownerId: 'passkey',
          publicKey,
          signature: `0x${'22'.repeat(64)}`,
          authenticatorData: '0x1234',
          clientDataJSON: '{"type":"webauthn.get","challenge":"value"}',
          challengeIndex: 0,
          typeIndex: 0,
          userVerificationRequired: false,
        },
      ],
    )
    const [factors] = decodeAbiParameters(
      [
        {
          type: 'tuple[]',
          components: [{ type: 'bytes32' }, { type: 'bytes' }],
        },
      ],
      encodeValidatorContribution(
        {
          kind: 'nested-threshold',
          validator,
          factorOrder: ['passkey'],
          threshold: 1,
        },
        [
          {
            kind: 'factor',
            factorId: 'passkey',
            publicId: 1,
            validator: account,
            contribution: factorContribution,
          },
        ],
      ),
    )
    const [assertions] = decodeAbiParameters(
      [
        {
          type: 'tuple[]',
          components: [
            { type: 'bytes' },
            { type: 'string' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'uint256' },
          ],
        },
      ],
      factors[0][1],
    )
    expect(assertions).toHaveLength(1)
    expect(assertions[0][0]).toBe('0x1234')
  })

  test('normalizes MFA ids and preserves configured factor order', () => {
    const encoded = encodeMultiFactorContribution({
      factorOrder: ['a', 'b'],
      threshold: 2,
      contributions: [
        {
          factorId: 'b',
          publicId: '0x02',
          validator: account,
          contribution: '0xbb',
        },
        {
          factorId: 'a',
          publicId: 1,
          validator: account,
          contribution: '0xaa',
        },
      ],
    })
    const [values] = decodeAbiParameters(
      [
        {
          type: 'tuple[]',
          components: [{ type: 'bytes32' }, { type: 'bytes' }],
        },
      ],
      encoded,
    )
    expect(values.map(([id]) => id)).toEqual([
      concat([pad(toHex(1), { size: 12 }), account]),
      concat([pad('0x02', { size: 12 }), account]),
    ])

    const base = {
      factorOrder: ['a'],
      threshold: 1,
      contributions: [
        {
          factorId: 'a',
          publicId: 1,
          validator: account,
          contribution: '0xaa' as Hex,
        },
      ],
    }
    expect(() =>
      encodeMultiFactorContribution({ ...base, threshold: 0 }),
    ).toThrow('threshold')
    expect(() =>
      encodeMultiFactorContribution({
        ...base,
        contributions: [{ ...base.contributions[0], factorId: 'unknown' }],
      }),
    ).toThrow('Unknown')
    expect(() =>
      encodeMultiFactorContribution({
        ...base,
        contributions: [base.contributions[0], base.contributions[0]],
      }),
    ).toThrow('Duplicate')
    expect(() =>
      encodeMultiFactorContribution({ ...base, contributions: [] }),
    ).toThrow('Insufficient')
  })

  test('dispatches atomic, nested, and session codecs explicitly', () => {
    expect(
      encodeValidatorContribution(
        {
          kind: 'ordered-threshold',
          validator,
          ownerOrder: ['a'],
          threshold: 1,
          recoveryEncoding: 'ethereum',
        },
        [
          {
            kind: 'ecdsa',
            ownerId: 'a',
            signature: raw('11'),
            encoding: 'raw-signer',
          },
        ],
      ),
    ).toBe(raw('11', '1b'))
    expect(
      encodeValidatorContribution(
        {
          kind: 'smart-session',
          validator,
          mode: 'pre-claim',
          permissionId: `0x${'99'.repeat(32)}` as Hex,
        },
        [{ kind: 'session', signature: raw('11') }],
      ),
    ).toContain(raw('11').slice(2))
    expect(() =>
      encodeValidatorContribution(
        {
          kind: 'ordered-threshold',
          validator,
          ownerOrder: ['a', 'b'],
          threshold: 1,
          recoveryEncoding: 'ethereum',
        },
        [
          {
            kind: 'ecdsa',
            ownerId: 'a',
            signature: raw('11'),
            encoding: 'raw-signer',
          },
          {
            kind: 'webauthn',
            ownerId: 'b',
            publicKey: `0x${'11'.repeat(64)}`,
            signature: `0x${'22'.repeat(64)}`,
            authenticatorData: '0x',
            clientDataJSON: '{}',
            challengeIndex: 0,
            typeIndex: 0,
            userVerificationRequired: false,
          },
        ],
      ),
    ).toThrow('mix')
    expect(() =>
      encodeValidatorContribution(
        {
          kind: 'ordered-threshold',
          validator,
          ownerOrder: ['passkey'],
          threshold: 1,
          recoveryEncoding: 'ethereum',
        },
        [
          {
            kind: 'webauthn',
            ownerId: 'passkey',
            publicKey: `0x${'11'.repeat(64)}`,
            signature: `0x${'22'.repeat(64)}`,
            authenticatorData: '0x',
            clientDataJSON: '{}',
            challengeIndex: 0,
            typeIndex: 0,
            userVerificationRequired: false,
          },
        ],
      ),
    ).toThrow('context')
    expect(() =>
      encodeValidatorContribution(
        {
          kind: 'ordered-threshold',
          validator,
          ownerOrder: ['a'],
          threshold: 1,
          recoveryEncoding: 'ethereum',
        },
        [{ kind: 'session', signature: raw('11') }],
      ),
    ).toThrow('incompatible')
    expect(() =>
      encodeValidatorContribution(
        {
          kind: 'nested-threshold',
          validator,
          factorOrder: ['a'],
          threshold: 1,
        },
        [{ kind: 'session', signature: raw('11') }],
      ),
    ).toThrow('non-factor')
    expect(() =>
      encodeValidatorContribution(
        {
          kind: 'smart-session',
          validator,
          mode: 'pre-claim',
          permissionId: `0x${'99'.repeat(32)}`,
        },
        [],
      ),
    ).toThrow('signer result is missing')
    expect(
      encodeValidatorContribution(
        {
          kind: 'smart-session',
          validator,
          mode: 'pre-claim',
          permissionId: `0x${'99'.repeat(32)}`,
          signerCodec: {
            kind: 'ordered-threshold',
            validator,
            ownerOrder: ['a', 'b'],
            threshold: 2,
            recoveryEncoding: 'ethereum',
          },
        },
        [
          {
            kind: 'ecdsa',
            ownerId: 'a',
            signature: raw('11'),
            encoding: 'raw-signer',
          },
          {
            kind: 'ecdsa',
            ownerId: 'b',
            signature: raw('22'),
            encoding: 'raw-signer',
          },
        ],
      ),
    ).toContain('9999')
    expect(
      encodeValidatorContribution(
        {
          kind: 'smart-session',
          validator,
          mode: 'notarized',
          permissionId: `0x${'99'.repeat(32)}`,
          claimPolicyData: '0x1234',
        },
        [{ kind: 'session', signature: raw('11') }],
      ),
    ).toContain('1234')
    const enableData = {
      userSignature: raw('22'),
      hashesAndChainIds: [
        { chainId: 1n, sessionDigest: `0x${'33'.repeat(32)}` as Hex },
      ],
      sessionToEnableIndex: 0,
      session: {
        sessionValidator: validator.address,
        sessionValidatorInitData: '0x' as const,
        salt: `0x${'00'.repeat(32)}` as Hex,
        erc7739Policies: {
          allowedERC7739Content: [],
          erc1271Policies: [],
        },
        actions: [],
        claimPolicies: [],
      },
    }
    expect(
      encodeValidatorContribution(
        {
          kind: 'smart-session',
          validator,
          mode: 'enable-and-use',
          permissionId: `0x${'99'.repeat(32)}`,
          enableData,
        },
        [{ kind: 'session', signature: raw('11') }],
      ),
    ).toMatch(/^0x01/)
    expect(() =>
      encodeValidatorContribution(
        {
          kind: 'smart-session',
          validator,
          mode: 'enable-and-use',
          permissionId: `0x${'99'.repeat(32)}`,
        },
        [{ kind: 'session', signature: raw('11') }],
      ),
    ).toThrow('enable data')
  })
})
