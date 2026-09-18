import type { Hex } from 'viem'
import type { SigningProof } from '../../clients/orchestrator/public'
import {
  IndependentSigningNotSupportedError,
  InvalidOwnerSigningOptionsError,
  UnknownOwnerError,
  UnsupportedSigningRequestError,
} from '../../errors/execution'
import { encodeValidatorId } from '../../modules/validators/multi-factor'
import {
  buildQuorumMerkleTree,
  getQuorumMerkleRootSignableHash,
} from '../../modules/validators/quorum'
import {
  createAccountSigningContext,
  getAccountSignatureEnvelope,
  getSigningValidatorCodec,
  getSigningValidatorFactors,
  type SigningContext,
} from '../../signing/context'
import { executeSigningPlan } from '../../signing/execute'
import { resolveAccountValidatorSignableHash } from '../../signing/hash'
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
  IntentSigningRequest,
  IntentSigningStageInput,
} from '../../signing/intent-plans/types'
import { createValidatorSigningTasks } from '../../signing/plan'
import {
  type AccountTypedDataSigningRoute,
  resolveAccountTypedDataSigning,
} from '../../signing/typed-data'
import type {
  ArtifactAssemblyPlan,
  RawSignerResult,
  SignatureUsage,
  SigningArtifact,
  SigningPayloadRegistry,
  SigningTaskTemplate,
} from '../../signing/types'
import { signatureSpansMultipleChains } from './origin-chain'
import { assembleProofVector, requestSetId } from './proofs'
import {
  buildSessionIntentPlanInput,
  createIntentSessionSignerInvoker,
} from './session-signing'
import type {
  IndexedProofContribution,
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
    proofs: await collectOrderedProofs(context, prepared, outputs),
    transcript,
  }
}

/**
 * Builds the proof vector in quote order, one entry per signing request.
 *
 * Delegation proofs are collected here rather than by a separate caller step:
 * a quote that asks for one is not signed without it, and there is no order to
 * reconstruct later from a bag of authorisations.
 */
async function collectOrderedProofs<CompatibilityConfig>(
  context: IntentWorkflowContext<CompatibilityConfig>,
  prepared: PreparedIntent<CompatibilityConfig>,
  outputs: Readonly<Record<string, SigningArtifact>>,
): Promise<readonly SigningProof[]> {
  const proofs: SigningProof[] = []
  for (const request of prepared.signing.requests) {
    switch (request.kind) {
      case 'eip712':
        proofs.push(eip712Proof(outputs[request.artifactId], request.index))
        break
      case 'eip7702': {
        const authorization = await context.signDelegation({
          chainId: request.chainId,
          contract: request.contract,
        })
        proofs.push({
          kind: 'eip7702',
          nonce: authorization.nonce,
          signature: {
            r: authorization.r,
            s: authorization.s,
            yParity: (authorization.yParity ?? 0) === 1 ? 1 : 0,
          },
        })
        break
      }
      default:
        throw new UnsupportedSigningRequestError({
          index: request.index,
          payloadKind:
            request.kind === 'unsupported' ? request.payloadKind : request.kind,
        })
    }
  }
  return proofs
}

