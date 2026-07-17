import { encodeAbiParameters, encodeFunctionData } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { accountA, passkeyAccount } from '../../test/consts'
import { RhinestoneSDK } from '..'
import { resolveCallInputs } from '../execution/utils'
import {
  disable as disablePasskeys,
  enable as enablePasskeys,
} from './passkeys'

const rpcReadContract = vi.hoisted(() =>
  vi
    .fn()
    .mockResolvedValue([
      ['0x0000000000578c4cb0e472a5462da43c495c3f33'],
      '0x0000000000000000000000000000000000000001',
    ]),
)

vi.mock('../clients/rpc/compatibility', () => {
  return {
    materializeRpcReader: () => ({
      chain: { kind: 'evm', id: 8453, caip2: 'eip155:8453' },
      rpc: {
        getCode: vi.fn(),
        getTransactionCount: vi.fn(),
        readContract: rpcReadContract,
        multicall: vi.fn(),
      },
    }),
  }
})

const WEBAUTHN_VALIDATOR_ADDRESS =
  '0x0000000000578c4cb0e472a5462da43c495c3f33' as const

const UNINSTALL_MODULE_ABI = [
  {
    type: 'function',
    name: 'uninstallModule',
    inputs: [
      { type: 'uint256', name: 'moduleTypeId' },
      { type: 'address', name: 'module' },
      { type: 'bytes', name: 'deInitData' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const SENTINEL = '0x0000000000000000000000000000000000000001' as const

function expectedUninstallValidatorCalldata(validator: `0x${string}`) {
  // Validator is at head of the mocked SentinelList → prev = SENTINEL,
  // moduleDeInit = '0x'.
  const deInitData = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [SENTINEL, '0x'],
  )
  return encodeFunctionData({
    abi: UNINSTALL_MODULE_ABI,
    functionName: 'uninstallModule',
    args: [1n, validator, deInitData],
  })
}

const accountAddress = '0x36C03e7D593F7B2C6b06fC18B5f4E9a4A29C99b0'

describe('Passkeys Actions', () => {
  describe('Install WebAuthn Validator', async () => {
    const rhinestone = new RhinestoneSDK({ apiKey: 'test' })
    const rhinestoneAccount = await rhinestone.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
    })

    test('', async () => {
      const calls = await resolveCallInputs(
        [
          enablePasskeys({
            pubKey: passkeyAccount.publicKey,
            authenticatorId: passkeyAccount.id,
          }),
        ],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )
      expect(calls).toEqual([
        {
          to: accountAddress,
          value: 0n,
          data: '0x9517e29f00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000578c4cb0e472a5462da43c495c3f33000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d3737637d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d10000000000000000000000000000000000000000000000000000000000000000',
        },
      ])
    })
  })

  describe('Uninstall WebAuthn Validator', async () => {
    const rhinestone = new RhinestoneSDK({ apiKey: 'test' })
    const rhinestoneAccount = await rhinestone.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
    })

    test('', async () => {
      const calls = await resolveCallInputs(
        [disablePasskeys()],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )
      expect(calls).toEqual([
        {
          to: accountAddress,
          value: 0n,
          data: expectedUninstallValidatorCalldata(WEBAUTHN_VALIDATOR_ADDRESS),
        },
      ])
    })
  })
})
