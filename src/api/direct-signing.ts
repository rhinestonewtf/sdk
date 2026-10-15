import {
  domainSeparator,
  encodePacked,
  type Hex,
  hashMessage,
  hashTypedData,
  pad,
  type SignableMessage,
  type TypedDataDefinition,
  zeroHash,
} from 'viem'
import type { AccountRuntime } from '../accounts/adapter'
import { nexusEip712Domain } from '../accounts/adapters/nexus'
import { startaleEip712Domain } from '../accounts/adapters/startale'
import { wrapKernelMessageHash } from '../accounts/kernel-signing'
import type { EvmChainReference } from '../chains/types'
import { defineValidator } from '../modules/validators/definition'
import { getPermissionId } from '../modules/validators/smart-sessions/digest'
import { encodeErc7739ContentType } from '../modules/validators/smart-sessions/erc7739'
import { getSmartSessionEmissaryAddress } from '../modules/validators/smart-sessions/module'
import type { ResolvedSessionSignerSet } from '../modules/validators/smart-sessions/types'
import type { ValidatorContributionCodec } from '../modules/validators/types'
import {
  createAccountSigningContext,
  getAccountSignatureRoute,
  getSigningValidatorCodec,
  type SigningContext,
} from '../signing/context'
import { resolveAccountValidatorSignableHash } from '../signing/hash'
import { signAccountMessage } from '../signing/message'
import { createValidatorSigningTasks, signingTopology } from '../signing/plan'
import {
  type Erc7739VerifierDomain,
  prepareSmartSessionErc7739Signing,
} from '../signing/protocols/erc7739'
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
      payload: { kind: 'direct', contentHash: hashMessage(input.message) },
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
  const signingMaterial =
    input.runtime.construction.account.kind === 'kernel' ||
    context.validator.kind === 'quorum'
      ? {
          kind: 'message' as const,
          message: {
            raw: resolveAccountValidatorSignableHash({
              hash: payload,
              chain: input.chain,
              context,
            }),
          },
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
    // A session allowed this domain and type signs it with ERC-7739; one
    // allowed to sign anything signs the account-bound digest in direct mode,
    // the shape signRuntimeMessage produces.
    const contentHash = hashTypedData(input.typedData)
    return signSessionErc1271({
      runtime: input.runtime,
      signerInvoker: input.signerInvoker,
      checkpoints: input.checkpoints,
      chain: input.chain,
      session: input.session,
      payload: allowsSessionTypedContent(input.session, input.typedData)
        ? { kind: 'erc7739', typedData: input.typedData }
        : { kind: 'direct', contentHash },
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

// Shared ERC-1271 signing for a session. In direct ("notarized") mode the
// session owner signs an account-bound digest (keccak of account ‖
// contentHash); in ERC-7739 ("notarized-typed") mode it signs the
// TypedDataSign digest over the account's EIP-712 domain.
async function signSessionErc1271(input: {
  readonly runtime: AccountRuntime
  readonly signerInvoker: SignerInvocationPort
  readonly checkpoints: SigningCheckpointPort
  readonly chain: EvmChainReference
  readonly session: ResolvedSessionSignerSet
  readonly payload:
    | { readonly kind: 'direct'; readonly contentHash: Hex }
    | { readonly kind: 'erc7739'; readonly typedData: TypedDataDefinition }
  readonly nominalMessage: SignableMessage
}): Promise<{
  readonly signature: Hex
  readonly transcript: SigningTranscript
}> {
  if (input.payload.kind === 'direct') {
    assertDirectSessionSigning(input.session)
  }
  const selection = sessionOwnerSelection(input.session)
  const context = createAccountSigningContext({
    runtime: input.runtime,
    purpose: 'erc1271',
    signerInvoker: input.signerInvoker,
    selection,
  })
  const topology = signingTopology(context.validator, selection.signerIds)
  let erc7739: ReturnType<typeof prepareSmartSessionErc7739Signing> | undefined
  let signedHash: Hex
  if (input.payload.kind === 'erc7739') {
    erc7739 = prepareSmartSessionErc7739Signing({
      typedData: input.payload.typedData,
      verifierDomain: sessionVerifierDomain(context, input.chain),
    })
    signedHash = erc7739.digest
  } else {
    const accountHash =
      input.runtime.construction.account.kind === 'kernel'
        ? wrapKernelMessageHash(
            input.payload.contentHash,
            context.account.address,
          )
        : input.payload.contentHash
    signedHash = hashMessage({
      raw: encodePacked(
        ['bytes32', 'bytes32'],
        [pad(context.account.address, { size: 32 }), accountHash],
      ),
    })
  }
  const route = getAccountSignatureRoute(input.runtime, context)
  return signAccountMessage({
    context,
    checkpoints: input.checkpoints,
    planInput: {
      message: input.nominalMessage,
      signingMaterial: {
        kind: 'message' as const,
        message: { raw: signedHash },
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
          mode: erc7739 ? 'notarized-typed' : 'notarized',
          permissionId: getPermissionId(input.session.session),
          ...(erc7739
            ? {
                erc7739: {
                  appDomainSeparator: erc7739.appDomainSeparator,
                  contentsType: erc7739.contentsType,
                  encodeData: erc7739.encodeData,
                },
              }
            : {}),
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

function allowsSessionTypedContent(
  session: ResolvedSessionSignerSet,
  typedData: TypedDataDefinition,
): boolean {
  const allowedContents = session.session.erc7739Policies.allowedERC7739Content
  const appDomainSeparator = domainSeparator({ domain: typedData.domain ?? {} })
  const allowed = allowedContents.find(
    (content) => content.appDomainSeparator === appDomainSeparator,
  )
  const { primaryType } = typedData
  // A domain-only message has no contents for ERC-7739 to rebuild.
  const contentsType =
    primaryType && primaryType !== 'EIP712Domain'
      ? encodeErc7739ContentType({
          primaryType,
          types: typedData.types as Parameters<
            typeof encodeErc7739ContentType
          >[0]['types'],
        })
      : undefined
  if (contentsType && allowed?.contentNames.includes(contentsType)) return true
  if (allowsDirectSessionSigning(session) || allowedContents.length === 0) {
    return false
  }
  throw new Error(
    allowed && contentsType
      ? `This Smart Session cannot sign "${contentsType}" under domain ${appDomainSeparator}`
      : `This Smart Session cannot sign typed data under domain ${appDomainSeparator}`,
  )
}

function allowsDirectSessionSigning(session: ResolvedSessionSignerSet) {
  return session.session.erc7739Policies.allowedERC7739Content.some(
    (content) =>
      content.appDomainSeparator === zeroHash &&
      content.contentNames.includes(''),
  )
}

function assertDirectSessionSigning(session: ResolvedSessionSignerSet): void {
  if (allowsDirectSessionSigning(session)) return
  if (session.session.erc7739Policies.allowedERC7739Content.length === 0) {
    throw new Error('This Smart Session has signing disabled')
  }
  throw new Error(
    'This Smart Session signs only the typed data it allows; sign it with signTypedData',
  )
}

// The domain the emissary reads from the account's `eip712Domain()`. Only
// accounts that forward the application's hash unchanged and expose that
// domain can verify an ERC-7739 session signature.
function sessionVerifierDomain(
  context: SigningContext,
  chain: EvmChainReference,
): Erc7739VerifierDomain {
  const envelope = context.accountCapabilities.signatureEnvelope
  switch (envelope.kind) {
    case 'nexus':
      return nexusEip712Domain(context.account.address, chain.id)
    case 'startale':
      return startaleEip712Domain(
        context.account.address,
        chain.id,
        envelope.version,
      )
    default:
      throw new Error(
        `Scoped Smart Session signing is not available for ${context.account.definition.kind} accounts`,
      )
  }
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
