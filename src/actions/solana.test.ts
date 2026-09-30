import { p256 } from '@noble/curves/nist'
import { bytesToHex, type Hex, hexToBytes } from 'viem'
import { toWebAuthnAccount } from 'viem/account-abstraction'
import { describe, expect, test } from 'vitest'
import { UnsupportedAccountCapabilityError } from '../errors/capability'
import { addPasskey, removePasskey } from './solana'

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
    ['an unknown permission', { permission: 'manageAuthority' }],
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
})
