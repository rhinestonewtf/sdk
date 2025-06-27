import { describe, expect, test } from 'vitest'

import { MOCK_API_KEY } from '../../test/consts'
import { accountA } from '../../test/consts'
import { createRhinestoneAccount } from '..'

import { trustAttester } from './registry'

describe('Actions', async () => {
  const rhinestoneAccount = await createRhinestoneAccount({
    owners: {
      type: 'ecdsa',
      accounts: [accountA],
    },
    rhinestoneApiKey: MOCK_API_KEY,
  })

  describe('Trust Attester', () => {
    test('should return the correct call', () => {
      const call = trustAttester(rhinestoneAccount)

      expect(call).toStrictEqual({
        data: '0xf05c04e1000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000333034e9f539ce08819e12c1b8cb29084d0000000000000000000000006d0515e8e499468dce9583626f0ca15b887f9d03',
        to: '0x000000000069e2a187aeffb852bf3ccdc95151b2',
      })
    })
  })
})
