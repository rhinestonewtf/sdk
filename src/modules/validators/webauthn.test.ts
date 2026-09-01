import { type Address, decodeAbiParameters, keccak256, toHex } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  encodeWebauthnStatelessData,
  encodeWebauthnValidatorContribution,
  generateWebauthnCredentialId,
  hasDuplicateWebauthnCredentials,
  orderWebauthnCredentials,
  parseWebauthnPublicKey,
  resolveWebauthnCredentials,
  WEBAUTHN_STATELESS_ACCOUNT,
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

const STATELESS_DATA_ABI = [
  {
    name: 'context',
    type: 'tuple',
    components: [
      { name: 'usePrecompile', type: 'bool' },
      { name: 'threshold', type: 'uint256' },
      { name: 'credentialIds', type: 'bytes32[]' },
      {
        name: 'credentialData',
        type: 'tuple[]',
        components: [
          { name: 'pubKeyX', type: 'uint256' },
          { name: 'pubKeyY', type: 'uint256' },
          { name: 'requireUV', type: 'bool' },
        ],
      },
    ],
  },
  { name: 'account', type: 'address' },
] as const

const STATELESS_SIGNATURE_ABI = [
  {
    type: 'tuple[]',
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

const CREDENTIALS = ['stateless-a', 'stateless-b', 'stateless-c'].map(
  (tag) => ({ pubKey: publicKeyBytes(tag), authenticatorId: tag }),
)

function contribution(index: number) {
  return {
    ownerId: `owner-${index}`,
    publicKey: CREDENTIALS[index].pubKey,
    signature: `0x${'11'.repeat(32)}${'22'.repeat(32)}` as `0x${string}`,
    authenticatorData: `0x${'77'.repeat(37)}` as `0x${string}`,
    clientDataJSON: `{"type":"webauthn.get","challenge":"c-${index}"}`,
    challengeIndex: 0,
    typeIndex: 0,
  }
}

describe('WebAuthn stateless configuration', () => {
  test('satisfies every check the stateless validation path performs', () => {
    const [context, account] = decodeAbiParameters(
      STATELESS_DATA_ABI,
      encodeWebauthnStatelessData({ credentials: CREDENTIALS, threshold: 2 }),
    )
    expect(account).toBe(WEBAUTHN_STATELESS_ACCOUNT)
    expect(context.usePrecompile).toBe(false)
    expect(context.credentialIds).toHaveLength(context.credentialData.length)
    expect(context.credentialIds).toEqual(
      context.credentialData.map((credential) =>
        generateWebauthnCredentialId(
          credential.pubKeyX,
          credential.pubKeyY,
          account,
        ),
      ),
    )
    expect([...context.credentialIds].sort()).toEqual([
      ...context.credentialIds,
    ])
    expect(new Set(context.credentialIds).size).toBe(
      context.credentialIds.length,
    )
    expect(context.threshold).toBe(2n)
    expect(context.threshold).toBeLessThanOrEqual(
      BigInt(context.credentialIds.length),
    )
  })

  test('is credential-order independent', () => {
    expect(
      encodeWebauthnStatelessData({
        credentials: [...CREDENTIALS].reverse(),
        threshold: 1,
      }),
    ).toBe(
      encodeWebauthnStatelessData({ credentials: CREDENTIALS, threshold: 1 }),
    )
  })

  test('is not interchangeable with the validator install data', () => {
    const stateless = encodeWebauthnStatelessData({
      credentials: CREDENTIALS,
      threshold: 1,
    })
    const install = resolveWebauthnCredentials({
      credentials: CREDENTIALS,
      threshold: 1,
    }).initData
    expect(stateless).not.toBe(install)
    expect(() => installedCredentials(stateless)).toThrow()
    expect(() => decodeAbiParameters(STATELESS_DATA_ABI, install)).toThrow()
  })

  test('signs with the assertions alone, ordered as the configuration is', () => {
    const [assertions] = decodeAbiParameters(
      STATELESS_SIGNATURE_ABI,
      encodeWebauthnValidatorContribution({
        ownerOrder: ['owner-0', 'owner-1', 'owner-2'],
        threshold: 3,
        account: WEBAUTHN_STATELESS_ACCOUNT,
        usePrecompile: false,
        format: 'stateless',
        credentials: CREDENTIALS.map((credential, index) => ({
          ownerId: `owner-${index}`,
          publicKey: credential.pubKey,
        })),
        contributions: [contribution(2), contribution(0), contribution(1)],
      }),
    )
    const [context] = decodeAbiParameters(
      STATELESS_DATA_ABI,
      encodeWebauthnStatelessData({ credentials: CREDENTIALS, threshold: 3 }),
    )
    expect(assertions.map((assertion) => assertion.clientDataJSON)).toEqual(
      context.credentialData.map((credential) => {
        const index = CREDENTIALS.findIndex(
          (entry) =>
            parseWebauthnPublicKey(entry.pubKey).x === credential.pubKeyX,
        )
        return contribution(index).clientDataJSON
      }),
    )
  })

  test('rejects a partial signer set that is not the configured prefix', () => {
    const credentials = CREDENTIALS.map((credential, index) => ({
      ownerId: `owner-${index}`,
      publicKey: credential.pubKey,
    }))
    const configuredOrder = decodeAbiParameters(
      STATELESS_DATA_ABI,
      encodeWebauthnStatelessData({ credentials: CREDENTIALS, threshold: 1 }),
    )[0].credentialData.map((credential) =>
      CREDENTIALS.findIndex(
        (entry) =>
          parseWebauthnPublicKey(entry.pubKey).x === credential.pubKeyX,
      ),
    )
    const signWith = (indexes: readonly number[]) =>
      encodeWebauthnValidatorContribution({
        ownerOrder: ['owner-0', 'owner-1', 'owner-2'],
        threshold: 1,
        account: WEBAUTHN_STATELESS_ACCOUNT,
        usePrecompile: false,
        format: 'stateless',
        credentials,
        contributions: indexes.map(contribution),
      })
    expect(() => signWith([configuredOrder[0]])).not.toThrow()
    expect(() => signWith([configuredOrder[1]])).toThrow('lowest-ordered')
    expect(() => signWith([configuredOrder[0], configuredOrder[2]])).toThrow(
      'lowest-ordered',
    )
  })

  test('requires the configured credentials to check that prefix', () => {
    expect(() =>
      encodeWebauthnValidatorContribution({
        ownerOrder: ['owner-0'],
        threshold: 1,
        account: WEBAUTHN_STATELESS_ACCOUNT,
        usePrecompile: false,
        format: 'stateless',
        contributions: [contribution(0)],
      }),
    ).toThrow('configured credentials')
  })
})
