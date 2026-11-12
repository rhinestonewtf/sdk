import { getAddress, keccak256, toHex } from 'viem'
import { describe, expect, test } from 'vitest'
import { RhinestoneSDK } from '../../../src/index'
import {
  accountA,
  accountB,
  accountC,
  accountD,
  casingAccountHigh,
  casingAccountLow,
  collationAccountHigh,
  collationAccountLow,
} from '../../consts'
import {
  FIXTURE_SIGNERS,
  FIXTURES,
  fixtureKey,
  fixturePasskey,
  PASSKEY_PUBLIC_KEY,
} from './fixtures'

// The orchestrator funded these exact addresses; a config change that moves
// one orphans its funds.
describe('funded fixtures', () => {
  test.each(Object.values(FIXTURES))(
    '$name derives its pinned address',
    async (spec) => {
      const sdk = new RhinestoneSDK({ apiKey: 'unused' })
      const account = await sdk.createAccount(spec.config() as never)
      expect(getAddress(account.getAddress())).toBe(spec.address)
    },
  )

  test('keys are derived from readable labels', () => {
    expect(fixtureKey('owner')).toBe(keccak256(toHex('sdk-v1-parity:owner:v1')))
    expect(FIXTURE_SIGNERS.owner.address).toBe(
      '0x0a536FAd1c092c9eC93cCdC7Ca5f4ced14C9CDE7',
    )
    expect(FIXTURE_SIGNERS.session.address).toBe(
      '0x36C44f24F66739f4C1EAD544C9ca6f5288D55F15',
    )
    expect(PASSKEY_PUBLIC_KEY).toMatch(/^0xb8de2423[0-9a-f]{116}77fe$/)
  })

  test('no funded key reuses a seed key, whose account must stay unfunded', () => {
    const seeds = [
      accountA,
      accountB,
      accountC,
      accountD,
      casingAccountHigh,
      casingAccountLow,
      collationAccountHigh,
      collationAccountLow,
    ].map((account) => account.address)
    for (const signer of Object.values(FIXTURE_SIGNERS)) {
      expect(seeds).not.toContain(signer.address)
    }
  })

  test('the software passkey produces a WebAuthn assertion for the hash', async () => {
    const hash = keccak256(toHex('challenge'))
    const { signature, webauthn } = await fixturePasskey().sign({ hash })
    expect(signature).toMatch(/^0x[0-9a-f]{128}(1b|1c)$/)
    const challenge = JSON.parse(webauthn.clientDataJSON).challenge
    expect(Buffer.from(challenge, 'base64url').toString('hex')).toBe(
      hash.slice(2),
    )
    // Deterministic, so goldens and repeated runs stay comparable.
    expect((await fixturePasskey().sign({ hash })).signature).toBe(signature)
  })
})
