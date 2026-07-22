import type { Hex } from 'viem'
import {
  IndependentSigningNotSupportedError,
  InvalidOwnerSigningOptionsError,
  UnknownOwnerError,
} from '../../errors/execution'
import { encodeValidatorId } from '../../modules/validators/multi-factor'
import {
  createAccountSigningContext,
  getAccountSignatureEnvelope,
  getSigningValidatorCodec,
  getSigningValidatorFactors,
  type SigningContext,
} from '../../signing/context'
import { executeSigningPlan } from '../../signing/execute'
import {
  assembleIndependentIntentArtifact,
  type IndependentOwnerDescriptor,
  type IndependentOwnerSignature,
} from '../../signing/intent-plans/independent'
import {
  createIntentSigningPlan,
  executeIntentSigning,
  projectIndependentSigning,
} from '../../signing/intent-plans/plan'
import type {
  IntentSigningPlanCreationInput,
  IntentSigningStageInput,
} from '../../signing/intent-plans/types'
import { createValidatorSigningTasks } from '../../signing/plan'
import { resolveAccountTypedDataSigning } from '../../signing/typed-data'
import type {
  ArtifactAssemblyPlan,
  RawSignerResult,
  SigningArtifact,
  SigningPayloadRegistry,
  SigningTaskTemplate,
} from '../../signing/types'
import {
  buildSessionIntentPlanInput,
  createIntentSessionSignerInvoker,
} from './session-signing'
import type {
  IntentWorkflowContext,
  PreparedIntent,
  SignedIntent,
} from './types'

export async function signIntent<CompatibilityConfig>(
  context: IntentWorkflowContext<CompatibilityConfig>,
  prepared: PreparedIntent<CompatibilityConfig>,
): Promise<SignedIntent<CompatibilityConfig>> {
  const runtime = await context.account.forChain(prepared.accountChain)
  const ownerSelection =
    prepared.input.signers?.kind === 'owner'
      ? prepared.input.signers
      : undefined
  const signerInvoker = prepared.resolvedSessions
    ? createIntentSessionSignerInvoker(prepared, context.signerInvoker)
    : context.signerInvoker
  const signing = createAccountSigningContext({
    runtime,
    purpose: 'intent',
    signerInvoker,
    ...(ownerSelection ? { selection: ownerSelection } : {}),
  })
  const planInput = prepared.resolvedSessions
    ? buildSessionIntentPlanInput(prepared, signing)
    : buildIntentPlanInput(prepared, signing)
  const transcript = await executeIntentSigning({
    planInput,
    context: signing,
    checkpoints: context.checkpoints,
  })
  const outputs = Object.assign(
    {},
    ...transcript.stages.map((stage) => stage.outputs),
  ) as Readonly<Record<string, SigningArtifact>>
  return {
    prepared,
    originSignatures: prepared.signing.origins.map((_origin, index) =>
      requireOriginSignature(outputs[`origin-${index}`]),
    ),
    destinationSignature: requireHex(outputs.destination, 'destination'),
    ...(prepared.signing.target
      ? { targetSignature: requireHex(outputs.target, 'target') }
      : {}),
    transcript,
  }
}

export async function signIntentAsOwner<CompatibilityConfig>(
  context: IntentWorkflowContext<CompatibilityConfig>,
  prepared: PreparedIntent<CompatibilityConfig>,
  selection: {
    readonly signerId: string
    readonly validatorId?: number | Hex
  },
): Promise<IndependentOwnerSignature> {
  const { signing, planInput } = await createIndependentSigningInput(
    context,
    prepared,
  )
  const owner = findIndependentOwner(signing, selection)
  const { plan } = projectIndependentSigning(
    createIntentSigningPlan(planInput),
    [selection.signerId],
    [`${owner.ownerId}`],
  )
  const transcript = await executeSigningPlan({
    plan,
    payloads: planInput.payloads,
    checkpoints: context.checkpoints,
    signerInvoker: signing.signerInvoker,
    assembleStage: () => ({}),
  })
  const origin = prepared.signing.origins.map((_payload, index) => {
    const stage = transcript.stages.find(
      ({ stage: materialized }) => materialized.stageId === `origin-${index}`,
    )
    const result = stage
      ? Object.entries(stage.results).find(([taskId]) =>
          taskId.includes(owner.ownerId),
        )?.[1]
      : undefined
    return independentOriginResult(owner, result)
  })
  const signature =
    owner.kind === 'ecdsa'
      ? ({
          kind: 'ecdsa' as const,
          signer: owner.identity,
          origin: origin as readonly Hex[],
        } as const)
      : {
          kind: 'passkey' as const,
          publicKey: owner.identity,
          origin: origin as readonly {
            readonly webauthn: {
              readonly authenticatorData: Hex
              readonly challengeIndex: number
              readonly clientDataJSON: string
              readonly typeIndex: number
              readonly userVerificationRequired: boolean
            }
            readonly signature: Hex
          }[],
        }
  return owner.factorPublicId === undefined
    ? { intentId: prepared.quote.intentId, ...signature }
    : {
        intentId: prepared.quote.intentId,
        kind: 'multi-factor',
        validatorId: owner.factorPublicId,
        signature,
      }
}

