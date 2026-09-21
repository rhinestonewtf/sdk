import { describe, expect, test } from 'vitest'
import { OwnersFieldRequiredError } from '../accounts/error'
import { RhinestoneSDK } from './sdk'

describe('RhinestoneSDK', () => {
  test('rejects missing owners asynchronously during account creation', async () => {
    const result = new RhinestoneSDK({ apiKey: 'offline' }).createAccount({
      account: { type: 'safe' },
    })

    expect(result).toBeInstanceOf(Promise)
    await expect(result).rejects.toThrowError(OwnersFieldRequiredError)
  })
})
