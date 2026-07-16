import { concat, type Hex, hashTypedData, type TypedDataDefinition } from 'viem'
import { describe, expect, test, vi } from 'vitest'
import type { AccountAdapter } from '../accounts/adapter'
import { EoaSigningNotSupportedError } from '../accounts/error'
import type { SigningContext } from './context'
import {
  createAuthorizationListPlan,
  createNexusEip7702InitPlan,
  signAuthorizationList,
  signNexusEip7702Init,
} from './eip7702'
import { signAccountMessage } from './message'
import {
  createSessionEnableSigningPlan,
  signSessionEnablement,
} from './session-enable'
import { signAccountTypedData } from './typed-data'
import type {
  PayloadSigningTask,
  SignerInvocationPort,
  SigningCheckpointPort,
} from './types'
import {
  createUserOperationSigningPlan,
  signUserOperationPayload,
} from './user-operation'

const chain = { kind: 'evm' as const, id: 1, caip2: 'eip155:1' as const }
const account = '0x1111111111111111111111111111111111111111'
const validator = '0x2222222222222222222222222222222222222222'
const factory = '0x3333333333333333333333333333333333333333'
const rawSignature = `0x${'44'.repeat(64)}00` as Hex
const typedData: TypedDataDefinition = {
  domain: {
    name: 'Test',
    version: '1',
    chainId: 1,
    verifyingContract: account,
  },
  types: { Test: [{ name: 'value', type: 'uint256' }] },
  primaryType: 'Test',
  message: { value: 1n },
}
const topology = {
  configuredTopology: {
    rootValidatorId: 'owner',
    validators: [{ id: 'owner', ownerIds: ['owner/a'], threshold: 1 }],
    threshold: 1,
  },
  effectiveSelection: {
    validatorIds: ['owner'],
    signerIds: ['owner'],
    threshold: 1,
  },
}
const task = (
  invocationKind: PayloadSigningTask['invocationKind'],
): PayloadSigningTask => ({
  id: 'owner-task',
  signer: { id: 'owner', kind: 'ecdsa' },
  role: 'owner',
  invocationKind,
  contribution: {
    kind: 'ecdsa',
    ownerId: 'owner/a',
    encoding: 'raw-signer',
  },
})
const codec = {
  kind: 'ordered-threshold' as const,
  validator: { kind: 'validator' as const, address: validator },
  ownerOrder: ['owner/a'],
  threshold: 1,
  recoveryEncoding: 'validator-offset-4' as const,
}

function signerInvoker(): SignerInvocationPort {
  return {
    has: () => true,
    invoke: async () => ({ kind: 'ecdsa-signature', signature: rawSignature }),
  }
}

function signingContext(): SigningContext {
  const adapter = {
    encodeSignatureEnvelope: ({ validatorContribution }) =>
      concat(['0xaa', validatorContribution]),
  } as unknown as AccountAdapter
  return {
    account: {
      definition: { kind: 'nexus', version: '1.2.0' },
      address: account,
    },
    accountAdapter: adapter,
    accountCapabilities: {
      modular: true,
      supportsDeployment: true,
      supportsUserOperations: true,
      supportsEip7702Adoption: false,
      supportsSmartSessions: true,
      supportsOriginSignatureReuse: true,
      signatureEnvelope: { kind: 'nexus', validator },
    },
    validator: {
      kind: 'ecdsa',
      id: 'owner',
      publicId: 0,
      module: { source: 'explicit', address: validator },
      owners: [],
      threshold: 1,
    },
    validatorCapabilities: {
      compatibilityKey: {
        validatorKind: 'ecdsa',
        moduleAddress: validator,
        accountProfile: 'test',
        purpose: 'erc1271',
      },
      payloadKinds: ['message', 'typed-data', 'intent', 'user-operation'],
      signatureModes: ['owner'],
      signerTopology: 'single',
      supportsIndependentSigning: true,
      supportsOriginReuse: true,
      supportsMockSignature: true,
      supportsEip712: true,
      recoveryEncoding: 'validator-offset-4',
      contributionCodec: codec,
    },
    effectiveSigners: topology.effectiveSelection,
    signerReferences: { owner: { id: 'owner', kind: 'ecdsa' } },
    signerInvoker: signerInvoker(),
  }
}

const noReads: SigningCheckpointPort = {
  read: async () => [],
}