export async function assembleIntent<CompatibilityConfig>(
  context: IntentWorkflowContext<CompatibilityConfig>,
  prepared: PreparedIntent<CompatibilityConfig>,
  signatures: readonly IndependentOwnerSignature[],
): Promise<SignedIntent<CompatibilityConfig>> {
  const { signing, planInput } = await createIndependentSigningInput(
    context,
    prepared,
  )
  const plan = createIntentSigningPlan(planInput)
  const owners = independentOwners(signing)
  const assembled = Object.fromEntries(
    prepared.signing.origins.map((_payload, index) => {
      const artifact = plan.stages
        .flatMap(({ artifacts }) => artifacts)
        .find(({ id }) => id === `origin-${index}`)
      if (!artifact) {
        throw new Error(`Intent origin-${index} assembly route is missing`)
      }
      return [
        artifact.id,
        assembleIndependentIntentArtifact({
          intentId: prepared.quote.intentId,
          originIndex: index,
          originCount: prepared.signing.origins.length,
          signatures,
          owners,
          artifact,
          context: signing,
        }),
      ]
    }),
  )
  if (prepared.signing.target) {
    throw new IndependentSigningNotSupportedError()
  }
  const destination = prepared.signing.destination
  if (!destination || destination.mode !== 'reuse-origin') {
    throw new IndependentSigningNotSupportedError()
  }
  const destinationSignature = assembled[destination.originArtifactId]
  if (!destinationSignature) {
    throw new Error('Intent destination signature is missing')
  }
  return {
    prepared,
    originSignatures: prepared.signing.origins.map((_origin, index) => {
      const signature = assembled[`origin-${index}`]
      if (!signature) throw new Error(`Intent origin-${index} is missing`)
      return signature
    }),
    destinationSignature,
    transcript: {
      planKind: 'intent-full',
      payloadId: plan.payload.id,
      stages: [],
    },
  }
}

async function createIndependentSigningInput<CompatibilityConfig>(
  context: IntentWorkflowContext<CompatibilityConfig>,
  prepared: PreparedIntent<CompatibilityConfig>,
) {
  if (prepared.resolvedSessions) {
    throw new IndependentSigningNotSupportedError()
  }
  const runtime = await context.account.forChain(prepared.accountChain)
  const signing = createAccountSigningContext({
    runtime,
    purpose: 'intent',
    signerInvoker: context.signerInvoker,
    ...(prepared.input.signers?.kind === 'owner'
      ? { selection: prepared.input.signers }
      : {}),
  })
  if (!signing.validatorCapabilities.supportsIndependentSigning) {
    throw new IndependentSigningNotSupportedError()
  }
  return {
    signing,
    planInput: buildIntentPlanInput(prepared, signing),
  }
}

type IndexedIndependentOwner = IndependentOwnerDescriptor & {
  readonly signerId: string
}

function independentOwners(
  context: SigningContext,
): readonly IndexedIndependentOwner[] {
  if (context.validator.kind !== 'multi-factor') {
    return context.validator.owners.map((owner) => independentOwner(owner))
  }
  return context.validator.validators.flatMap((factor) =>
    factor.owners.map((owner) =>
      independentOwner(owner, factor.id, factor.publicId),
    ),
  )
}

