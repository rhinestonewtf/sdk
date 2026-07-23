import { concat } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test, vi } from 'vitest'
import type { AccountAdapter, AccountRuntime } from '../../accounts/adapter'
import type { AccountConstruction } from '../../accounts/types'
import { toEvmChainReference } from '../../chains/caip2'
import type { ContractRead, RpcReadContext } from '../../clients/rpc/types'
import { defineValidator } from '../../modules/validators/definition'
import { ecdsaSignerId } from '../../modules/validators/signer-id'
import { prepareUserOperation } from './prepare'
import {
  reconstructPreparedUserOperation,
  reconstructSignedUserOperation,
} from './reconstruct'
import { sendUserOperation } from './send'
import { signUserOperation } from './sign'
import { submitUserOperation } from './submit'
import type { UserOperationWorkflowContext } from './types'

const chain = toEvmChainReference(1)
const owner = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000001',
)
const selectedOwner = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000002',
)
const sender = '0x0000000000000000000000000000000000000010' as const
const signature = `0x${'11'.repeat(64)}1b` as const
const hash = `0x${'22'.repeat(32)}` as const
const selectedValidator = '0x0000000000000000000000000000000000000020' as const

function selectedOwnerSigners() {
  return {
    kind: 'owner' as const,
    validator: defineValidator({
      type: 'ecdsa' as const,
      accounts: [selectedOwner],
      module: selectedValidator,
    }),
    signerIds: [ecdsaSignerId(selectedOwner)],
  }
}

function runtime(): AccountRuntime {
  const construction: AccountConstruction = {
    account: {
      kind: 'nexus',
      version: { source: 'explicit', value: '1.2.0' },
      salt: { source: 'explicit', value: '0x' },
    },
    owner: defineValidator({ type: 'ecdsa', accounts: [owner] }),
    modules: [],
    setup: { validators: [], executors: [], hooks: [], fallbacks: [] },
    sessions: { enabled: false, environment: 'production' },
    chain,
    deployed: false,
  }
  const adapter = {
    account: construction.account,
    capabilities: {
      modular: true,
      supportsDeployment: true,
      supportsUserOperations: true,
      supportsEip7702Adoption: false,
      supportsSmartSessions: true,
      supportsOriginSignatureReuse: true,
      signatureEnvelope: { kind: 'none' },
    },
    getIdentity: () => ({ definition: construction.account, address: sender }),
    getDeploymentPlan: () => ({
      chain,
      address: sender,
      factory: sender,
      factoryData: '0x1234',
      deployed: false,
    }),
    encodeCalls: () => '0xabcd',
  } as unknown as AccountAdapter
  return {
    adapter,
    construction,
    identity: { definition: construction.account, address: sender },
  }
}

function context(
  overrides: Partial<UserOperationWorkflowContext<{ marker: boolean }>> = {},
): UserOperationWorkflowContext<{ marker: boolean }> {
  return {
    compatibilityConfig: { marker: true },
    account: { forChain: vi.fn(async () => runtime()) },
    rpc: {
      forChain: () => ({
        getCode: vi.fn(),
        getTransactionCount: vi.fn(),
        readContract: async <TResult>() => 7n as unknown as TResult,
        multicall: vi.fn(),
      }),
    },
    bundler: {
      getGasPrice: vi.fn(async () => ({
        maxFeePerGas: 10n,
        maxPriorityFeePerGas: 2n,
      })),
      estimateGas: vi.fn(async () => ({
        callGasLimit: 100n,
        verificationGasLimit: 200n,
        preVerificationGas: 300n,
      })),
      send: vi.fn(async () => hash),
      getReceipt: vi.fn(),
    },
    signerInvoker: {
      has: () => true,
      invoke: vi.fn(async () => ({
        kind: 'ecdsa-signature' as const,
        signature,
      })),
    },
    checkpoints: { read: vi.fn(async () => []) },
    clock: {
      now: () => 0,
      sleep: vi.fn(async () => undefined),
      timeout: <T>(promise: Promise<T>) => promise,
    },
    ...overrides,
  } satisfies UserOperationWorkflowContext<{ marker: boolean }>
}

