import type { Hex } from 'viem'
import { resolveCalls } from '../../calls/resolve'
import type { EvmChainReference } from '../../chains/types'
import type { BundlerUserOperation } from '../../clients/bundler/port'
import {
  createAccountSigningContext,
  getSigningValidatorCodec,
  getSigningValidatorFactors,
  type SigningContext,
} from '../../signing/context'
import {
  createValidatorSigningTasks,
  signingTopology,
} from '../../signing/plan'
import type { UserOperationSigningPlanInput } from '../../signing/user-operation'
import { hashUserOperation } from './hash'
import { getUserOperationNonceKey, readUserOperationNonce } from './nonce'
import type {
  PreparedUserOperation,
  UserOperationInput,
  UserOperationWorkflowContext,
} from './types'
import { getUserOperationStubSignature } from './validator-account'

export async function prepareUserOperation<CompatibilityConfig>(
  context: UserOperationWorkflowContext<CompatibilityConfig>,
  input: UserOperationInput<CompatibilityConfig>,
): Promise<PreparedUserOperation<CompatibilityConfig>> {
  const runtime = await context.account.forChain(input.chain)
  const signingContext = createAccountSigningContext({
    runtime,
    purpose: 'user-operation',
    signerInvoker: context.signerInvoker,
  })
  const calls = await resolveCalls(input.calls, {
    account: runtime.identity.address,
    chain: input.chain,
    config: context.compatibilityConfig,
  })
  const nonce = await readUserOperationNonce({
    rpc: context.rpc.forChain(input.chain),
    chain: input.chain,
    sender: runtime.identity.address,
    key: getUserOperationNonceKey({
      accountKind: runtime.construction.account.kind,
      validator:
        signingContext.validatorCapabilities.compatibilityKey.moduleAddress,
      ...(input.nonceKey === undefined ? {} : { requested: input.nonceKey }),
    }),
  })
  const deployment = runtime.adapter.getDeploymentPlan(runtime.construction)
  const gasPrice = await context.bundler.getGasPrice(input.chain)
  let operation = {
    sender: runtime.identity.address,
    nonce,
    ...(deployment.deployed || !deployment.factory || !deployment.factoryData
      ? {}
      : {
          factory: deployment.factory,
          factoryData: deployment.factoryData,
        }),
    callData: runtime.adapter.encodeCalls({
      chain: input.chain,
      calls,
      mode: calls.length > 1 ? 'batch' : 'single',
    }),
    callGasLimit: input.gasLimit ?? 0n,
    verificationGasLimit: 0n,
    preVerificationGas: 0n,
    maxFeePerGas: gasPrice.maxFeePerGas,
    maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas,
    signature: getUserOperationStubSignature(runtime, signingContext),
  } satisfies BundlerUserOperation
  if (context.paymaster) {
    operation = {
      ...operation,
      ...(await context.paymaster.sponsor(input.chain, operation)),
    }
  }
  const gas = await context.bundler.estimateGas(input.chain, operation)
  operation = {
    ...operation,
    ...gas,
    ...(input.gasLimit === undefined ? {} : { callGasLimit: input.gasLimit }),
  }
  const hash = hashUserOperation(input.chain, operation)
  return {
    input,
    operation,
    hash,
    signing: buildUserOperationSigningPlanInput(
      signingContext,
      input.chain,
      hash,
    ),
  }
}

/**
 * Builds the validator signing-plan input for a UserOperation hash. Shared by
 * preparation and reconstruction so both derive an identical signing plan.
 */
export function buildUserOperationSigningPlanInput(
  signingContext: SigningContext,
  chain: EvmChainReference,
  hash: Hex,
): UserOperationSigningPlanInput {
  const tasks = createValidatorSigningTasks({
    validator: signingContext.validator,
    signerReferences: signingContext.signerReferences,
    taskPrefix: 'user-operation',
    ecdsaInvocation: 'ecdsa-sign-message',
    webauthnInvocation: 'webauthn-sign-hash',
  })
  const topology = signingTopology(signingContext.validator)
  return {
    hash,
    chain,
    configuredTopology: topology.configuredTopology,
    effectiveSelection: topology.effectiveSelection,
    tasks,
    validatorCodec: getSigningValidatorCodec(signingContext),
    ...(signingContext.validator.kind === 'multi-factor'
      ? { validatorFactors: getSigningValidatorFactors(signingContext) }
      : {}),
  }
}