function findIndependentOwner(
  context: SigningContext,
  selection: {
    readonly signerId: string
    readonly validatorId?: number | Hex
  },
): IndexedIndependentOwner {
  if (context.validator.kind !== 'multi-factor') {
    if (selection.validatorId !== undefined) {
      throw new InvalidOwnerSigningOptionsError({
        context: { validatorId: selection.validatorId },
      })
    }
    const owner = independentOwners(context).find(
      (candidate) => candidate.signerId === selection.signerId,
    )
    if (!owner) throw unknownOwner(selection)
    return owner
  }
  if (selection.validatorId === undefined) {
    throw new InvalidOwnerSigningOptionsError({
      context: { validatorId: selection.validatorId },
    })
  }
  const factor = context.validator.validators.find((candidate) =>
    sameValidatorId(candidate.publicId, selection.validatorId!),
  )
  if (!factor) {
    throw new InvalidOwnerSigningOptionsError({
      context: { validatorId: selection.validatorId },
    })
  }
  const owner = independentOwners(context).find(
    (candidate) =>
      candidate.factorId === factor.id &&
      candidate.signerId === selection.signerId,
  )
  if (!owner) throw unknownOwner(selection)
  return owner
}

function sameValidatorId(left: number | Hex, right: number | Hex): boolean {
  try {
    return (
      encodeValidatorId(left).toLowerCase() ===
      encodeValidatorId(right).toLowerCase()
    )
  } catch {
    return false
  }
}

function unknownOwner(selection: {
  readonly signerId: string
  readonly validatorId?: number | Hex
}): UnknownOwnerError {
  const [kind, identity] = selection.signerId.split(':', 2)
  return new UnknownOwnerError({
    context: {
      ...(kind === 'webauthn' ? { publicKey: identity } : { signer: identity }),
      ...(selection.validatorId === undefined
        ? {}
        : { validatorId: selection.validatorId }),
    },
  })
}

function independentOwner(
  owner: import('../../modules/validators/types').ValidatorOwner,
  factorId?: string,
  factorPublicId?: number | Hex,
): IndexedIndependentOwner {
  return {
    ownerId: owner.id,
    signerId: owner.signerId,
    identity:
      owner.kind === 'webauthn'
        ? owner.account.publicKey
        : owner.account.address,
    kind: owner.kind === 'webauthn' ? 'webauthn' : 'ecdsa',
    ...(factorId ? { factorId } : {}),
    ...(factorPublicId === undefined ? {} : { factorPublicId }),
  }
}

function independentOriginResult(
  owner: IndependentOwnerDescriptor,
  result: RawSignerResult | undefined,
) {
  if (owner.kind === 'ecdsa') {
    if (result?.kind !== 'ecdsa-signature') {
      throw new Error(`Independent owner ${owner.ownerId} did not sign`)
    }
    return result.signature
  }
  if (result?.kind !== 'webauthn-assertion') {
    throw new Error(`Independent owner ${owner.ownerId} did not sign`)
  }
  return {
    signature: result.signature,
    webauthn: {
      authenticatorData: result.authenticatorData,
      challengeIndex: result.challengeIndex,
      clientDataJSON: result.clientDataJSON,
      typeIndex: result.typeIndex,
      userVerificationRequired: result.userVerificationRequired,
    },
  }
}

