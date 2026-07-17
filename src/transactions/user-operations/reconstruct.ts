import type { Hex } from 'viem'
import type { EvmChainReference } from '../../chains/types'
import type { BundlerUserOperation } from '../../clients/bundler/port'
import { createAccountSigningContext } from '../../signing/context'
import { hashUserOperation } from './hash'
import { buildUserOperationSigningPlanInput } from './prepare'
import type {
  PreparedUserOperation,
  SignedUserOperation,
  UserOperationWorkflowContext,
} from './types'

interface ReconstructPreparedInput {
  readonly chain: EvmChainReference
  readonly operation: BundlerUserOperation
}

interface ReconstructSignedInput extends ReconstructPreparedInput {
  readonly signature: Hex
}

/**
 * Rebuilds the internal PreparedUserOperation from a public prepared shape that
 * did not originate from this SDK instance (e.g. externally rebuilt, mutated to
 * add a paymaster, or replayed across instances). The signing plan is derived
 * from the account's static configuration, so this performs no RPC reads.
 */
export async function reconstructPreparedUserOperation<CompatibilityConfig>(
  context: UserOperationWorkflowContext<CompatibilityConfig>,
  input: ReconstructPreparedInput,
): Promise<PreparedUserOperation<CompatibilityConfig>> {
  const runtime = await context.account.forChain(input.chain)
  const signingContext = createAccountSigningContext({
    runtime,
    purpose: 'user-operation',
    signerInvoker: context.signerInvoker,
  })
  const hash = hashUserOperation(input.chain, input.operation)
  return {
    input: { chain: input.chain, calls: [] },
    operation: input.operation,
    hash,
    signing: buildUserOperationSigningPlanInput(
      signingContext,
      input.chain,
      hash,
    ),
  }
}

/**
 * Rebuilds the internal SignedUserOperation from a public signed shape that did
 * not originate from this SDK instance, so submission works with a rebuilt or
 * externally supplied signed UserOperation. Performs no RPC reads.
 */
export async function reconstructSignedUserOperation<CompatibilityConfig>(
  context: UserOperationWorkflowContext<CompatibilityConfig>,
  input: ReconstructSignedInput,
): Promise<SignedUserOperation<CompatibilityConfig>> {
  const prepared = await reconstructPreparedUserOperation(context, input)
  return {
    prepared,
    operation: input.operation,
    signature: input.signature,
    transcript: {
      planKind: 'user-operation',
      payloadId: prepared.hash,
      stages: [],
    },
  }
}