const input = {
  chain,
  calls: [{ target: sender, value: 0n, data: '0x' as const }],
}

describe('UserOperation workflow', () => {
  test('uses the release nonce lane for a non-default Nexus validator', async () => {
    const readContract = vi.fn()
    const workflow = context({
      rpc: {
        forChain: () => ({
          getCode: vi.fn(),
          getTransactionCount: vi.fn(),
          readContract: async <TResult>(
            readContext: RpcReadContext,
            request: ContractRead<TResult>,
          ) => {
            readContract(readContext, request)
            return 7n as TResult
          },
          multicall: vi.fn(),
        }),
      },
      clock: {
        now: () => 0x12_34_56,
        sleep: vi.fn(async () => undefined),
        timeout: <T>(promise: Promise<T>) => promise,
      },
    })

    await prepareUserOperation(workflow, {
      ...input,
      signers: selectedOwnerSigners(),
    })

    // A validator other than the Nexus default is embedded in the nonce key,
    // with the clock timestamp as the lane.
    expect(readContract).toHaveBeenCalledWith(
      { chain },
      expect.objectContaining({
        args: [sender, BigInt(concat(['0x12345600', selectedValidator]))],
      }),
    )
  })

  test('uses the selected owner validator for nonce and signing', async () => {
    const readContract = vi.fn()
    const workflow = context({
      rpc: {
        forChain: () => ({
          getCode: vi.fn(),
          getTransactionCount: vi.fn(),
          readContract: async <TResult>(
            readContext: RpcReadContext,
            request: ContractRead<TResult>,
          ) => {
            readContract(readContext, request)
            return 7n as TResult
          },
          multicall: vi.fn(),
        }),
      },
    })
    const prepared = await prepareUserOperation(workflow, {
      ...input,
      signers: selectedOwnerSigners(),
    })

    expect(readContract).toHaveBeenCalledWith(
      { chain },
      expect.objectContaining({
        args: [sender, BigInt(concat(['0x00000000', selectedValidator]))],
      }),
    )
    expect(prepared.signing.effectiveSelection.signerIds).toEqual([
      ecdsaSignerId(selectedOwner),
    ])
  })

  test('prepares nonce, account call data, deployment, fees, gas, and signing plan', async () => {
    const workflow = context({
      paymaster: {
        getStubData: vi.fn(async () => ({
          paymaster: sender,
          paymasterData: '0x12' as const,
          paymasterVerificationGasLimit: 20n,
          paymasterPostOpGasLimit: 30n,
          isFinal: false,
        })),
        getData: vi.fn(async () => ({
          paymaster: sender,
          paymasterData: '0x34' as const,
        })),
      },
    })
    const prepared = await prepareUserOperation(workflow, {
      ...input,
      gasLimit: 111n,
    })

    expect(prepared.operation).toMatchObject({
      sender,
      nonce: 7n,
      factory: sender,
      factoryData: '0x1234',
      callData: '0xabcd',
      callGasLimit: 111n,
      verificationGasLimit: 200n,
      preVerificationGas: 300n,
      paymaster: sender,
      paymasterData: '0x34',
      paymasterVerificationGasLimit: 20n,
      paymasterPostOpGasLimit: 30n,
    })
    expect(workflow.paymaster?.getStubData).toHaveBeenCalledOnce()
    expect(workflow.paymaster?.getData).toHaveBeenCalledWith(
      chain,
      expect.objectContaining({
        callGasLimit: 111n,
        verificationGasLimit: 200n,
        preVerificationGas: 300n,
        paymasterData: '0x12',
      }),
    )
    expect(prepared.signing.tasks).toHaveLength(1)
    expect(prepared.hash).toMatch(/^0x[0-9a-f]{64}$/u)
  })

  test('skips final paymaster data when the stub is already final', async () => {
    const getData = vi.fn()
    const workflow = context({
      paymaster: {
        getStubData: vi.fn(async () => ({
          paymaster: sender,
          paymasterData: '0x12' as const,
          paymasterVerificationGasLimit: 20n,
          paymasterPostOpGasLimit: 30n,
          isFinal: true,
        })),
        getData,
      },
    })

    const prepared = await prepareUserOperation(workflow, input)

    expect(prepared.operation.paymasterData).toBe('0x12')
    expect(getData).not.toHaveBeenCalled()
  })

  test('signs using the UserOperation-purpose shared pipeline', async () => {
    const workflow = context()
    const prepared = await prepareUserOperation(workflow, input)
    const signed = await signUserOperation(workflow, prepared)

    expect(signed.operation.signature).toBe(signed.signature)
    expect(signed.transcript.planKind).toBe('user-operation')
    expect(workflow.signerInvoker.invoke).toHaveBeenCalledOnce()
  })

  test('submits and composes the full workflow', async () => {
    const workflow = context()
    const prepared = await prepareUserOperation(workflow, input)
    const signed = await signUserOperation(workflow, prepared)
    await expect(submitUserOperation(workflow, signed)).resolves.toEqual({
      type: 'userop',
      chain,
      hash,
    })
    await expect(sendUserOperation(workflow, input)).resolves.toMatchObject({
      type: 'userop',
      hash,
    })
  })

  test('reconstructs a prepared UserOperation from a rebuilt public shape', async () => {
    const workflow = context()
    const prepared = await prepareUserOperation(workflow, input)
    const operation = { ...prepared.operation, paymaster: sender }
    const reconstructed = await reconstructPreparedUserOperation(workflow, {
      chain,
      operation,
    })

    expect(reconstructed.operation).toEqual(operation)
    expect(reconstructed.input.chain).toEqual(chain)
    expect(reconstructed.signing.tasks).toHaveLength(1)
    // The signing hash tracks the rebuilt operation, so signing over a mutated
    // (e.g. paymaster-added) operation stays consistent.
    expect(reconstructed.signing.hash).toBe(reconstructed.hash)

    const signed = await signUserOperation(workflow, reconstructed)
    expect(signed.operation.paymaster).toBe(sender)
  })

  test('preserves selected owner signers when reconstructing UserOperations', async () => {
    const workflow = context()
    const operation = (await prepareUserOperation(workflow, input)).operation
    const signers = selectedOwnerSigners()
    const prepared = await reconstructPreparedUserOperation(workflow, {
      chain,
      operation,
      signers,
    })

    expect(prepared.input.signers).toBe(signers)
    expect(prepared.signing.effectiveSelection.signerIds).toEqual([
      ecdsaSignerId(selectedOwner),
    ])

    const signed = await reconstructSignedUserOperation(workflow, {
      chain,
      operation,
      signature,
      signers,
    })

    expect(signed.prepared.input.signers).toBe(signers)
    expect(signed.prepared.signing.effectiveSelection.signerIds).toEqual([
      ecdsaSignerId(selectedOwner),
    ])
  })

  test('reconstructs a signed UserOperation for submission without bundler reads', async () => {
    const workflow = context()
    const reconstructed = await reconstructSignedUserOperation(workflow, {
      chain,
      operation: {
        sender,
        nonce: 0n,
        callData: '0x',
        callGasLimit: 1n,
        verificationGasLimit: 1n,
        preVerificationGas: 1n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        signature: '0x',
      },
      signature,
    })

    expect(reconstructed.signature).toBe(signature)
    expect(reconstructed.operation.signature).toBe(signature)
    expect(reconstructed.transcript.planKind).toBe('user-operation')
    // Reconstruction derives the signing plan from static config only.
    expect(workflow.bundler.getGasPrice).not.toHaveBeenCalled()
    expect(workflow.bundler.estimateGas).not.toHaveBeenCalled()

    await expect(
      submitUserOperation(workflow, {
        ...reconstructed,
        operation: { ...reconstructed.operation, signature: '0xdead' },
      }),
    ).resolves.toEqual({
      type: 'userop',
      chain,
      hash,
    })
    expect(workflow.bundler.send).toHaveBeenCalledWith(
      chain,
      expect.objectContaining({ signature }),
    )
  })
})
