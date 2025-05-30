import { describe, expect, test } from 'vitest'
import {
  accountA,
  accountB,
  MOCK_API_KEY,
  passkeyAccount,
} from '../../test/consts'
import { getSetup, getWebauthnValidatorSignature } from './index'

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
        '0x2483DA3A338895199E5e538530213157e931Bf06',
      )
      expect(setup.validators[0].type).toBe(1n)
    })

    test('should use webauthn validator for passkey owners', () => {
      const config = {
        rhinestoneApiKey: MOCK_API_KEY,
        owners: {
          type: 'passkey' as const,
          account: passkeyAccount,
        },
      }
      const setup = getSetup(config)

      expect(setup.validators).toHaveLength(1)
      expect(setup.validators[0].address).toBe(
        '0x2f167e55d42584f65e2e30a748f41ee75a311414',
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

  describe('WebAuthn Validator Signature', () => {
    test('default', () => {
      const signature = getWebauthnValidatorSignature({
        webauthn: {
          authenticatorData:
            '0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d00000000',
          clientDataJSON:
            '{"type":"webauthn.get","challenge":"tbxXNFS9X_4Byr1cMwqKrIGB-_30a0QhZ6y7ucM0BOE","origin":"http://localhost:3000","crossOrigin":false, "other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}',
          typeIndex:
            44941127272049826721201904734628716258498742255959991581049806490182030242267n,
        },
        signature:
          '0x00000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000001635bc6d0f68ff895cae8a288ecf7542a6a9cd555df784b73e1e2ea7e9104b1db15e9015d280cb19527881c625fee43fd3a405d5b0d199a8c8e6589a7381209e40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f47b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22746278584e465339585f3442797231634d77714b724947422d5f3330613051685a36793775634d30424f45222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a33303030222c2263726f73734f726967696e223a66616c73652c20226f746865725f6b6579735f63616e5f62655f61646465645f68657265223a22646f206e6f7420636f6d7061726520636c69656e74446174614a534f4e20616761696e737420612074656d706c6174652e205365652068747470733a2f2f676f6f2e676c2f796162506578227d000000000000000000000000',
        usePrecompiled: true,
      })

      expect(signature).toEqual(
        '0x00000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000120635bc6d0f68ff895cae8a288ecf7542a6a9cd555df784b73e1e2ea7e9104b1db00000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f47b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22746278584e465339585f3442797231634d77714b724947422d5f3330613051685a36793775634d30424f45222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a33303030222c2263726f73734f726967696e223a66616c73652c20226f746865725f6b6579735f63616e5f62655f61646465645f68657265223a22646f206e6f7420636f6d7061726520636c69656e74446174614a534f4e20616761696e737420612074656d706c6174652e205365652068747470733a2f2f676f6f2e676c2f796162506578227d000000000000000000000000',
      )
    })
  })
})
