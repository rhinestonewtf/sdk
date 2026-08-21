import {
  encodePacked,
  type Hex,
  hashMessage,
  hashTypedData,
  pad,
  type SignableMessage,
  type TypedDataDefinition,
} from 'viem'
import type { AccountRuntime } from '../accounts/adapter'
import { wrapKernelMessageHash } from '../accounts/adapters/kernel'
import type { EvmChainReference } from '../chains/types'
import { defineValidator } from '../modules/validators/definition'
import { getPermissionId } from '../modules/validators/smart-sessions/digest'
import { getSmartSessionEmissaryAddress } from '../modules/validators/smart-sessions/module'
import type { ResolvedSessionSignerSet } from '../modules/validators/smart-sessions/types'
import type { ValidatorContributionCodec } from '../modules/validators/types'
import {
  createAccountSigningContext,
  getAccountSignatureRoute,
  getSigningValidatorCodec,
} from '../signing/context'
import { signAccountMessage } from '../signing/message'
import { createValidatorSigningTasks, signingTopology } from '../signing/plan'
import {
  resolveAccountTypedDataSigning,
  signAccountTypedData,
} from '../signing/typed-data'
import type {
  OwnerSignerSelection,
  SignerInvocationPort,
  SigningCheckpointPort,
  SigningTranscript,
} from '../signing/types'

interface RuntimeSigningInput {
  readonly chain: EvmChainReference
  readonly runtime: AccountRuntime
  readonly signerInvoker: SignerInvocationPort
  readonly checkpoints: SigningCheckpointPort
  readonly selection?: OwnerSignerSelection
  readonly session?: ResolvedSessionSignerSet
}

export async function signRuntimeMessage(
  input: RuntimeSigningInput & { readonly message: SignableMessage },
): Promise<{
  readonly signature: Hex
  readonly transcript: SigningTranscript
}> {
  if (input.session) {
    return signSessionErc1271({
      runtime: input.runtime,
      signerInvoker: input.signerInvoker,
      checkpoints: input.checkpoints,
      chain: input.chain,
      session: input.session,
      contentHash: hashMessage(input.message),
      nominalMessage: input.message,
    })
  }
  const context = createAccountSigningContext({
    runtime: input.runtime,
    purpose: 'erc1271',
    signerInvoker: input.signerInvoker,
    ...(input.selection ? { selection: input.selection } : {}),
  })
  const topology = signingTopology(
    context.validator,
    input.selection?.signerIds,
  )
  const payload = hashMessage(input.message)
  const accountHash =
    input.runtime.construction.account.kind === 'kernel'
      ? wrapKernelMessageHash(payload, context.account.address)
      : payload
  const signingMaterial =
    input.runtime.construction.account.kind === 'kernel'
      ? {
          kind: 'message' as const,
          message: { raw: accountHash },
        }
      : undefined
  const route = getAccountSignatureRoute(input.runtime, context)
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
        ...(input.selection
          ? { selectedSignerIds: input.selection.signerIds }
          : {}),
      }),
      route,
    },
  })
}

export async function signRuntimeTypedData(
  input: RuntimeSigningInput & { readonly typedData: TypedDataDefinition },
): Promise<{
  readonly signature: Hex
  readonly transcript: SigningTranscript
}> {
  if (input.session) {
    // Sessions sign an account-bound digest in direct (notarized) mode, the
    // same shape signRuntimeMessage produces, so external ERC-1271 verifiers
    // resolve the session validator directly.
    const contentHash = hashTypedData(input.typedData)
    return signSessionErc1271({
      runtime: input.runtime,
      signerInvoker: input.signerInvoker,
      checkpoints: input.checkpoints,
      chain: input.chain,
      session: input.session,
      contentHash,
      nominalMessage: { raw: contentHash },
    })
  }
  const context = createAccountSigningContext({
    runtime: input.runtime,
    purpose: 'erc1271',
    signerInvoker: input.signerInvoker,
    ...(input.selection ? { selection: input.selection } : {}),
  })
  const topology = signingTopology(
    context.validator,
    input.selection?.signerIds,
  )
  const route = resolveAccountTypedDataSigning({
    typedData: input.typedData,
    chain: input.chain,
    context,
  })
  const accountRoute = getAccountSignatureRoute(
    input.runtime,
    context,
    route.erc7739,
    route.payloadKind,
  )
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
        ...(input.selection
          ? { selectedSignerIds: input.selection.signerIds }
          : {}),
      }),
      route: accountRoute,
    },
  })
}

