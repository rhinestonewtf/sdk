import { type Address, encodeAbiParameters, encodeFunctionData } from 'viem'
import { base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA, passkeyAccount } from '../../test/consts'
import { RhinestoneSDK } from '..'
import { resolveCalls } from '../calls/resolve'
import { toEvmChainReference } from '../chains/caip2'
import type { CallInput } from '../config/account'

function resolveCallInputs(
  calls: readonly CallInput[],
  config: unknown,
  chain: { id: number },
  account: Address,
) {
  return resolveCalls(calls as never, {
    account,
    chain: toEvmChainReference(chain.id),
    config: config as never,
  })
}

import {
  addOwner,
  changeThreshold,
  disable as disableEcdsa,
  enable as enableEcdsa,
  removeOwner,
} from './ecdsa'

const rpcReadContract = vi.hoisted(() => vi.fn())

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

const OWNABLE_VALIDATOR_ADDRESS =
  '0x000000000013fdb5234e4e3162a810f54d9f7e98' as const

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

const MOCK_OWNER_A = '0xd1aefebdceefc094f1805b241fa5e6db63a9181a'
const MOCK_OWNER_B = '0xeddfcb50d18f6d3d51c4f7cbca5ed6bdebc59817'
const MOCK_OWNER_C = '0xb31e76f19defe76edc4b7eceeb4b0a2d6ddaca39'
const accountAddress = '0x36C03e7D593F7B2C6b06fC18B5f4E9a4A29C99b0'

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

describe('ECDSA Actions', () => {
  beforeEach(() => {
    rpcReadContract
      .mockReset()
      .mockImplementation(async (_context, request) =>
        request.functionName === 'isInitialized'
          ? false
          : [[OWNABLE_VALIDATOR_ADDRESS], SENTINEL],
      )
  })

  // Enabling ECDSA on a passkey account is the real scenario: the OwnableValidator
  // (the Nexus default validator) is not initialized at deploy, so `enable`
  // initializes it via `onInstall`.
  describe('Install Ownable Validator', async () => {
    const rhinestone = new RhinestoneSDK({ apiKey: 'test' })
    const rhinestoneAccount = await rhinestone.createAccount({
      owners: {
        type: 'passkey',
        accounts: [passkeyAccount],
      },
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
      rpcReadContract.mockResolvedValueOnce(true)
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
    const rhinestone = new RhinestoneSDK({ apiKey: 'test' })
    const rhinestoneAccount = await rhinestone.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
    })

    test('throws without reading chain state', async () => {
      rpcReadContract.mockClear()
      await expect(
        resolveCallInputs(
          [enableEcdsa([MOCK_OWNER_A])],
          rhinestoneAccount.config,
          base,
          accountAddress,
        ),
      ).rejects.toThrow(/ECDSA is already enabled/)
      expect(rpcReadContract).not.toHaveBeenCalled()
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
          data: expectedUninstallValidatorCalldata(OWNABLE_VALIDATOR_ADDRESS),
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
