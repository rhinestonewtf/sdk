import { describe, expect, test } from 'vitest'
import {
  accountA,
  accountB,
  MOCK_API_KEY,
  passkeyAccount,
} from '../../test/consts'
import { getSetup } from './index'

describe('Modules', () => {
  describe('Setup', () => {
    test('should use ownable validator for ECDSA owners', () => {
      const config = {
        rhinestoneApiKey: MOCK_API_KEY,
        owners: {
          type: 'ecdsa' as const,
          accounts: [accountA],
          threshold: 1,
        },
      }
      const setup = getSetup(config)
      expect(setup.validators[0].address).toBe(
        '0x20C008719Ba9D8aA14C7d07D122cd5E965aA8da5',
      )
      expect(setup.validators[0].type).toBe(1n)
    })

    test('should use webauthn validator for passkey owners', () => {
      const config = {
        rhinestoneApiKey: MOCK_API_KEY,
        owners: {
          type: 'passkey' as const,
          accounts: [passkeyAccount],
        },
      }
      const setup = getSetup(config)

      expect(setup.validators).toHaveLength(1)
      expect(setup.validators[0].address).toBe(
        '0x0000000000578c4cB0e472a5462da43C495C3F33',
      )
      expect(setup.validators[0].type).toBe(1n)
    })

    test('should use smart session validator when sessions are enabled', () => {
      const config = {
        rhinestoneApiKey: MOCK_API_KEY,
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
          validator.address === '0x00000000002b0ecfbd0496ee71e01257da0e37de',
      )
      if (!smartSessionValidator) {
        return
      }
      expect(smartSessionValidator.type).toBe(1n)
    })

    test('should use smart session compatibility fallback for safe accounts with sessions', () => {
      const config = {
        rhinestoneApiKey: MOCK_API_KEY,
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
        account: {
          type: 'safe' as const,
        },
      }
      const setup = getSetup(config)

      const smartSessionFallback = setup.fallbacks.find(
        (fallback) =>
          fallback.address === '0x12cae64c42f362e7d5a847c2d33388373f629177',
      )
      expect(smartSessionFallback).toBeDefined()
      if (!smartSessionFallback) {
        return
      }
      expect(smartSessionFallback.type).toBe(3n)
    })

    test.todo('using the omni account should install the necessary modules')
  })
})
