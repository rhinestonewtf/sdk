import { type Address, decodeAbiParameters, keccak256, toHex } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  generateWebauthnCredentialId,
  hasDuplicateWebauthnCredentials,
  orderWebauthnCredentials,
  resolveWebauthnCredentials,
  type WebauthnInstallCredential,
  webauthnCredentialsAreAscending,
} from './webauthn'

const ACCOUNT: Address = '0x44C3Ec6c98f39Fb0a406ea2A948f923E60aF80C5'

function credential(x: bigint, y: bigint): WebauthnInstallCredential {
  return { pubKeyX: x, pubKeyY: y, requireUV: false }
}

function publicKeyBytes(tag: string): `0x${string}` {
  return `0x${keccak256(toHex(`x:${tag}`)).slice(2)}${keccak256(toHex(`y:${tag}`)).slice(2)}`
}

function installedCredentials(initData: `0x${string}`) {
  return decodeAbiParameters(
    [
      { name: 'threshold', type: 'uint256' },
      {
        name: 'credentials',
        type: 'tuple[]',
        components: [
          { name: 'pubKeyX', type: 'uint256' },
          { name: 'pubKeyY', type: 'uint256' },
          { name: 'requireUV', type: 'bool' },
        ],
      },
    ],
    initData,
  )[1]
}

describe('WebAuthn credential ordering', () => {
  test('canonical ordering is by public key value and permutation independent', () => {
    const credentials = [
      credential(3n, 1n),
      credential(1n, 9n),
      credential(1n, 2n),
    ]
    const canonical = orderWebauthnCredentials(credentials, {
      kind: 'canonical',
    })
    expect(canonical.map((entry) => [entry.pubKeyX, entry.pubKeyY])).toEqual([
      [1n, 2n],
      [1n, 9n],
      [3n, 1n],
    ])
    expect(
      orderWebauthnCredentials([...credentials].reverse(), {
        kind: 'canonical',
      }),
    ).toEqual(canonical)
  })

  test('credential-id ordering matches the validator ascending rule', () => {
    const credentials = [
      credential(11n, 12n),
      credential(13n, 14n),
      credential(15n, 16n),
    ]
    const ordered = orderWebauthnCredentials(credentials, {
      kind: 'credential-id',
      account: ACCOUNT,
    })
    expect(webauthnCredentialsAreAscending(ordered, ACCOUNT)).toBe(true)
    const ids = ordered.map((entry) =>
      generateWebauthnCredentialId(entry.pubKeyX, entry.pubKeyY, ACCOUNT),
    )
    expect([...ids].sort()).toEqual(ids)
  })

  test('ascending predicate rejects unsorted and duplicate credentials', () => {
    const first = credential(11n, 12n)
    const second = credential(13n, 14n)
    const ascending = orderWebauthnCredentials([first, second], {
      kind: 'credential-id',
      account: ACCOUNT,
    })
    expect(webauthnCredentialsAreAscending(ascending, ACCOUNT)).toBe(true)
    expect(
      webauthnCredentialsAreAscending([...ascending].reverse(), ACCOUNT),
    ).toBe(false)
    expect(webauthnCredentialsAreAscending([first, first], ACCOUNT)).toBe(false)
    expect(hasDuplicateWebauthnCredentials([first, second, first])).toBe(true)
    expect(hasDuplicateWebauthnCredentials([first, second])).toBe(false)
  })

  test('the same key sorts identically in compressed and uncompressed form', () => {
    const raw = publicKeyBytes('a')
    const other = publicKeyBytes('b')
    const asProvided = resolveWebauthnCredentials({
      credentials: [
        { pubKey: raw, authenticatorId: 'a' },
        { pubKey: other, authenticatorId: 'b' },
      ],
      threshold: 1,
      ordering: { kind: 'canonical' },
    })
    const prefixed = resolveWebauthnCredentials({
      credentials: [
        { pubKey: `0x04${other.slice(2)}`, authenticatorId: 'b' },
        { pubKey: `0x04${raw.slice(2)}`, authenticatorId: 'a' },
      ],
      threshold: 1,
      ordering: { kind: 'canonical' },
    })
    expect(prefixed.initData).toBe(asProvided.initData)
  })

  test('resolution keeps the caller order unless an ordering is requested', () => {
    const credentials = [
      { pubKey: publicKeyBytes('high'), authenticatorId: 'high' },
      { pubKey: publicKeyBytes('low'), authenticatorId: 'low' },
    ]
    const asProvided = installedCredentials(
      resolveWebauthnCredentials({ credentials, threshold: 1 }).initData,
    )
    const canonical = installedCredentials(
      resolveWebauthnCredentials({
        credentials,
        threshold: 1,
        ordering: { kind: 'canonical' },
      }).initData,
    )
    expect(asProvided.map((entry) => entry.pubKeyX)).toEqual(
      credentials.map((entry) => BigInt(entry.pubKey.slice(0, 66))),
    )
    expect(
      [...canonical].sort((a, b) => (a.pubKeyX < b.pubKeyX ? -1 : 1)),
    ).toEqual([...canonical])
  })
})