describe('direct rewritten signing pipelines', () => {
  test('assembles message signatures in validator, account, ERC-6492 order', async () => {
    const context = signingContext()
    const result = await signAccountMessage({
      context,
      checkpoints: {
        read: async (checkpoint) => [
          { kind: 'account-deployed', id: checkpoint.id, deployed: false },
        ],
      },
      planInput: {
        message: 'hello',
        chain,
        ...topology,
        tasks: [task('ecdsa-sign-message')],
        checkpoint: {
          kind: 'account-deployment',
          id: 'deployment',
          chain,
          account,
        },
        route: {
          validatorCodec: codec,
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'nexus', validator },
          erc6492: {
            kind: 'wrap-deployless',
            factory,
            factoryData: '0x1234',
          },
        },
      },
    })
    expect(result.signature.endsWith('6492'.repeat(16))).toBe(true)
    expect(result.transcript.stages[0].stage.tasks[0].invocation.kind).toBe(
      'ecdsa-sign-message',
    )
  })

  test('supports deployed and unenveloped message routes explicitly', async () => {
    const context = signingContext()
    const direct = await signAccountMessage({
      context,
      checkpoints: noReads,
      planInput: {
        message: 'hello',
        chain,
        ...topology,
        tasks: [task('ecdsa-sign-message')],
        route: {
          validatorCodec: codec,
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'none' },
          erc6492: { kind: 'none' },
        },
      },
    })
    expect(direct.signature).toBe(`0x${'44'.repeat(64)}1f`)

    const deployed = await signAccountMessage({
      context,
      checkpoints: {
        read: async (checkpoint) => [
          { kind: 'account-deployed', id: checkpoint.id, deployed: true },
        ],
      },
      planInput: {
        message: 'hello',
        chain,
        ...topology,
        tasks: [task('ecdsa-sign-message')],
        checkpoint: {
          kind: 'account-deployment',
          id: 'deployed',
          chain,
          account,
        },
        route: {
          validatorCodec: codec,
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'nexus', validator },
          erc6492: { kind: 'wrap-deployless', factory, factoryData: '0x' },
        },
      },
    })
    expect(deployed.signature.startsWith('0xaa')).toBe(true)
    expect(deployed.signature.endsWith('6492'.repeat(16))).toBe(false)
  })

  test('applies ERC-7739 before the account envelope for typed data', async () => {
    const context = signingContext()
    const result = await signAccountTypedData({
      context,
      checkpoints: noReads,
      planInput: {
        typedData,
        signingMaterial: {
          kind: 'message',
          message: { raw: hashTypedData(typedData) },
        },
        chain,
        ...topology,
        tasks: [task('ecdsa-sign-message')],
        route: {
          validatorCodec: codec,
          erc7739: { kind: 'wrap-typed-data', typedData },
          accountEnvelope: { kind: 'nexus', validator },
          erc6492: { kind: 'none' },
        },
      },
    })
    expect(result.signature.startsWith('0xaa')).toBe(true)
    expect(result.signature).not.toContain(rawSignature.slice(2))
  })

  test('supports direct typed-data and deployless typed-data routes', async () => {
    const context = signingContext()
    const direct = await signAccountTypedData({
      context,
      checkpoints: noReads,
      planInput: {
        typedData,
        chain,
        ...topology,
        tasks: [task('ecdsa-sign-typed-data')],
        route: {
          validatorCodec: codec,
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'none' },
          erc6492: { kind: 'none' },
        },
      },
    })
    expect(direct.signature).toBe(`0x${'44'.repeat(64)}1f`)

    const deployless = await signAccountTypedData({
      context,
      checkpoints: {
        read: async (checkpoint) => [
          { kind: 'account-deployed', id: checkpoint.id, deployed: false },
        ],
      },
      planInput: {
        typedData,
        chain,
        ...topology,
        tasks: [task('ecdsa-sign-typed-data')],
        checkpoint: {
          kind: 'account-deployment',
          id: 'typed-deployment',
          chain,
          account,
        },
        route: {
          validatorCodec: codec,
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'nexus', validator },
          erc6492: { kind: 'wrap-deployless', factory, factoryData: '0x1234' },
        },
      },
    })
    expect(deployless.signature.endsWith('6492'.repeat(16))).toBe(true)
    const deployed = await signAccountTypedData({
      context,
      checkpoints: {
        read: async (checkpoint) => [
          { kind: 'account-deployed', id: checkpoint.id, deployed: true },
        ],
      },
      planInput: {
        typedData,
        chain,
        ...topology,
        tasks: [task('ecdsa-sign-typed-data')],
        checkpoint: {
          kind: 'account-deployment',
          id: 'typed-deployed',
          chain,
          account,
        },
        route: {
          validatorCodec: codec,
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'nexus', validator },
          erc6492: { kind: 'wrap-deployless', factory, factoryData: '0x1234' },
        },
      },
    })
    expect(deployed.signature.endsWith('6492'.repeat(16))).toBe(false)
  })

  test('rejects ERC-7739 on the message path', async () => {
    await expect(
      signAccountMessage({
        context: signingContext(),
        checkpoints: noReads,
        planInput: {
          message: 'hello',
          chain,
          ...topology,
          tasks: [task('ecdsa-sign-message')],
          route: {
            validatorCodec: codec,
            erc7739: { kind: 'wrap-typed-data', typedData },
            accountEnvelope: { kind: 'none' },
            erc6492: { kind: 'none' },
          },
        },
      }),
    ).rejects.toMatchObject({
      message: 'ERC-7739 is not a message-signing operation',
      context: {
        failureStage: 'plan',
        artifactId: 'message-signature',
      },
    })
  })

  test('attributes artifact assembly failures to their exact step', async () => {
    const cause = new Error('account codec failed')
    await expect(
      signAccountMessage({
        context: {
          ...signingContext(),
          accountAdapter: {
            encodeSignatureEnvelope: () => {
              throw cause
            },
          } as unknown as AccountAdapter,
        },
        checkpoints: noReads,
        planInput: {
          message: 'hello',
          chain,
          ...topology,
          tasks: [task('ecdsa-sign-message')],
          route: {
            validatorCodec: codec,
            erc7739: { kind: 'none' },
            accountEnvelope: { kind: 'nexus', validator },
            erc6492: { kind: 'none' },
          },
        },
      }),
    ).rejects.toMatchObject({
      cause,
      context: {
        failureStage: 'account-envelope',
        artifactId: 'message-signature',
        usage: 'erc1271',
      },
    })
  })

  test('preserves Kernel message material and the canonical EOA error', async () => {
    const context = signingContext()
    const wrapped = `0x${'aa'.repeat(32)}` as Hex
    const invoked = vi.fn(async () => ({
      kind: 'ecdsa-signature' as const,
      signature: rawSignature,
    }))
    await signAccountMessage({
      context: {
        ...context,
        signerInvoker: { has: () => true, invoke: invoked },
      },
      checkpoints: noReads,
      planInput: {
        message: 'hello',
        signingMaterial: { kind: 'message', message: { raw: wrapped } },
        chain,
        ...topology,
        tasks: [task('ecdsa-sign-message')],
        route: {
          validatorCodec: codec,
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'none' },
          erc6492: { kind: 'none' },
        },
      },
    })
    expect(invoked.mock.calls[0][1]).toMatchObject({
      message: { raw: wrapped },
    })
    await expect(
      signAccountMessage({
        context: {
          ...context,
          account: { definition: { kind: 'eoa' }, address: account },
        },
        checkpoints: noReads,
        planInput: {
          message: 'hello',
          chain,
          ...topology,
          tasks: [task('ecdsa-sign-message')],
          route: {
            validatorCodec: codec,
            erc7739: { kind: 'none' },
            accountEnvelope: { kind: 'none' },
            erc6492: { kind: 'none' },
          },
        },
      }),
    ).rejects.toBeInstanceOf(EoaSigningNotSupportedError)
    await expect(
      signAccountTypedData({
        context: {
          ...context,
          account: { definition: { kind: 'eoa' }, address: account },
        },
        checkpoints: noReads,
        planInput: {
          typedData,
          chain,
          ...topology,
          tasks: [task('ecdsa-sign-typed-data')],
          route: {
            validatorCodec: codec,
            erc7739: { kind: 'none' },
            accountEnvelope: { kind: 'none' },
            erc6492: { kind: 'none' },
          },
        },
      }),
    ).rejects.toBeInstanceOf(EoaSigningNotSupportedError)
  })

  test('keeps UserOperation and session-enablement outputs unenveloped', async () => {
    const userOperation = await signUserOperationPayload({
      signerInvoker: signerInvoker(),
      checkpoints: noReads,
      planInput: {
        hash: `0x${'55'.repeat(32)}`,
        chain,
        ...topology,
        tasks: [task('ecdsa-sign-message')],
        validatorCodec: { ...codec, recoveryEncoding: 'ethereum' },
      },
    })
    expect(userOperation.signature).toBe(`0x${'44'.repeat(64)}1b`)

    const enablement = await signSessionEnablement({
      signerInvoker: signerInvoker(),
      checkpoints: noReads,
      planInput: {
        typedData,
        chain,
        ...topology,
        tasks: [task('ecdsa-sign-typed-data')],
        validatorCodec: codec,
      },
    })
    expect(enablement.signature).toBe(`0x${'44'.repeat(64)}1f`)

    const factor = {
      id: 'factor',
      publicId: 1,
      validator,
      codec,
    }
    expect(
      createUserOperationSigningPlan({
        hash: `0x${'55'.repeat(32)}`,
        chain,
        ...topology,
        tasks: [task('ecdsa-sign-message')],
        validatorCodec: {
          kind: 'nested-threshold',
          validator: codec.validator,
          factorOrder: ['factor'],
          threshold: 1,
        },
        validatorFactors: [factor],
      }).stages[0].artifacts[0].validatorFactors,
    ).toEqual([factor])
    expect(
      createSessionEnableSigningPlan({
        typedData,
        chain,
        ...topology,
        tasks: [task('ecdsa-sign-typed-data')],
        validatorCodec: {
          kind: 'nested-threshold',
          validator: codec.validator,
          factorOrder: ['factor'],
          threshold: 1,
        },
        validatorFactors: [factor],
      }).stages[0].artifacts[0].validatorFactors,
    ).toEqual([factor])
  })

  test('signs Nexus init and ordered EIP-7702 authorizations as structured data', async () => {
    expect(
      createNexusEip7702InitPlan({
        typedData,
        chain,
        signer: { id: 'owner', kind: 'ecdsa' },
      }).kind,
    ).toBe('nexus-eip7702-init')
    const init = await signNexusEip7702Init({
      planInput: {
        typedData,
        chain,
        signer: { id: 'owner', kind: 'ecdsa' },
      },
      signerInvoker: signerInvoker(),
      checkpoints: noReads,
    })
    expect(init.signature).toBe(rawSignature)

    const authorization = {
      address: account,
      chainId: 1,
      nonce: 0,
      r: `0x${'66'.repeat(32)}` as Hex,
      s: `0x${'77'.repeat(32)}` as Hex,
      yParity: 0,
    }
    const invoke = vi.fn(async () => ({
      kind: 'signed-authorization' as const,
      authorization,
    }))
    const planInput = {
      account,
      contract: validator,
      chains: [
        chain,
        chain,
        {
          kind: 'non-evm' as const,
          namespace: 'solana',
          reference: 'devnet',
          caip2: 'solana:devnet' as const,
        },
      ],
      signer: { id: 'wallet', kind: 'wallet-authorization' as const },
      nonceByChain: { 1: 0 },
    }
    expect(createAuthorizationListPlan(planInput).plan.stages).toHaveLength(1)
    expect(() =>
      createAuthorizationListPlan({ ...planInput, nonceByChain: {} }),
    ).toThrow('nonce')
    const result = await signAuthorizationList({
      planInput,
      signerInvoker: { has: () => true, invoke },
      checkpoints: {
        read: async (checkpoint) => [
          { kind: 'delegation-code', id: checkpoint.id, code: '0x' },
        ],
      },
    })
    expect(result.authorizations).toEqual([authorization])
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  test('skips authorization tasks for chains already delegated', async () => {
    const invoke = vi.fn()
    const result = await signAuthorizationList({
      planInput: {
        account,
        contract: validator,
        chains: [chain],
        signer: { id: 'wallet', kind: 'wallet-authorization' },
        nonceByChain: { 1: 0 },
      },
      signerInvoker: { has: () => false, invoke },
      checkpoints: {
        read: async (checkpoint) => [
          {
            kind: 'delegation-code',
            id: checkpoint.id,
            code: `0xef0100${validator.slice(2)}`,
          },
        ],
      },
    })
    expect(result.authorizations).toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })
})
