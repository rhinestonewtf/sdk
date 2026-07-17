import {
  type Hex,
  hashMessage,
  type SignableMessage,
  type TypedDataDefinition,
} from 'viem'
import type { AccountRuntime } from '../accounts/adapter'
import { wrapKernelMessageHash } from '../accounts/adapters/kernel'
import type { EvmChainReference } from '../chains/types'
import {
  createAccountSigningContext,
  getAccountSignatureRoute,
} from '../signing/context'
import { signAccountMessage } from '../signing/message'
import { createValidatorSigningTasks, signingTopology } from '../signing/plan'
import {
  resolveAccountTypedDataSigning,
  signAccountTypedData,
} from '../signing/typed-data'
import type {
  SignerInvocationPort,
  SigningCheckpointPort,
  SigningTranscript,
} from '../signing/types'

interface RuntimeSigningInput {
  readonly chain: EvmChainReference
  readonly runtime: AccountRuntime
  readonly signerInvoker: SignerInvocationPort
  readonly checkpoints: SigningCheckpointPort
}

export async function signRuntimeMessage(
  input: RuntimeSigningInput & { readonly message: SignableMessage },
): Promise<{
  readonly signature: Hex
  readonly transcript: SigningTranscript
}> {
  const context = createAccountSigningContext({
    runtime: input.runtime,
    purpose: 'erc1271',
    signerInvoker: input.signerInvoker,
  })
  const topology = signingTopology(context.validator)
  const payload = hashMessage(input.message)
  const signingMaterial =
    input.runtime.construction.account.kind === 'kernel'
      ? {
          kind: 'message' as const,
          message: {
            raw: wrapKernelMessageHash(payload, context.account.address),
          },
        }
      : undefined
  return signAccountMessage({
    context,
    checkpoints: input.checkpoints,
    planInput: {
      message: input.message,
      ...(signingMaterial ? { signingMaterial } : {}),
      chain: input.chain,
      ...topology,
      tasks: createValidatorSigningTasks({
        validator: context.validator,
        signerReferences: context.signerReferences,
        taskPrefix: 'message',
        ecdsaInvocation: 'ecdsa-sign-message',
        webauthnInvocation: 'webauthn-sign-hash',
      }),
      route: getAccountSignatureRoute(input.runtime, context),
    },
  })
}

export async function signRuntimeTypedData(
  input: RuntimeSigningInput & { readonly typedData: TypedDataDefinition },
): Promise<{
  readonly signature: Hex
  readonly transcript: SigningTranscript
}> {
  const context = createAccountSigningContext({
    runtime: input.runtime,
    purpose: 'erc1271',
    signerInvoker: input.signerInvoker,
  })
  const topology = signingTopology(context.validator)
  const route = resolveAccountTypedDataSigning({
    typedData: input.typedData,
    chain: input.chain,
    context,
  })
  return signAccountTypedData({
    context,
    checkpoints: input.checkpoints,
    planInput: {
      typedData: input.typedData,
      signingMaterial: route.material,
      chain: input.chain,
      ...topology,
      tasks: createValidatorSigningTasks({
        validator: context.validator,
        signerReferences: context.signerReferences,
        taskPrefix: 'typed-data',
        ecdsaInvocation: route.ecdsaInvocation,
        webauthnInvocation: route.webauthnInvocation,
      }),
      route: getAccountSignatureRoute(
        input.runtime,
        context,
        route.erc7739,
        route.payloadKind,
      ),
    },
  })
}
