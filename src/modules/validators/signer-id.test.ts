import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import { passkeyAccount } from '../../../test/consts'
import { ecdsaSignerId, webauthnSignerId } from './signer-id'

describe('validator signer ids', () => {
  test('normalizes account objects and raw identities consistently', () => {
    const account = privateKeyToAccount(
      '0x2be89d993f98bbaab8b83f1a2830cb9414e19662967c7ba2a0f43d2a9125bd6d',
    )

    expect(ecdsaSignerId(account)).toBe(ecdsaSignerId(account.address))
    expect(webauthnSignerId(passkeyAccount)).toBe(
      webauthnSignerId(passkeyAccount.publicKey),
    )
  })
})
