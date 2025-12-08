import { describe, expect, test } from 'vitest'
import { accountA, accountB, passkeyAccount } from '../../test/consts'
import { MODULE_TYPE_ID_FALLBACK, MODULE_TYPE_ID_VALIDATOR } from './common'
import { getSetup } from './index'

describe('Modules', () => {
  describe('Setup', () => {
    test('should use ownable validator for ECDSA owners', () => {
      const config = {
        owners: {
          type: 'ecdsa' as const,
          accounts: [accountA],
          threshold: 1,
        },
      }
      const setup = getSetup(config)
      expect(setup.validators[0].address).toBe(
        '0x000000000013fdb5234e4e3162a810f54d9f7e98',
      )
      expect(setup.validators[0].type).toBe(MODULE_TYPE_ID_VALIDATOR)
    })

    test('should use webauthn validator for passkey owners', () => {
      const config = {
        owners: {
          type: 'passkey' as const,
          accounts: [passkeyAccount],
        },
      }
      const setup = getSetup(config)

      expect(setup.validators).toHaveLength(1)
      expect(setup.validators[0].address).toBe(
        '0x0000000000578c4cb0e472a5462da43c495c3f33',
      )
      expect(setup.validators[0].type).toBe(MODULE_TYPE_ID_VALIDATOR)
    })

    test('should use smart session validator when sessions are enabled', () => {
      const config = {
        owners: {
          type: 'ecdsa' as const,
          accounts: [accountA],
          threshold: 1,
        },
        sessions: [
          {
            owners: {
              type: 'ecdsa' as const,
              accounts: [accountB],
              threshold: 1,
            },
          },
        ],
      }
      const setup = getSetup(config)

      const smartSessionValidator = setup.validators.find(
        (validator) =>
          validator.address === '0x00000000008bdaba73cd9815d79069c247eb4bda',
      )
      if (!smartSessionValidator) {
        return
      }
      expect(smartSessionValidator.type).toBe(MODULE_TYPE_ID_VALIDATOR)
    })

    test('should use smart session compatibility fallback for safe accounts with sessions', () => {
      const config = {
        owners: {
          type: 'ecdsa' as const,
          accounts: [accountA],
          threshold: 1,
        },
        experimental_sessions: {
          enabled: true,
        },
        account: {
          type: 'safe' as const,
        },
      }
      const setup = getSetup(config)

      const smartSessionFallback = setup.fallbacks.find(
        (fallback) =>
          fallback.address === '0x000000000052e9685932845660777DF43C2dC496',
      )
      expect(smartSessionFallback).toBeDefined()
      if (!smartSessionFallback) {
        return
      }
      expect(smartSessionFallback.type).toBe(MODULE_TYPE_ID_FALLBACK)
    })

    test.todo('using the omni account should install the necessary modules')
  })
})
