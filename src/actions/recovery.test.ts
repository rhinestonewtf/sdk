import { type Address, encodeFunctionData, type Hex } from 'viem'
import {
  toWebAuthnAccount,
  type WebAuthnAccount,
} from 'viem/account-abstraction'
import { base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA, accountB, accountC, accountD } from '../../test/consts'
import { RhinestoneSDK } from '..'
import { resolveCalls } from '../calls/resolve'
import { toEvmChainReference } from '../chains/caip2'
import type { CallInput } from '../config/account'
import { OWNABLE_VALIDATOR_ADDRESS } from '../modules/validators/ownable'
import { SOCIAL_RECOVERY_VALIDATOR_ADDRESS } from '../modules/validators/social-recovery'
import { WEBAUTHN_VALIDATOR_ADDRESS } from '../modules/validators/webauthn'

const rpcReadContract = vi.hoisted(() => vi.fn())
const rpcMulticall = vi.hoisted(() => vi.fn())

vi.mock('../clients/rpc/compatibility', () => {
  return {
    materializeRpcReader: () => ({
      chain: { kind: 'evm', id: 8453, caip2: 'eip155:8453' },
      rpc: {
        getCode: vi.fn(),
        getTransactionCount: vi.fn(),
        readContract: rpcReadContract,
        multicall: rpcMulticall,
      },
    }),
  }
})

import {
  enable as enableRecovery,
  recoverEcdsaOwnership,
  recoverPasskeyOwnership,
} from './recovery'

const accountAddress: Address = '0x36C03e7D593F7B2C6b06fC18B5f4E9a4A29C99b0'
const SENTINEL: Address = '0x0000000000000000000000000000000000000001'

// Extra passkeys, so rotation tests have distinct credentials to move between.
const passkeyAccountB: WebAuthnAccount = toWebAuthnAccount({
  credential: {
    id: 'GJ8FS0jJPfPGnAHnkYWkNw',
    publicKey:
      '0x1b2c46d1b4b1b6c9b1f8fbc9ba26d4b96a8ea79fbb0a3b1b5e0f2c7d3a4b5c6d7e8f90112233445566778899aabbccddeeff00112233445566778899aabbccdd',
  },
})
const passkeyAccountC: WebAuthnAccount = toWebAuthnAccount({
  credential: {
    id: 'Yk3TnPzQ5rWvB2xLmA9dKw',
    publicKey:
      '0x2f7e91a3c5d80b46e1f2a7c9d3b58604fa1e2d3c4b5a69788796a5b4c3d2e1f0092817263544536271809aabbccddeeff11223344556677889900aabbccddee11',
  },
})

// Resolvers emit `to`-shaped calls, while the internal `Call` type names the
// field `target`; assert against the shape actually produced.
type ResolvedCall = { to: Address; data: Hex; value: bigint }

async function resolveCallInputs(
  calls: readonly CallInput[],
  config: unknown,
  chain: { id: number },
  account: Address,
): Promise<ResolvedCall[]> {
  const resolved = await resolveCalls(calls as never, {
    account,
    chain: toEvmChainReference(chain.id),
    config: config as never,
  })
  return resolved as unknown as ResolvedCall[]
}

function ownableCall(
  functionName: 'addOwner' | 'removeOwner' | 'setThreshold',
  args: readonly unknown[],
) {
  const abi = {
    addOwner: [{ name: 'owner', type: 'address' }],
    removeOwner: [
      { name: 'prevOwner', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    setThreshold: [{ name: '_threshold', type: 'uint256' }],
  }[functionName]
  return {
    to: OWNABLE_VALIDATOR_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          inputs: abi,
          name: functionName,
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ],
      functionName,
      args: args as never,
    }),
  }
}

function ownershipIs(owners: readonly Address[], threshold: number) {
  rpcMulticall.mockResolvedValueOnce([
    { result: owners },
    { result: BigInt(threshold) },
  ])
}

async function ecdsaRecovery(
  config: unknown,
  newOwners: { accounts: (typeof accountA)[]; threshold?: number },
) {
  return recoverEcdsaOwnership({
    accountAddress,
    chain: base,
    config: config as never,
    newOwners: { type: 'ecdsa', ...newOwners },
  })
}

