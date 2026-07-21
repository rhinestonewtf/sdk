import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test, vi } from 'vitest'
import type { AccountRuntime } from '../../accounts/adapter'
import { toEvmChainReference } from '../../chains/caip2'
import { defineValidator } from '../../modules/validators/definition'
import { ECDSA_MOCK_SIGNATURE } from '../../modules/validators/ownable'
import { WEBAUTHN_MOCK_SIGNATURE } from '../../modules/validators/webauthn'
import type { SigningContext } from '../../signing/context'
import { createAccountSigningContext } from '../../signing/context'
import { hashUserOperation } from './hash'
import { getUserOperationNonceKey, readUserOperationNonce } from './nonce'
import { getUserOperationStatus, waitForUserOperationStatus } from './status'
import { getUserOperationStubSignature } from './validator-account'

const chain = toEvmChainReference(1)
const address = '0x0000000000000000000000000000000000000001' as const

describe('UserOperation domain', () => {
  test('calculates account-specific nonce keys and honors explicit keys', () => {
    expect(
      getUserOperationNonceKey({
        accountKind: 'safe',
        validator: address,
      }),
    ).toBe(BigInt(`${address}00000000`))
    expect(
      getUserOperationNonceKey({
        accountKind: 'kernel',
        validator: address,
      }),
    ).toBe(BigInt(`0x0000${address.slice(2)}0000`))
    for (const accountKind of ['nexus', 'startale', 'hca'] as const) {
      expect(
        getUserOperationNonceKey({ accountKind, validator: address }),
      ).toBe(0n)
    }
    expect(
      getUserOperationNonceKey({
        accountKind: 'safe',
        validator: address,
        requested: 42n,
      }),
    ).toBe(42n)
    expect(() =>
      getUserOperationNonceKey({ accountKind: 'eoa', validator: address }),
    ).toThrow('EOA accounts do not support UserOperations')
  })

  test('reads the EntryPoint nonce through the RPC port', async () => {
    const readContract = vi.fn(async () => 9n)
    await expect(
      readUserOperationNonce({
        rpc: {
          getCode: vi.fn(),
          getTransactionCount: vi.fn(),
          readContract,
          multicall: vi.fn(),
        },
        chain,
        sender: address,
        key: 3n,
      }),
    ).resolves.toBe(9n)
    expect(readContract).toHaveBeenCalledWith(
      { chain },
      expect.objectContaining({
        functionName: 'getNonce',
        args: [address, 3n],
      }),
    )
  })

  test('hashes an EntryPoint 0.7 UserOperation to the calibrated digest', () => {
    // Golden vector: viem's EntryPoint-0.7 getUserOperationHash for these fixed
    // inputs on chain 1. Locks the chainId/entryPoint/version we pass through.
    expect(
      hashUserOperation(chain, {
        sender: address,
        nonce: 0n,
        callData: '0x',
        callGasLimit: 1n,
        verificationGasLimit: 2n,
        preVerificationGas: 3n,
        maxFeePerGas: 4n,
        maxPriorityFeePerGas: 5n,
        signature: '0x',
      }),
    ).toBe('0x655e0337674fc3d5ae28948b8b1cec8d1cf595a9f8ee5d08fffea4bc409e780d')
  })

  test('builds an owner-validator stub and rejects unsupported accounts', () => {
    const owner = privateKeyToAccount(
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    )
    const validator = defineValidator({ type: 'ecdsa', accounts: [owner] })
    const runtime = {
      construction: {
        account: { kind: 'nexus' },
        owner: validator,
      },
      identity: { definition: { kind: 'nexus' }, address },
      adapter: {
        capabilities: {
          supportsUserOperations: true,
          supportsOriginSignatureReuse: true,
        },
      },
    } as AccountRuntime
    const context = createAccountSigningContext({
      runtime,
      purpose: 'user-operation',
      signerInvoker: { invoke: vi.fn() },
    })
    expect(getUserOperationStubSignature(runtime, context)).toMatch(/^0x/u)
    const unsupported = {
      ...runtime,
      adapter: {
        ...runtime.adapter,
        capabilities: {
          ...runtime.adapter.capabilities,
          supportsUserOperations: false,
        },
      },
    } as AccountRuntime
    expect(() => getUserOperationStubSignature(unsupported, context)).toThrow(
      'does not support UserOperations',
    )
    expect(
      getUserOperationStubSignature(runtime, {
        ...context,
        validator: { kind: 'passkey' },
      } as SigningContext),
    ).toBe(WEBAUTHN_MOCK_SIGNATURE)
    expect(
      getUserOperationStubSignature(runtime, {
        ...context,
        validator: {
          kind: 'multi-factor',
          validators: [
            { kind: 'passkey', owners: [] },
            { kind: 'ecdsa', owners: [{}, {}] },
          ],
        },
      } as unknown as SigningContext),
    ).toBe(
      `${WEBAUTHN_MOCK_SIGNATURE}${ECDSA_MOCK_SIGNATURE.slice(2).repeat(2)}`,
    )
  })

  test('polls until a receipt is available', async () => {
    const receipt = { success: true }
    const getReceipt = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(receipt)
    const sleep = vi.fn(async () => undefined)
    const submitted = {
      type: 'userop' as const,
      chain,
      hash: `0x${'11'.repeat(32)}` as const,
    }
    await expect(
      getUserOperationStatus({ bundler: { getReceipt } } as never, submitted),
    ).resolves.toMatchObject({ terminal: false })
    getReceipt
      .mockReset()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(receipt)
    await expect(
      waitForUserOperationStatus(
        { bundler: { getReceipt }, clock: { sleep } } as never,
        submitted,
      ),
    ).resolves.toMatchObject({ terminal: true, receipt })
    expect(sleep).toHaveBeenCalledWith(500)
  })
})
