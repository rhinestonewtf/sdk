import {
  encodePacked,
  type Hex,
  hashMessage,
  pad,
  type SignableMessage,
  type TypedDataDefinition,
  zeroHash,
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
  const selection = input.session
    ? sessionOwnerSelection(input.session)
    : input.selection
  const context = createAccountSigningContext({
    runtime: input.runtime,
    purpose: 'erc1271',
    signerInvoker: input.signerInvoker,
    ...(selection ? { selection } : {}),
  })
  const topology = signingTopology(context.validator, selection?.signerIds)
  const payload = hashMessage(input.message)
  const accountHash =
    input.runtime.construction.account.kind === 'kernel'
      ? wrapKernelMessageHash(payload, context.account.address)
      : payload
  const signingMaterial = input.session
    ? {
        kind: 'message' as const,
        message: {
          raw: hashMessage({
            raw: encodePacked(
              ['bytes32', 'bytes32'],
              [pad(context.account.address, { size: 32 }), accountHash],
            ),
          }),
        },
      }
    : input.runtime.construction.account.kind === 'kernel'
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
        ...(selection ? { selectedSignerIds: selection.signerIds } : {}),
      }),
      route: input.session
        ? {
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
          }
        : route,
    },
  })
}

export async function signRuntimeTypedData(
  input: RuntimeSigningInput & { readonly typedData: TypedDataDefinition },
): Promise<{
  readonly signature: Hex
  readonly transcript: SigningTranscript
}> {
  const selection = input.session
    ? sessionOwnerSelection(input.session)
    : input.selection
  const context = createAccountSigningContext({
    runtime: input.runtime,
    purpose: 'erc1271',
    signerInvoker: input.signerInvoker,
    ...(selection ? { selection } : {}),
  })
  const topology = signingTopology(context.validator, selection?.signerIds)
  const typedData = input.session
    ? sessionTypedData(input.typedData, input.runtime, input.chain)
    : input.typedData
  const route = resolveAccountTypedDataSigning({
    typedData,
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
      typedData,
      signingMaterial: route.material,
      chain: input.chain,
      ...topology,
      tasks: createValidatorSigningTasks({
        validator: context.validator,
        signerReferences: context.signerReferences,
        taskPrefix: 'typed-data',
        ecdsaInvocation: route.ecdsaInvocation,
        webauthnInvocation: route.webauthnInvocation,
        ...(selection ? { selectedSignerIds: selection.signerIds } : {}),
      }),
      route: input.session
        ? {
            ...accountRoute,
            erc7739: {
              kind: 'wrap-session-typed-data',
              typedData: input.typedData,
              permissionId: getPermissionId(input.session.session),
            },
            accountEnvelope: smartSessionEnvelope(
              accountRoute.accountEnvelope,
              input.runtime.construction.sessions.environment,
            ),
          }
        : accountRoute,
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

function sessionTypedData(
  typedData: TypedDataDefinition,
  runtime: AccountRuntime,
  chain: EvmChainReference,
): TypedDataDefinition {
  const verifier = sessionVerifierDomain(runtime, chain)
  return {
    domain: typedData.domain,
    primaryType: 'TypedDataSign',
    types: {
      ...typedData.types,
      TypedDataSign: [
        { name: 'contents', type: typedData.primaryType as string },
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
        { name: 'salt', type: 'bytes32' },
      ],
    },
    message: {
      contents: typedData.message,
      ...verifier,
    },
  } as unknown as TypedDataDefinition
}

function sessionVerifierDomain(
  runtime: AccountRuntime,
  chain: EvmChainReference,
) {
  const common = {
    chainId: chain.id,
    verifyingContract: runtime.identity.address,
    salt: zeroHash,
  }
  switch (runtime.construction.account.kind) {
    case 'safe':
      return { ...common, name: 'rhinestone safe7579', version: 'v1.0.0' }
    case 'nexus':
    case 'hca':
      return { ...common, name: 'Nexus', version: '1.2.0' }
    case 'kernel':
      return { ...common, name: 'Kernel', version: '0.3.3' }
    case 'startale':
      return { ...common, name: 'Startale', version: '1.0.0' }
    case 'eoa':
      throw new Error('EOA accounts do not have an EIP-712 domain')
  }
}
