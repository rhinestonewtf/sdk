import {
  createPublicClient,
  decodeFunctionData,
  isAddress,
  isHex,
  type ReadContractParameters,
} from 'viem'
import { describe, expect, test, vi } from 'vitest'
import { accountA, accountB } from '../../../test/consts'
import { enableSessionsAbi } from '../abi/smart-sessions'
import { MODULE_TYPE_ID_VALIDATOR } from '../common'
import {
  encodeSmartSessionSignature,
  getEnableSessionCall,
  getPermissionId,
  getSmartSessionValidator,
  type SessionData,
  SMART_SESSION_MODE_USE,
} from './smart-sessions'

describe('Smart Sessions', () => {
  describe('Permission ID', () => {
    test('default', () => {
      expect(
        getPermissionId({
          owners: {
            type: 'ecdsa',
            accounts: [accountA, accountB],
          },
        }),
      ).toBe(
        '0xd3b39024e437b4cac278e33965b9a9326e81ee46bd45d890adbfc8eb45412fa1',
      )
    })

    test('with salt', () => {
      expect(
        getPermissionId({
          owners: {
            type: 'ecdsa',
            accounts: [accountA, accountB],
          },
          salt: '0x97340e1cfff3319c76ef22b2bc9d3231071d550125d68c9d4a8972823f166320',
        }),
      ).toBe(
        '0xeb47b4699298a847a0f6fb7365e56aefcc95630e7d0e3d9ca5917620c7dc3d08',
      )
    })
  })

  describe('Smart Session Validator', () => {
    test('no session', () => {
      expect(
        getSmartSessionValidator({
          owners: {
            type: 'ecdsa',
            accounts: [accountA],
          },
        }),
      ).toBeNull()
    })

    test('empty session list', () => {
      expect(
        getSmartSessionValidator({
          owners: {
            type: 'ecdsa',
            accounts: [accountA],
          },
          experimental_sessions: {
            enabled: true,
          },
        }),
      ).not.toBeNull()
    })

    test('single session', () => {
      const validator = getSmartSessionValidator({
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
        },
        experimental_sessions: {
          enabled: true,
        },
      })
      expect(validator).not.toBeNull()
      expect(validator?.type).toEqual(MODULE_TYPE_ID_VALIDATOR)
      expect(validator && isAddress(validator.address)).toEqual(true)
    })
  })

  describe('Enable Session Call', () => {
    vi.mock('viem', async (importOriginal) => {
      const actual = await importOriginal()

      return {
        // @ts-ignore
        ...actual,
        createPublicClient: vi.fn().mockReturnValue({
          readContract: vi.fn(),
        }),
      }
    })
    const client = createPublicClient as any
    client.mockImplementation((_: any) => {
      return {
        readContract: (params: ReadContractParameters) => {
          if (params.functionName === 'DOMAIN_SEPARATOR') {
            return '0xf5f6dfa751763cc5278cba45d03ea9797c1660b2cb7f5ffd188fa3e8523abdca'
          }
          throw new Error('Unknown function call')
        },
      }
    })

    const TARGET = '0x063DFbDb1610EC7BbfA1fFBE603Ac5aA1B67a935'
    const SELECTOR = '0x12345678'

    const FALLBACK_TARGET = '0x0000000000000000000000000000000000000001'
    const FALLBACK_SELECTOR = '0x00000001'

    test('default', async () => {
      const call = await getEnableSessionCall({
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
        },
      })
      const sessionData = toSessionData(call)

      // Should have a fallback action
      expect(
        sessionData.actions.some(
          (action) =>
            action.actionTarget === FALLBACK_TARGET &&
            action.actionTargetSelector === FALLBACK_SELECTOR,
        ),
      ).toEqual(true)
    })

    test('with action', async () => {
      const call = await getEnableSessionCall({
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
        },
        actions: [
          {
            target: TARGET,
            selector: SELECTOR,
          },
        ],
      })
      const sessionData = toSessionData(call)

      // Should have the action
      expect(
        sessionData.actions.some(
          (action) =>
            action.actionTarget === TARGET &&
            action.actionTargetSelector === SELECTOR,
        ),
      ).toEqual(true)
      // Should not have the fallback action
      expect(
        sessionData.actions.some(
          (action) =>
            action.actionTarget === FALLBACK_TARGET &&
            action.actionTargetSelector === FALLBACK_SELECTOR,
        ),
      ).toEqual(false)
    })

    test('with policy', async () => {
      const call = await getEnableSessionCall({
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
        },
        policies: [
          {
            type: 'sudo',
          },
          {
            type: 'universal-action',
            rules: [
              {
                condition: 'equal',
                calldataOffset: 0n,
                referenceValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
              },
            ],
          },
        ],
      })
      const sessionData = toSessionData(call)

      // Should have two policies
      expect(sessionData.userOpPolicies.length).toEqual(2)
      expect(isAddress(sessionData.userOpPolicies[0].policy)).toEqual(true)
      expect(isHex(sessionData.userOpPolicies[0].initData)).toEqual(true)
      expect(isAddress(sessionData.userOpPolicies[1].policy)).toEqual(true)
      expect(isHex(sessionData.userOpPolicies[1].initData)).toEqual(true)
    })

    test('with action policy', async () => {
      const call = await getEnableSessionCall({
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
        },
        actions: [
          {
            target: TARGET,
            selector: SELECTOR,
            policies: [
              {
                type: 'sudo',
              },
              {
                type: 'universal-action',
                rules: [
                  {
                    condition: 'equal',
                    calldataOffset: 0n,
                    referenceValue:
                      '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
                  },
                ],
              },
            ],
          },
        ],
      })
      const sessionData = toSessionData(call)

      // Should have the action
      const action = sessionData.actions.find(
        (action) =>
          action.actionTarget === TARGET &&
          action.actionTargetSelector === SELECTOR,
      )
      expect(action).toBeDefined()
      if (!action) {
        throw new Error('No action')
      }

      // Should have 2 policies
      const actionPolicies = action.actionPolicies
      expect(actionPolicies.length).toEqual(2)
      expect(isAddress(actionPolicies[0].policy)).toEqual(true)
      expect(isHex(actionPolicies[0].initData)).toEqual(true)
      expect(isAddress(actionPolicies[1].policy)).toEqual(true)
      expect(isHex(actionPolicies[1].initData)).toEqual(true)
    })

    function toSessionData(call: any): SessionData {
      expect(isHex(call.data)).toEqual(true)
      expect(isAddress(call.to)).toEqual(true)

      const decoded = decodeFunctionData({
        abi: enableSessionsAbi,
        data: call.data,
      })
      expect(decoded.functionName).toEqual('enableSessions')
      expect(decoded.args.length).toEqual(1)
      expect(decoded.args[0].length).toEqual(1)

      const session = decoded.args[0][0]
      return session
    }
  })

  describe('Encode Smart Session Signature', () => {
    test('use mode', () => {
      const permissionId =
        '0xd3b39024e437b4cac278e33965b9a9326e81ee46bd45d890adbfc8eb45412fa1'
      const signature = '0xabcdef'
      const sessionSignature = encodeSmartSessionSignature(
        SMART_SESSION_MODE_USE,
        permissionId,
        signature,
      )

      expect(sessionSignature).toEqual(
        '0x00d3b39024e437b4cac278e33965b9a9326e81ee46bd45d890adbfc8eb45412fa1abcdef',
      )
    })
  })
})
