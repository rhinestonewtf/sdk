import { p256 } from '@noble/curves/nist'
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex, type Hex, hexToBytes } from 'viem'
import { toWebAuthnAccount } from 'viem/account-abstraction'
import { privateKeyToAccount, toAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import { UnsupportedAccountCapabilityError } from '../errors/capability'
import {
  addEcdsaKey,
  addPasskey,
  removeEcdsaKey,
  removePasskey,
} from './solana'

// Expected encodings come from noble, not from the code under test.
const secret = hexToBytes(`0x${'42'.repeat(32)}`)
const uncompressed = bytesToHex(p256.getPublicKey(secret, false)) as Hex
const compressed = bytesToHex(p256.getPublicKey(secret, true)) as Hex
const xy = `0x${uncompressed.slice(4)}` as Hex
const passkey = toWebAuthnAccount({ credential: { id: 'cred', publicKey: xy } })

describe('addPasskey and removePasskey', () => {
  test.each([
    ['a WebAuthn account', passkey],
    ['a 64-byte x‖y key', xy],
    ['a 65-byte uncompressed key', uncompressed],
    ['a 33-byte compressed key', compressed],
    ['an upper-case key', `0x${uncompressed.slice(2).toUpperCase()}` as Hex],
  ] as const)('compresses %s', (_name, input) => {
    expect(addPasskey(input, { permission: 'all' })).toStrictEqual({
      action: 'add',
      key: { type: 'passkey', publicKey: compressed },
      permission: 'all',
    })
    expect(removePasskey(input)).toStrictEqual({
      action: 'remove',
      key: { type: 'passkey', publicKey: compressed },
    })
  })

  test('uses the odd-y prefix when y is odd', () => {
    const x = 'aa'.repeat(32)
    expect(removePasskey(`0x${x}${'00'.repeat(31)}01`).key.publicKey).toBe(
      `0x03${x}`,
    )
  })

  test('returns frozen changes', () => {
    const change = addPasskey(passkey, { permission: 'allButManageAuthority' })
    expect(Object.isFrozen(change)).toBe(true)
    expect(Object.isFrozen(change.key)).toBe(true)
    expect(Object.isFrozen(removePasskey(passkey))).toBe(true)
  })

  test('omits the permission on a removal', () => {
    expect('permission' in removePasskey(passkey)).toBe(false)
  })

  test.each([
    ['a truncated key', `0x${'11'.repeat(63)}`],
    ['a 65-byte key without the 04 prefix', `0x05${'11'.repeat(64)}`],
    ['a 33-byte key without a compressed prefix', `0x04${'11'.repeat(32)}`],
    ['odd-length hex', '0x123'],
    ['non-hex', 'passkey'],
    ['an object that is not a WebAuthn account', { publicKey: compressed }],
    ['nothing', undefined],
  ])('refuses %s', (_name, input) => {
    for (const build of [
      () => addPasskey(input as Hex, { permission: 'all' }),
      () => removePasskey(input as Hex),
    ]) {
      expect(build).toThrow(UnsupportedAccountCapabilityError)
      try {
        build()
      } catch (error) {
        expect((error as UnsupportedAccountCapabilityError).context).toEqual({
          vm: 'solana',
          field: 'passkey',
        })
      }
    }
  })

  test.each([
    ['no options', undefined],
    ['no permission', {}],
    ['an unknown permission', { permission: 'programAll' }],
  ])('refuses an add with %s', (_name, options) => {
    const build = () => addPasskey(passkey, options as never)
    expect(build).toThrow(/needs a `permission`/)
    try {
      build()
    } catch (error) {
      expect((error as UnsupportedAccountCapabilityError).context).toEqual({
        vm: 'solana',
        field: 'permission',
      })
    }
  })

  test('adds a passkey that only manages authorities', () => {
    expect(
      addPasskey(passkey, { permission: 'manageAuthority' }),
    ).toStrictEqual({
      action: 'add',
      key: { type: 'passkey', publicKey: compressed },
      permission: 'manageAuthority',
    })
  })
})

// Expected encodings come from noble and viem, not from the code under test.
const k1Secret = `0x${'07'.repeat(32)}` as Hex
const k1Account = privateKeyToAccount(k1Secret)
const k1Uncompressed = bytesToHex(
  secp256k1.getPublicKey(hexToBytes(k1Secret), false),
) as Hex
const k1Compressed = bytesToHex(
  secp256k1.getPublicKey(hexToBytes(k1Secret), true),
) as Hex
const k1Xy = `0x${k1Uncompressed.slice(4)}` as Hex

/** A key whose y has the other parity from `k1Compressed`, both encodings from noble. */
function otherParityKey(): { uncompressed: Hex; compressed: Hex } {
  for (let i = 1; ; i++) {
    const secret = new Uint8Array(32).fill(i)
    const compressed = bytesToHex(secp256k1.getPublicKey(secret, true)) as Hex
    if (compressed.slice(0, 4) !== k1Compressed.slice(0, 4)) {
      const uncompressed = bytesToHex(secp256k1.getPublicKey(secret, false))
      return { uncompressed, compressed }
    }
  }
}

function expectRefusal(build: () => unknown, field: string, message: RegExp) {
  let caught: unknown
  try {
    build()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(UnsupportedAccountCapabilityError)
  const error = caught as UnsupportedAccountCapabilityError
  expect(error.context).toEqual({ vm: 'solana', field })
  expect(error.message).toMatch(message)
  return error
}

describe('addEcdsaKey and removeEcdsaKey', () => {
  test.each([
    ['a viem local account', k1Account],
    ['its 65-byte uncompressed key', k1Uncompressed],
    ['its 64-byte x‖y key', k1Xy],
    ['its 33-byte compressed key', k1Compressed],
    ['an upper-case key', `0x${k1Uncompressed.slice(2).toUpperCase()}` as Hex],
  ] as const)('compresses %s', (_name, input) => {
    expect(addEcdsaKey(input, { permission: 'manageAuthority' })).toStrictEqual(
      {
        action: 'add',
        key: { type: 'ecdsa', publicKey: k1Compressed },
        permission: 'manageAuthority',
      },
    )
    expect(removeEcdsaKey(input)).toStrictEqual({
      action: 'remove',
      key: { type: 'ecdsa', publicKey: k1Compressed },
    })
  })

  test('uses the prefix of y’s parity for both parities', () => {
    const other = otherParityKey()
    expect(removeEcdsaKey(other.uncompressed).key.publicKey).toBe(
      other.compressed,
    )
  })

  test.each(['all', 'allButManageAuthority', 'manageAuthority'] as const)(
    'keeps the %s permission',
    (permission) => {
      expect(addEcdsaKey(k1Compressed, { permission }).permission).toBe(
        permission,
      )
    },
  )

  test('returns frozen changes without a permission on a removal', () => {
    const added = addEcdsaKey(k1Account, { permission: 'all' })
    expect(Object.isFrozen(added)).toBe(true)
    expect(Object.isFrozen(added.key)).toBe(true)
    const removed = removeEcdsaKey(k1Account)
    expect(Object.isFrozen(removed)).toBe(true)
    expect('permission' in removed).toBe(false)
  })

  test('refuses an EVM address as a key', () => {
    for (const build of [
      () => addEcdsaKey(k1Account.address, { permission: 'all' }),
      () => removeEcdsaKey(k1Account.address),
    ]) {
      expectRefusal(build, 'key', /EVM address is not a public key/)
    }
  })

  test('refuses an uncompressed key that is off secp256k1', () => {
    // Flipping y's lowest bit keeps the shape and leaves the curve.
    const last = Number.parseInt(k1Uncompressed.slice(-2), 16) ^ 1
    const offCurve =
      `${k1Uncompressed.slice(0, -2)}${last.toString(16).padStart(2, '0')}` as Hex
    expectRefusal(() => removeEcdsaKey(offCurve), 'key', /secp256k1/)
    expectRefusal(
      () => removeEcdsaKey(`0x${offCurve.slice(4)}` as Hex),
      'key',
      /secp256k1/,
    )
  })

  test('refuses an uncompressed P-256 key', () => {
    const p256Key = bytesToHex(
      p256.getPublicKey(hexToBytes(`0x${'42'.repeat(32)}`), false),
    ) as Hex
    expectRefusal(() => removeEcdsaKey(p256Key), 'key', /secp256k1/)
  })

  test.each([
    ['32 bytes, which could be a private key', k1Secret],
    ['a 65-byte key without the 04 prefix', `0x05${'11'.repeat(64)}`],
    ['a 33-byte key without a compressed prefix', `0x04${'11'.repeat(32)}`],
    ['odd-length hex', '0x123'],
    ['non-hex', 'ecdsa'],
    ['nothing', undefined],
  ])('refuses %s without echoing it', (_name, input) => {
    const error = expectRefusal(
      () => addEcdsaKey(input as Hex, { permission: 'all' }),
      'key',
      /secp256k1 public key/,
    )
    if (typeof input === 'string' && input.length > 6) {
      expect(error.message).not.toContain(input.slice(2))
    }
  })

  test('refuses a WebAuthn account with a pointer to addPasskey', () => {
    expectRefusal(
      () => removeEcdsaKey(passkey as never),
      'key',
      /use `addPasskey`/,
    )
  })

  test('refuses an account that exposes no public key', () => {
    const custom = toAccount({
      address: k1Account.address,
      signMessage: async () => '0x',
      signTransaction: async () => '0x',
      signTypedData: async () => '0x',
    })
    expectRefusal(() => removeEcdsaKey(custom), 'key', /exposes no public key/)
    expectRefusal(
      () =>
        removeEcdsaKey({
          type: 'json-rpc',
          address: k1Account.address,
        } as never),
      'key',
      /exposes no public key/,
    )
  })

  test.each([
    ['no options', undefined],
    ['no permission', {}],
    ['an unknown permission', { permission: 'programAll' }],
  ])('refuses an add with %s', (_name, options) => {
    expectRefusal(
      () => addEcdsaKey(k1Compressed, options as never),
      'permission',
      /needs a `permission`/,
    )
  })
})