describe('Recovery Actions', () => {
  const rhinestone = new RhinestoneSDK({ apiKey: 'test' })
  const accountPromise = rhinestone.createAccount({
    owners: { type: 'ecdsa', accounts: [accountA] },
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Set up recovery', () => {
    test('installs the social recovery validator for a single guardian', async () => {
      const rhinestoneAccount = await accountPromise
      const calls = await resolveCallInputs(
        [enableRecovery([accountB], 1)],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )
      expect(calls).toHaveLength(1)
      // Module installation is executed by the account on itself.
      expect(calls[0].to).toBe(rhinestoneAccount.getAddress())
      // Installs at the social recovery module address, threshold 1, one guardian.
      expect(calls[0].data).toContain(
        SOCIAL_RECOVERY_VALIDATOR_ADDRESS.slice(2),
      )
      expect(calls[0].data?.toLowerCase()).toContain(
        accountB.address.slice(2).toLowerCase(),
      )
    })

    test('sorts guardians so onInstall accepts the list', async () => {
      const rhinestoneAccount = await accountPromise
      // Deliberately unsorted: the module reverts with NotSortedAndUnique
      // unless the guardian array is ascending and unique.
      const calls = await resolveCallInputs(
        [enableRecovery([accountD, accountB, accountC], 2)],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )
      const data = (calls[0].data ?? '').toLowerCase()
      const positions = [accountB, accountC, accountD].map((account) =>
        data.indexOf(account.address.slice(2).toLowerCase()),
      )
      expect(positions.every((position) => position !== -1)).toBe(true)
      const sortedAscending = [...positions].sort((a, b) => a - b)
      expect(positions).toEqual(sortedAscending)
    })
  })

  describe('Recover ECDSA ownership', () => {
    test('rotates a single owner to a different single owner', async () => {
      const rhinestoneAccount = await accountPromise
      ownershipIs([accountA.address.toLowerCase() as Address], 1)

      const calls = await ecdsaRecovery(rhinestoneAccount.config, {
        accounts: [accountB],
        threshold: 1,
      })

      // Add before remove: removing the only owner first would revert.
      expect(calls).toEqual([
        ownableCall('addOwner', [accountB.address.toLowerCase()]),
        ownableCall('removeOwner', [
          accountB.address.toLowerCase(),
          accountA.address.toLowerCase(),
        ]),
      ])
    })

    test('raises the threshold only after the new owners exist', async () => {
      const rhinestoneAccount = await accountPromise
      // 1-of-1 -> 2-of-2. setThreshold(2) reverts with InvalidThreshold while
      // the validator still has a single owner, so the add must come first.
      ownershipIs([accountA.address.toLowerCase() as Address], 1)

      const calls = await ecdsaRecovery(rhinestoneAccount.config, {
        accounts: [accountA, accountB],
        threshold: 2,
      })

      expect(calls).toEqual([
        ownableCall('addOwner', [accountB.address.toLowerCase()]),
        ownableCall('setThreshold', [2n]),
      ])
    })

    test('removes owners last, tracking the linked list for prevOwner', async () => {
      const rhinestoneAccount = await accountPromise
      const [a, b, c, d] = [accountA, accountB, accountC, accountD].map(
        (account) => account.address.toLowerCase() as Address,
      )
      ownershipIs([a, b, c], 2)

      const calls = await ecdsaRecovery(rhinestoneAccount.config, {
        accounts: [accountB, accountD],
        threshold: 2,
      })

      // D is prepended, so the list is [d, a, b, c]: prevOwner(a) is d, and
      // after a is dropped prevOwner(c) is b.
      expect(calls).toEqual([
        ownableCall('addOwner', [d]),
        ownableCall('removeOwner', [d, a]),
        ownableCall('removeOwner', [b, c]),
      ])
    })

    test('uses the sentinel when removing the head of the list', async () => {
      const rhinestoneAccount = await accountPromise
      const [a, b] = [accountA, accountB].map(
        (account) => account.address.toLowerCase() as Address,
      )
      // A is the head and no owner is added before it is removed.
      ownershipIs([a, b], 1)

      const calls = await ecdsaRecovery(rhinestoneAccount.config, {
        accounts: [accountB],
        threshold: 1,
      })

      expect(calls).toEqual([ownableCall('removeOwner', [SENTINEL, a])])
    })

    test('emits nothing when the owner set already matches', async () => {
      const rhinestoneAccount = await accountPromise
      ownershipIs([accountA.address.toLowerCase() as Address], 1)

      const calls = await ecdsaRecovery(rhinestoneAccount.config, {
        accounts: [accountA],
        threshold: 1,
      })

      expect(calls).toEqual([])
    })

    test('throws when the validator state cannot be read', async () => {
      const rhinestoneAccount = await accountPromise
      rpcMulticall.mockResolvedValueOnce([
        { error: new Error('reverted') },
        { result: 1n },
      ])

      await expect(
        ecdsaRecovery(rhinestoneAccount.config, { accounts: [accountB] }),
      ).rejects.toThrow('Failed to read existing owners or threshold')
    })
  })

  describe('Recover passkey ownership', () => {
    function credentialOf(account: WebAuthnAccount) {
      const key = account.publicKey.slice(2)
      return {
        pubKeyX: BigInt(`0x${key.slice(0, 64)}`),
        pubKeyY: BigInt(`0x${key.slice(64, 128)}`),
      }
    }

    function passkeyCall(
      functionName: 'addCredential' | 'removeCredential' | 'setThreshold',
      args: readonly unknown[],
    ) {
      const abi = {
        addCredential: [
          { name: 'pubKeyX', type: 'uint256' },
          { name: 'pubKeyY', type: 'uint256' },
          { name: 'requireUserVerification', type: 'bool' },
        ],
        removeCredential: [
          { name: 'pubKeyX', type: 'uint256' },
          { name: 'pubKeyY', type: 'uint256' },
        ],
        setThreshold: [{ name: '_threshold', type: 'uint256' }],
      }[functionName]
      return {
        to: WEBAUTHN_VALIDATOR_ADDRESS,
        value: 0n,
        data: encodeFunctionData({
          abi: [
            {
              inputs: abi,
              name: functionName,
              outputs: [],
              stateMutability: 'nonpayable',
              type: 'function',
            },
          ],
          functionName,
          args: args as never,
        }),
      }
    }

    test('adds the new credential before removing the lost one', async () => {
      const rhinestoneAccount = await accountPromise
      // The headline case: a 1-of-1 passkey account rotating to a new passkey.
      // removeCredential reverts with CannotRemoveCredential while
      // `credentials <= threshold`, so the add has to land first.
      rpcReadContract.mockResolvedValueOnce(1n)
      const { passkeyAccount } = await import('../../test/consts')
      const oldCredential = credentialOf(passkeyAccount)
      const newCredential = credentialOf(passkeyAccountB)

      const calls = await recoverPasskeyOwnership({
        accountAddress,
        chain: base,
        config: rhinestoneAccount.config as never,
        currentCredentials: [oldCredential],
        newOwners: { type: 'passkey', accounts: [passkeyAccountB] },
      })

      expect(calls).toEqual([
        passkeyCall('addCredential', [
          newCredential.pubKeyX,
          newCredential.pubKeyY,
          false,
        ]),
        passkeyCall('removeCredential', [
          oldCredential.pubKeyX,
          oldCredential.pubKeyY,
        ]),
      ])
    })

    test('raises the threshold only after the new credential exists', async () => {
      const rhinestoneAccount = await accountPromise
      rpcReadContract.mockResolvedValueOnce(1n)
      const { passkeyAccount } = await import('../../test/consts')
      const newCredential = credentialOf(passkeyAccountB)

      const calls = await recoverPasskeyOwnership({
        accountAddress,
        chain: base,
        config: rhinestoneAccount.config as never,
        currentCredentials: [credentialOf(passkeyAccount)],
        newOwners: {
          type: 'passkey',
          accounts: [passkeyAccount, passkeyAccountB],
          threshold: 2,
        },
      })

      expect(calls).toEqual([
        passkeyCall('addCredential', [
          newCredential.pubKeyX,
          newCredential.pubKeyY,
          false,
        ]),
        passkeyCall('setThreshold', [2n]),
      ])
    })

    test('does not re-add a kept credential when replacing one of several', async () => {
      const rhinestoneAccount = await accountPromise
      // `currentCredentials` is the full installed set, so a credential kept in
      // `newOwners` must not be added again — addCredential reverts with
      // CredentialAlreadyExists.
      rpcReadContract.mockResolvedValueOnce(1n)
      const { passkeyAccount } = await import('../../test/consts')
      const kept = credentialOf(passkeyAccount)
      const replaced = credentialOf(passkeyAccountC)
      const added = credentialOf(passkeyAccountB)

      const calls = await recoverPasskeyOwnership({
        accountAddress,
        chain: base,
        config: rhinestoneAccount.config as never,
        currentCredentials: [kept, replaced],
        newOwners: {
          type: 'passkey',
          accounts: [passkeyAccount, passkeyAccountB],
        },
      })

      expect(calls).toEqual([
        passkeyCall('addCredential', [added.pubKeyX, added.pubKeyY, false]),
        passkeyCall('removeCredential', [replaced.pubKeyX, replaced.pubKeyY]),
      ])
    })
  })
})