// Shared ERC-1271 signing for a session: the session owner signs an
// account-bound digest (keccak of account ‖ contentHash) in the smart-session
// "notarized" (direct) mode. Used by both message and typed-data signing so
// they produce the identical on-chain-verifiable shape.
async function signSessionErc1271(input: {
  readonly runtime: AccountRuntime
  readonly signerInvoker: SignerInvocationPort
  readonly checkpoints: SigningCheckpointPort
  readonly chain: EvmChainReference
  readonly session: ResolvedSessionSignerSet
  readonly contentHash: Hex
  readonly nominalMessage: SignableMessage
}): Promise<{
  readonly signature: Hex
  readonly transcript: SigningTranscript
}> {
  const selection = sessionOwnerSelection(input.session)
  const context = createAccountSigningContext({
    runtime: input.runtime,
    purpose: 'erc1271',
    signerInvoker: input.signerInvoker,
    selection,
  })
  const topology = signingTopology(context.validator, selection.signerIds)
  const accountHash =
    input.runtime.construction.account.kind === 'kernel'
      ? wrapKernelMessageHash(input.contentHash, context.account.address)
      : input.contentHash
  const route = getAccountSignatureRoute(input.runtime, context)
  return signAccountMessage({
    context,
    checkpoints: input.checkpoints,
    planInput: {
      message: input.nominalMessage,
      signingMaterial: {
        kind: 'message' as const,
        message: {
          raw: hashMessage({
            raw: encodePacked(
              ['bytes32', 'bytes32'],
              [pad(context.account.address, { size: 32 }), accountHash],
            ),
          }),
        },
      },
      chain: input.chain,
      ...topology,
      tasks: createValidatorSigningTasks({
        validator: context.validator,
        signerReferences: context.signerReferences,
        taskPrefix: 'message',
        ecdsaInvocation: 'ecdsa-sign-message',
        webauthnInvocation: 'webauthn-sign-hash',
        selectedSignerIds: selection.signerIds,
      }),
      route: {
        ...route,
        validatorCodec: {
          kind: 'smart-session',
          validator: {
            kind: 'validator',
            address: getSmartSessionEmissaryAddress(
              input.runtime.construction.sessions.environment,
            ),
          },
          mode: 'notarized',
          permissionId: getPermissionId(input.session.session),
          signerCodec: requireSessionOwnerCodec(
            getSigningValidatorCodec(context),
          ),
        },
        accountEnvelope: smartSessionEnvelope(
          route.accountEnvelope,
          input.runtime.construction.sessions.environment,
        ),
      },
    },
  })
}

function sessionOwnerSelection(
  session: ResolvedSessionSignerSet,
): OwnerSignerSelection {
  const validator = defineValidator(
    session.session.owners,
    'smart-session-validator',
  )
  return {
    kind: 'owner',
    validator,
    signerIds:
      validator.kind === 'multi-factor'
        ? validator.validators.flatMap((factor) =>
            factor.owners.map(({ signerId }) => signerId),
          )
        : validator.owners.map(({ signerId }) => signerId),
  }
}

function requireSessionOwnerCodec(
  codec: ValidatorContributionCodec,
): Exclude<ValidatorContributionCodec, { readonly kind: 'smart-session' }> {
  if (codec.kind === 'smart-session') {
    throw new Error('A Smart Session owner cannot use a session validator')
  }
  return codec
}

function smartSessionEnvelope(
  envelope: ReturnType<typeof getAccountSignatureRoute>['accountEnvelope'],
  environment: 'production' | 'development',
) {
  if (envelope.kind === 'none') return envelope
  const validator = getSmartSessionEmissaryAddress(environment)
  return envelope.kind === 'kernel'
    ? { ...envelope, validator, isRoot: false }
    : { ...envelope, validator }
}