function eip712Proof(
  artifact: SigningArtifact | undefined,
  index: number,
): SigningProof {
  if (typeof artifact === 'string') {
    return { kind: 'eip712', signature: artifact }
  }
  // A session origin carries both encodings of the one message in one proof;
  // the halves are never swapped, and they are never split across two slots.
  if (artifact && 'preClaimSig' in artifact) {
    return {
      kind: 'eip712',
      signature: {
        preClaim: artifact.preClaimSig,
        notarizedClaim: artifact.notarizedClaimSig,
      },
    }
  }
  throw new Error(`Intent proof for signing request ${index} is missing`)
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
  const quorumRootStage =
    signing.validator.kind === 'quorum' && independentSlots(prepared).length > 1
      ? transcript.stages.find(
          ({ stage: materialized }) =>
            materialized.stageId === 'quorum-origins',
        )
      : undefined
  const quorumRootResult = quorumRootStage
    ? Object.entries(quorumRootStage.results).find(([taskId]) =>
        taskId.includes(owner.ownerId),
      )?.[1]
    : undefined
  const slots = independentSlots(prepared).map((request) => {
    const stage = quorumRootStage
      ? undefined
      : transcript.stages.find(
          ({ stage: materialized }) =>
            materialized.stageId === request.artifactId,
        )
    const result =
      quorumRootResult ??
      (stage
        ? Object.entries(stage.results).find(([taskId]) =>
            taskId.includes(owner.ownerId),
          )?.[1]
        : undefined)
    return independentSlotResult(owner, result)
  })
  const signature =
    owner.kind === 'ecdsa'
      ? ({
          kind: 'ecdsa' as const,
          signer: owner.identity,
          slots: slots as readonly Hex[],
        } as const)
      : {
          kind: 'passkey' as const,
          publicKey: owner.identity,
          slots: slots as readonly {
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
  options?: { readonly proofs?: readonly IndexedProofContribution[] },
): Promise<SignedIntent<CompatibilityConfig>> {
  const { signing, planInput } = await createIndependentSigningInput(
    context,
    prepared,
  )
  const plan = createIntentSigningPlan(planInput)
  const owners = independentOwners(signing)
  const slots = independentSlots(prepared)
  const assembled = Object.fromEntries(
    slots.map((request, slotIndex) => {
      const artifact = plan.stages
        .flatMap(({ artifacts }) => artifacts)
        .find(({ id }) => id === request.artifactId)
      if (!artifact) {
        throw new Error(
          `Intent ${request.artifactId} assembly route is missing`,
        )
      }
      return [
        request.artifactId,
        assembleIndependentIntentArtifact({
          intentId: prepared.quote.intentId,
          slotIndex,
          slotCount: slots.length,
          signatures,
          owners,
          artifact,
          context: signing,
        }),
      ]
    }),
  )
  const local = new Map<number, SigningProof>()
  for (const request of prepared.signing.requests) {
    if (request.kind !== 'eip712') continue
    const source = request.reuse?.artifactId ?? request.artifactId
    const signature = assembled[source]
    // Anything the owners could not produce — a target execution payload, a
    // requested delegation — has to arrive as an indexed contribution instead
    // of being quietly dropped from the vector.
    if (!signature) continue
    local.set(request.index, { kind: 'eip712', signature })
  }
  return {
    prepared,
    proofs: assembleProofVector({
      intentId: prepared.quote.intentId,
      requestSetId: requestSetId(prepared.quote.signingRequests),
      requests: prepared.signing.requests,
      local,
      ...(options?.proofs ? { contributions: options.proofs } : {}),
    }),
    transcript: {
      planKind: 'intent-full',
      payloadId: plan.payload.id,
      stages: [],
    },
  }
}

/**
 * The request slots an independent owner signs, in order. Reused slots are not
 * among them: they are satisfied by the signature of the slot they reuse.
 */
function independentSlots<CompatibilityConfig>(
  prepared: PreparedIntent<CompatibilityConfig>,
): readonly Extract<IntentSigningRequest, { kind: 'eip712' }>[] {
  return prepared.signing.requests.filter(
    (request): request is Extract<IntentSigningRequest, { kind: 'eip712' }> =>
      request.kind === 'eip712' && request.exposedForIndependentSigning,
  )
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

function independentSlotResult(
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
  // A chain-agnostic origin is deliberately excluded: every leaf here is hashed
  // with its own chain id, so it would be bound to the leg the payload happens
  // to name. Routing it down the plain branch instead reaches the one refusal
  // in `resolveAccountTypedDataSigning`.
  const signable = prepared.signing.requests.filter(
    (request): request is Extract<IntentSigningRequest, { kind: 'eip712' }> =>
      request.kind === 'eip712' && !request.reuse,
  )
  const reused = prepared.signing.requests.filter(
    (request): request is Extract<IntentSigningRequest, { kind: 'eip712' }> =>
      request.kind === 'eip712' && Boolean(request.reuse),
  )
  const quorumMerkle =
    context.validator.kind === 'quorum' &&
    signable.length > 1 &&
    !signable.some(({ payload }) =>
      signatureSpansMultipleChains(payload.typedData),
    )
      ? buildQuorumMerkleTree(
          signable.map(({ payload }) => ({
            account: context.account.address,
            digest: resolveAccountValidatorSignableHash({
              hash: payload.id,
              chain: payload.chain,
              context,
            }),
          })),
        )
      : undefined
  const quorumRootHash = quorumMerkle
    ? getQuorumMerkleRootSignableHash({
        validator: context.validatorCapabilities.compatibilityKey.moduleAddress,
        root: quorumMerkle.root,
      })
    : undefined
  if (quorumMerkle && quorumRootHash) {
    const first = signable[0]!
    const route: AccountTypedDataSigningRoute = {
      material: { kind: 'message', message: { raw: quorumRootHash } },
      payloadKind: 'message',
      ecdsaInvocation: 'ecdsa-sign-message',
      webauthnInvocation: 'webauthn-sign-hash',
      erc7739: { kind: 'none' },
    }
    payloads[first.payload.id] = route.material
    stages.push(
      quorumMerkleSigningStage({
        requests: signable,
        payloadId: first.payload.id,
        context,
        route,
        proofs: quorumMerkle.operations,
      }),
    )
  } else {
    for (const request of signable) {
      const route = resolveAccountTypedDataSigning({
        typedData: request.payload.typedData,
        chain: request.payload.chain,
        context,
        validationHash: request.payload.id,
        spansMultipleChains: signatureSpansMultipleChains(
          request.payload.typedData,
        ),
      })
      payloads[request.payload.id] = route.material
      stages.push(
        signingStage({
          id: request.artifactId,
          payloadId: request.payload.id,
          chain: request.payload.chain,
          usage: request.payload.usage,
          context,
          route,
        }),
      )
    }
  }
  for (const request of reused) {
    const reuse = request.reuse!
    const stageId = quorumMerkle ? 'quorum-origins' : reuse.artifactId
    stages.push({
      id: request.artifactId,
      checkpoint: { kind: 'none', id: `${request.artifactId}:none` },
      priorOutputs: [
        {
          stageId,
          outputId: reuse.artifactId,
          selection: reuse.selection,
        },
      ],
      tasks: [],
      schedule: [],
      artifacts: [
        {
          id: request.artifactId,
          usage: request.payload.usage,
          input: {
            kind: 'reuse-artifact',
            stageId,
            artifactId: reuse.artifactId,
            selection: reuse.selection,
          },
          validatorCodec: { kind: 'none' },
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'none' },
          erc6492: { kind: 'none' },
        },
      ],
    })
  }
  return { intent: prepared.signing, stages, payloads }
}

function quorumMerkleSigningStage(input: {
  readonly requests: readonly Extract<
    IntentSigningRequest,
    { kind: 'eip712' }
  >[]
  readonly payloadId: Hex
  readonly context: SigningContext
  readonly route: AccountTypedDataSigningRoute
  readonly proofs: readonly {
    readonly root: Hex
    readonly proof: readonly Hex[]
  }[]
}): IntentSigningStageInput {
  const tasks = createValidatorSigningTasks({
    validator: input.context.validator,
    signerReferences: input.context.signerReferences,
    taskPrefix: 'quorum-root',
    ecdsaInvocation: input.route.ecdsaInvocation,
    webauthnInvocation: input.route.webauthnInvocation,
    selectedSignerIds: input.context.effectiveSigners.signerIds,
  }).map(
    (task): SigningTaskTemplate => ({
      ...task,
      payload: { source: 'plan-payload', payloadId: input.payloadId },
    }),
  )
  const validatorCodec = getSigningValidatorCodec(
    input.context,
    input.route.payloadKind,
  )
  return {
    id: 'quorum-origins',
    checkpoint: { kind: 'none', id: 'quorum-origins:none' },
    priorOutputs: [],
    tasks,
    schedule: [
      {
        id: 'quorum-root:signers',
        execution: 'parallel',
        taskIds: tasks.map(({ id }) => id),
      },
    ],
    artifacts: input.requests.map((request, index) => ({
      id: request.artifactId,
      usage: request.payload.usage,
      input: { kind: 'task-results', taskIds: tasks.map(({ id }) => id) },
      validatorCodec,
      quorumMerkleProof: input.proofs[index],
      erc7739: { kind: 'none' },
      accountEnvelope: getAccountSignatureEnvelope(input.context),
      erc6492: { kind: 'none' },
    })),
  }
}

function signingStage(input: {
  readonly id: string
  readonly payloadId: Hex
  readonly chain: import('../../chains/types').EvmChainReference
  readonly usage: SignatureUsage
  readonly context: SigningContext
  readonly route: AccountTypedDataSigningRoute
  readonly quorumMerkleProof?: {
    readonly root: Hex
    readonly proof: readonly Hex[]
  }
  readonly reuseStageId?: string
}): IntentSigningStageInput {
  const direct = input.context.account.definition.kind === 'eoa'
  const tasks = input.reuseStageId
    ? []
    : direct
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
    input: input.reuseStageId
      ? {
          kind: 'reuse-artifact',
          stageId: input.reuseStageId,
          artifactId: input.reuseStageId,
          selection: 'whole',
        }
      : { kind: 'task-results', taskIds: tasks.map(({ id }) => id) },
    validatorCodec: input.reuseStageId
      ? { kind: 'none' }
      : direct
        ? { kind: 'none' }
        : getSigningValidatorCodec(input.context, input.route.payloadKind),
    ...(!direct &&
    !input.reuseStageId &&
    input.context.validator.kind === 'multi-factor'
      ? {
          validatorFactors: getSigningValidatorFactors(
            input.context,
            input.route.payloadKind,
          ),
        }
      : {}),
    ...(input.quorumMerkleProof
      ? { quorumMerkleProof: input.quorumMerkleProof }
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
    priorOutputs: input.reuseStageId
      ? [
          {
            stageId: input.reuseStageId,
            outputId: input.reuseStageId,
            selection: 'whole',
          },
        ]
      : [],
    tasks,
    schedule:
      tasks.length === 0
        ? []
        : [
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
