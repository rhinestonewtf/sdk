import { describe, expect, test } from 'vitest'
import { OwnersFieldRequiredError } from '../accounts/error'
import { resolveAccountConfig, resolveSdkConfig } from './resolve'
import { assertAccountOwnersConfigured } from './validate'

const sdk = resolveSdkConfig({ apiKey: 'test' })

describe('account construction validation', () => {
  test('uses the public missing-owners error for smart accounts', () => {
    const config = resolveAccountConfig(sdk, { account: { type: 'safe' } })

    expect(() => assertAccountOwnersConfigured(config)).toThrow(
      OwnersFieldRequiredError,
    )
    expect(() => assertAccountOwnersConfigured(config)).toThrow(
      'Owners field is required for smart accounts',
    )
  })

  test('preserves delayed EOA validation when the EOA signer is absent', () => {
    const config = resolveAccountConfig(sdk, { account: { type: 'eoa' } })

    expect(() => assertAccountOwnersConfigured(config)).not.toThrow()
  })
})
