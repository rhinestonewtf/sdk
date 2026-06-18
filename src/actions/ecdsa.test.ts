import { type Address, encodeAbiParameters, encodeFunctionData } from 'viem'
import { base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA, passkeyAccount } from '../../test/consts'
import { RhinestoneSDK } from '..'
import { resolveCallInputs } from '../execution/utils'
import { OWNABLE_VALIDATOR_ADDRESS } from '../modules/validators/core'
import {
  addOwner,
  changeThreshold,
  disable as disableEcdsa,
  enable as enableEcdsa,
  removeOwner,
} from './ecdsa'

// `enable` reads whether the Nexus default validator (OwnableValidator) is
// already initialized to decide between `onInstall` and a clear error. The test
// account isn't deployed, so stub the read.
vi.mock('../modules/read', async (importActual) => {
  const actual = await importActual<typeof import('../modules/read')>()
  return {
    ...actual,
    isValidatorInitialized: vi.fn().mockResolvedValue(false),
  }
})

// On Nexus the OwnableValidator is the default validator: `enable` initializes
// it via `onInstall(abi.encode(threshold, owners))` instead of `installModule`.
function expectedOnInstallCalldata(threshold: number, owners: Address[]) {
  const initData = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address[]' }],
    [
      BigInt(threshold),
      owners.map((owner) => owner.toLowerCase() as Address).sort(),
    ],
  )
  return encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'onInstall',
        inputs: [{ type: 'bytes', name: 'data' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'onInstall',
    args: [initData],
  })
}

const MOCK_OWNER_A = '0xd1aefebdceefc094f1805b241fa5e6db63a9181a'
const MOCK_OWNER_B = '0xeddfcb50d18f6d3d51c4f7cbca5ed6bdebc59817'
const MOCK_OWNER_C = '0xb31e76f19defe76edc4b7eceeb4b0a2d6ddaca39'
const accountAddress = '0x36C03e7D593F7B2C6b06fC18B5f4E9a4A29C99b0'

describe('ECDSA Actions', () => {
  // Enabling ECDSA on a passkey account is the real scenario: the OwnableValidator
  // (the Nexus default validator) is not initialized at deploy, so `enable`
  // initializes it via `onInstall`.
  describe('Install Ownable Validator', async () => {
    const read = await import('../modules/read')
    const rhinestone = new RhinestoneSDK({ apiKey: 'test' })
    const rhinestoneAccount = await rhinestone.createAccount({
      owners: {
        type: 'passkey',
        accounts: [passkeyAccount],
      },
    })

    beforeEach(() => {
      vi.mocked(read.isValidatorInitialized).mockResolvedValue(false)
    })

    test('1/1 Owners', async () => {
      const calls = await resolveCallInputs(
        [enableEcdsa([MOCK_OWNER_A])],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )
      expect(calls).toEqual([
        {
          to: OWNABLE_VALIDATOR_ADDRESS,
          value: 0n,
          data: expectedOnInstallCalldata(1, [MOCK_OWNER_A]),
        },
      ])
    })

    test('1/N Owners', async () => {
      const calls = await resolveCallInputs(
        [enableEcdsa([MOCK_OWNER_A, MOCK_OWNER_B])],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )
      expect(calls).toEqual([
        {
          to: OWNABLE_VALIDATOR_ADDRESS,
          value: 0n,
          data: expectedOnInstallCalldata(1, [MOCK_OWNER_A, MOCK_OWNER_B]),
        },
      ])
    })

    test('M/N Owners', async () => {
      const calls = await resolveCallInputs(
        [enableEcdsa([MOCK_OWNER_A, MOCK_OWNER_B, MOCK_OWNER_C], 2)],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )
      expect(calls).toEqual([
        {
          to: OWNABLE_VALIDATOR_ADDRESS,
          value: 0n,
          data: expectedOnInstallCalldata(2, [
            MOCK_OWNER_A,
            MOCK_OWNER_B,
            MOCK_OWNER_C,
          ]),
        },
      ])
    })

    test('throws when the default validator is already initialized on-chain', async () => {
      vi.mocked(read.isValidatorInitialized).mockResolvedValue(true)
      await expect(
        resolveCallInputs(
          [enableEcdsa([MOCK_OWNER_A])],
          rhinestoneAccount.config,
          base,
          accountAddress,
        ),
      ).rejects.toThrow(/ECDSA is already enabled/)
    })
  })

  // An ECDSA-configured account initializes the default validator at deployment,
  // so `enable` is redundant. This is detected from config without an on-chain
  // read, so it also holds for not-yet-deployed (counterfactual) accounts.
  describe('Enable on an account already configured with ECDSA', async () => {
    const read = await import('../modules/read')
    const rhinestone = new RhinestoneSDK({ apiKey: 'test' })
    const rhinestoneAccount = await rhinestone.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
    })

    test('throws without reading chain state', async () => {
      vi.mocked(read.isValidatorInitialized)
        .mockClear()
        .mockResolvedValue(false)
      await expect(
        resolveCallInputs(
          [enableEcdsa([MOCK_OWNER_A])],
          rhinestoneAccount.config,
          base,
          accountAddress,
        ),
      ).rejects.toThrow(/ECDSA is already enabled/)
      expect(read.isValidatorInitialized).not.toHaveBeenCalled()
    })
  })

  describe('Uninstall Ownable Validator', async () => {
    const rhinestone = new RhinestoneSDK({ apiKey: 'test' })
    const rhinestoneAccount = await rhinestone.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
    })

    test('', async () => {
      const calls = await resolveCallInputs(
        [disableEcdsa()],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )
      expect(calls).toEqual([
        {
          to: accountAddress,
          value: 0n,
          data: '0xa71763a80000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000013fdb5234e4e3162a810f54d9f7e9800000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000',
        },
      ])
    })
  })

  describe('Add Owner', () => {
    test('', () => {
      expect(addOwner(MOCK_OWNER_A)).toEqual({
        to: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
        value: 0n,
        data: '0x7065cb48000000000000000000000000d1aefebdceefc094f1805b241fa5e6db63a9181a',
      })
    })
  })

  describe('Remove Owner', () => {
    test('', () => {
      expect(removeOwner(MOCK_OWNER_A, MOCK_OWNER_B)).toEqual({
        to: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
        value: 0n,
        data: '0xfbe5ce0a000000000000000000000000d1aefebdceefc094f1805b241fa5e6db63a9181a000000000000000000000000eddfcb50d18f6d3d51c4f7cbca5ed6bdebc59817',
      })
    })
  })

  describe('Set Threshold', () => {
    test('', () => {
      expect(changeThreshold(1)).toEqual({
        to: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
        value: 0n,
        data: '0x960bfe040000000000000000000000000000000000000000000000000000000000000001',
      })
    })
  })
})