function buildIntentPlanInput<CompatibilityConfig>(
  prepared: PreparedIntent<CompatibilityConfig>,
  context: SigningContext,
): IntentSigningPlanCreationInput {
  const payloads: Record<Hex, SigningPayloadRegistry[Hex]> = {}
  const stages: IntentSigningStageInput[] = []
  for (const [index, origin] of prepared.signing.origins.entries()) {
    const route = resolveAccountTypedDataSigning({
      typedData: origin.typedData,
      chain: origin.chain,
      context,
    })
    payloads[origin.id] = route.material
    stages.push(
      signingStage({
        id: `origin-${index}`,
        payloadId: origin.id,
        chain: origin.chain,
        usage: 'intent-origin',
        context,
        route,
      }),
    )
  }
  const lastOriginIndex = prepared.signing.origins.length - 1
  stages.push({
    id: 'destination',
    checkpoint: { kind: 'none', id: 'destination:none' },
    priorOutputs: [
      {
        stageId: `origin-${lastOriginIndex}`,
        outputId: `origin-${lastOriginIndex}`,
        selection: 'whole',
      },
    ],
    tasks: [],
    schedule: [],
    artifacts: [
      {
        id: 'destination',
        usage: 'intent-destination',
        input: {
          kind: 'reuse-artifact',
          stageId: `origin-${lastOriginIndex}`,
          artifactId: `origin-${lastOriginIndex}`,
          selection: 'whole',
        },
        validatorCodec: { kind: 'none' },
        erc7739: { kind: 'none' },
        accountEnvelope: { kind: 'none' },
        erc6492: { kind: 'none' },
      },
    ],
  })
  if (prepared.signing.target) {
    const target = prepared.signing.target
    const route = resolveAccountTypedDataSigning({
      typedData: target.typedData,
      chain: target.chain,
      context,
    })
    payloads[target.id] = route.material
    stages.push(
      signingStage({
        id: 'target',
        payloadId: target.id,
        chain: target.chain,
        usage: 'intent-target',
        context,
        route,
      }),
    )
  }
  return { intent: prepared.signing, stages, payloads }
}

function signingStage(input: {
  readonly id: string
  readonly payloadId: Hex
  readonly chain: import('../../chains/types').EvmChainReference
  readonly usage: 'intent-origin' | 'intent-target'
  readonly context: SigningContext
  readonly route: ReturnType<typeof resolveAccountTypedDataSigning>
}): IntentSigningStageInput {
  const direct = input.context.account.definition.kind === 'eoa'
  const tasks = direct
    ? eoaTask(input)
    : createValidatorSigningTasks({
        validator: input.context.validator,
        signerReferences: input.context.signerReferences,
        taskPrefix: input.id,
        ecdsaInvocation: input.route.ecdsaInvocation,
        webauthnInvocation: input.route.webauthnInvocation,
        selectedSignerIds: input.context.effectiveSigners.signerIds,
      }).map(
        (task): SigningTaskTemplate => ({
          ...task,
          chain: input.chain,
          payload: { source: 'plan-payload', payloadId: input.payloadId },
        }),
      )
  const artifact: Omit<ArtifactAssemblyPlan, 'stageId'> = {
    id: input.id,
    usage: input.usage,
    input: { kind: 'task-results', taskIds: tasks.map(({ id }) => id) },
    validatorCodec: direct
      ? { kind: 'none' }
      : getSigningValidatorCodec(input.context, input.route.payloadKind),
    ...(!direct && input.context.validator.kind === 'multi-factor'
      ? {
          validatorFactors: getSigningValidatorFactors(
            input.context,
            input.route.payloadKind,
          ),
        }
      : {}),
    erc7739: input.route.erc7739,
    accountEnvelope: direct
      ? { kind: 'none' }
      : getAccountSignatureEnvelope(input.context),
    erc6492: { kind: 'none' },
  }
  return {
    id: input.id,
    checkpoint: { kind: 'none', id: `${input.id}:none` },
    priorOutputs: [],
    tasks,
    schedule: [
      {
        id: `${input.id}:signers`,
        execution:
          input.context.validator.kind === 'multi-factor'
            ? 'serial'
            : 'parallel',
        taskIds: tasks.map(({ id }) => id),
      },
    ],
    artifacts: [artifact],
  }
}

function eoaTask(input: {
  readonly id: string
  readonly payloadId: Hex
  readonly chain: import('../../chains/types').EvmChainReference
  readonly context: SigningContext
}): readonly SigningTaskTemplate[] {
  const signer = Object.values(input.context.signerReferences)[0]
  if (!signer) throw new Error('EOA signer is missing')
  return [
    {
      id: `${input.id}:eoa`,
      signer,
      role: 'owner',
      chain: input.chain,
      invocationKind: 'ecdsa-sign-typed-data',
      payload: { source: 'plan-payload', payloadId: input.payloadId },
    },
  ]
}

function requireOriginSignature(value: SigningArtifact | undefined) {
  if (typeof value === 'string') return value
  if (value && 'preClaimSig' in value) return value
  throw new Error('Intent origin signature is missing')
}

function requireHex(value: SigningArtifact | undefined, role: string): Hex {
  if (typeof value !== 'string')
    throw new Error(`Intent ${role} signature is missing`)
  return value
}
