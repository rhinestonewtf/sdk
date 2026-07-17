import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test, vi } from 'vitest'
import type { AccountAdapter, AccountRuntime } from '../../accounts/adapter'
import type { AccountConstruction } from '../../accounts/types'
import { toEvmChainReference } from '../../chains/caip2'
import { defineValidator } from '../../modules/validators/definition'
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
const sender = '0x0000000000000000000000000000000000000010' as const
const signature = `0x${'11'.repeat(64)}1b` as const
const hash = `0x${'22'.repeat(32)}` as const

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
    sessions: { enabled: false },
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
  } as AccountAdapter
  return {
    adapter,
    construction,
    identity: { definition: construction.account, address: sender },
  }
}

function context(
  overrides: Partial<UserOperationWorkflowContext<{ marker: boolean }>> = {},
) {
  return {
    compatibilityConfig: { marker: true },
    account: { forChain: vi.fn(async () => runtime()) },
    rpc: {
      forChain: () => ({
        getCode: vi.fn(),
        getTransactionCount: vi.fn(),
        readContract: vi.fn(async () => 7n),
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
    clock: { sleep: vi.fn(async () => undefined) },
    ...overrides,
  } satisfies UserOperationWorkflowContext<{ marker: boolean }>
}

const input = {
  chain,
  calls: [{ target: sender, value: 0n, data: '0x' as const }],
}

describe('UserOperation workflow', () => {
  test('prepares nonce, account call data, deployment, fees, gas, and signing plan', async () => {
    const workflow = context({
      paymaster: {
        sponsor: vi.fn(async () => ({
          paymaster: sender,
          paymasterData: '0x12',
          paymasterVerificationGasLimit: 20n,
          paymasterPostOpGasLimit: 30n,
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
    })
    expect(prepared.signing.tasks).toHaveLength(1)
    expect(prepared.hash).toMatch(/^0x[0-9a-f]{64}$/u)
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
    expect(reconstructed.transcript.planKind).toBe('user-operation')
    // Reconstruction derives the signing plan from static config only.
    expect(workflow.bundler.getGasPrice).not.toHaveBeenCalled()
    expect(workflow.bundler.estimateGas).not.toHaveBeenCalled()

    await expect(submitUserOperation(workflow, reconstructed)).resolves.toEqual(
      {
        type: 'userop',
        chain,
        hash,
      },
    )
  })
})
