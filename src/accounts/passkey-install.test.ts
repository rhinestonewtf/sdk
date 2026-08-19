import { type Address, keccak256, toHex } from 'viem'
import { describe, expect, test } from 'vitest'
import type { WebauthnInstallCredential } from '../modules/validators/webauthn'
import { webauthnCredentialsAreAscending } from '../modules/validators/webauthn'
import { PasskeyConfigurationNotInstallableError } from './error'
import {
  accountSupportsSaltSearch,
  accountWithSaltAttempt,
  assertPasskeySetInstallable,
  MAX_DEPLOYMENT_PASSKEYS,
  selectPasskeyAccount,
} from './passkey-install'
import type { AccountDefinition } from './types'

const nexus: AccountDefinition = {
  kind: 'nexus',
  version: { source: 'default', profile: 'nexus-current-version' },
  salt: { source: 'default', profile: 'nexus-empty-calldata-salt' },
}
const safe: AccountDefinition = {
  kind: 'safe',
  version: { source: 'default', profile: 'safe-current-version' },
  adapter: { source: 'default', profile: 'safe-current-adapter' },
  nonce: { source: 'default', profile: 'safe-zero-nonce' },
}

function credentials(count: number): WebauthnInstallCredential[] {
  return Array.from({ length: count }, (_, index) => ({
    pubKeyX: BigInt(keccak256(toHex(`x:${index}`))),
    pubKeyY: BigInt(keccak256(toHex(`y:${index}`))),
    requireUV: false,
  }))
}

// Stands in for the account adapters: a deterministic address per candidate
// definition, so the search logic is exercised without deriving real accounts.
function fakeAddress(account: AccountDefinition): Address {
  const salt =
    account.kind === 'nexus' && account.salt.source === 'explicit'
      ? account.salt.value
      : account.kind === 'safe' && account.nonce.source === 'explicit'
        ? toHex(account.nonce.value, { size: 32 })
        : toHex(0, { size: 32 })
  return `0x${keccak256(salt).slice(26)}`
}

describe('passkey install selection', () => {
  test('attempt zero keeps the caller salt and later attempts are deterministic', () => {
    expect(accountWithSaltAttempt(nexus, 0)).toBe(nexus)
    const first = accountWithSaltAttempt(nexus, 1)
    expect(first).toEqual(accountWithSaltAttempt(nexus, 1))
    expect(first).not.toEqual(accountWithSaltAttempt(nexus, 2))
    if (first.kind !== 'nexus' || first.salt.source !== 'explicit') {
      throw new Error('expected an explicit nexus salt')
    }
    const explicit = accountWithSaltAttempt(
      { ...nexus, salt: { source: 'explicit', value: keccak256('0x') } },
      1,
    )
    expect(explicit).toEqual(first)

    for (const account of [
      {
        kind: 'kernel',
        version: { source: 'default', profile: 'kernel-current-version' },
        salt: { source: 'default', profile: 'kernel-zero-salt' },
      },
      {
        kind: 'startale',
        salt: { source: 'default', profile: 'startale-zero-salt' },
      },
    ] as const satisfies readonly AccountDefinition[]) {
      const attempt = accountWithSaltAttempt(account, 1)
      if (attempt.kind === 'hca' || attempt.kind === 'eoa') {
        throw new Error('expected a salted account')
      }
      expect(attempt).toEqual(accountWithSaltAttempt(account, 1))
      expect(attempt).not.toEqual(account)
    }

    const safeAttempt = accountWithSaltAttempt(safe, 3)
    if (
      safeAttempt.kind !== 'safe' ||
      safeAttempt.nonce.source !== 'explicit'
    ) {
      throw new Error('expected an explicit safe nonce')
    }
    expect(safeAttempt.nonce.value).toBeGreaterThan(0n)
  })

  test('accounts without a salt knob cannot be searched', () => {
    const hca: AccountDefinition = {
      kind: 'hca',
      factory: { source: 'default', profile: 'hca-canonical-factory' },
    }
    expect(accountSupportsSaltSearch(hca)).toBe(false)
    expect(accountSupportsSaltSearch({ kind: 'eoa' })).toBe(false)
    expect(accountSupportsSaltSearch(nexus)).toBe(true)
    expect(() => accountWithSaltAttempt(hca, 1)).toThrow(
      PasskeyConfigurationNotInstallableError,
    )
  })

  test('rejects duplicates and oversized deployment sets', () => {
    const [single] = credentials(1)
    expect(() =>
      assertPasskeySetInstallable({
        credentials: [single, single],
        atDeployment: true,
      }),
    ).toThrow('duplicate passkeys')
    expect(() =>
      assertPasskeySetInstallable({
        credentials: credentials(MAX_DEPLOYMENT_PASSKEYS + 1),
        atDeployment: true,
      }),
    ).toThrow('passkeys.addOwner')
    expect(() =>
      assertPasskeySetInstallable({
        credentials: credentials(MAX_DEPLOYMENT_PASSKEYS + 1),
        atDeployment: false,
      }),
    ).not.toThrow()
    expect(() =>
      assertPasskeySetInstallable({
        credentials: credentials(33),
        atDeployment: false,
      }),
    ).toThrow('at most 32 passkeys')
  })

  test('selects a salt whose address makes the set ascending', () => {
    const set = credentials(3)
    const selected = selectPasskeyAccount({
      account: nexus,
      credentials: set,
      fingerprint: keccak256(toHex('select')),
      deriveAddress: fakeAddress,
    })
    expect(webauthnCredentialsAreAscending(set, fakeAddress(selected))).toBe(
      true,
    )
    // Same inputs, same choice — the search must not depend on run order.
    expect(
      selectPasskeyAccount({
        account: nexus,
        credentials: set,
        fingerprint: keccak256(toHex('select:repeat')),
        deriveAddress: fakeAddress,
      }),
    ).toEqual(selected)
  })

  test('throws when no attempt in the budget installs the set', () => {
    const [duplicate] = credentials(1)
    expect(() =>
      selectPasskeyAccount({
        account: nexus,
        // No address makes the same credential ascending against itself, so the
        // search runs out of attempts.
        credentials: [duplicate, duplicate],
        fingerprint: keccak256(toHex('exhausted')),
        deriveAddress: fakeAddress,
        maxAttempts: 64,
      }),
    ).toThrow(PasskeyConfigurationNotInstallableError)
  })
})
