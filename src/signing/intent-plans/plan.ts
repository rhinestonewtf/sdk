import type { SigningContext } from '../context'
import { executeSigningPlan } from '../execute'
import type {
  SigningCheckpointPort,
  SigningPlan,
  SigningTranscript,
} from '../types'
import { assembleIntentStage } from './assemble'
import type {
  IndependentSigningProjection,
  IntentSigningPlanCreationInput,
} from './types'

export function createIntentSigningPlan(
  input: IntentSigningPlanCreationInput,
): SigningPlan {
  const targetArtifact = input.intent.target
    ? requireSingleArtifact(
        input.intent.artifacts.filter(
          ({ usage, payloadId }) =>
            usage === 'intent-target' && payloadId === input.intent.target?.id,
        ),
        'target',
      )
    : undefined
  const plan: SigningPlan = {
    version: 1,
    kind: 'intent-full',
    payload: { kind: 'intent', id: input.intent.id },
    configuredTopology: input.intent.configuredTopology,
    effectiveSelection: input.intent.effectiveSelection,
    preparedIntent: {
      signatureMode: input.intent.preparedSignatureMode,
      artifacts: input.intent.artifacts.map(
        ({ id, usage, payloadId, cardinality, shape }) => ({
          id,
          usage,
          payloadId,
          cardinality,
          shape,
        }),
      ),
      ...(input.intent.destination
        ? {
            destination:
              input.intent.destination.mode === 'sign'
                ? {
                    mode: 'sign' as const,
                    artifactId: input.intent.destination.artifactId,
                    payloadId: input.intent.destination.payload.id,
                  }
                : input.intent.destination,
          }
        : {}),
      ...(targetArtifact
        ? {
            target: {
              artifactId: targetArtifact.id,
              payloadId: targetArtifact.payloadId,
            },
          }
        : {}),
    },
    stages: input.stages.map((stage) => ({
      id: stage.id,
      checkpoint: stage.checkpoint,
      priorOutputs: stage.priorOutputs,
      taskTemplates: stage.tasks,
      schedule: stage.schedule,
      artifacts: stage.artifacts.map((artifact) => ({
        ...artifact,
        stageId: stage.id,
      })),
    })),
    publicOutputs: input.intent.artifacts.map((artifact) => ({
      id: artifact.id,
      source: { kind: 'artifact', artifactId: artifact.id },
      exposedForIndependentSigning: artifact.exposedForIndependentSigning,
    })),
  }
  assertPreparedMode(input)
  assertIntentRoutes(input, plan)
  return plan
}

export function projectIndependentSigning(
  plan: SigningPlan,
  signerIds: readonly string[],
  ownerIds?: readonly string[],
): {
  readonly plan: SigningPlan
  readonly projection: IndependentSigningProjection
} {
  if (plan.kind !== 'intent-full') {
    throw new Error('Independent signing requires a full intent plan')
  }
  const selected = new Set(signerIds)
  const selectedOwners = ownerIds ? new Set(ownerIds) : undefined
  if (selected.size !== signerIds.length) {
    throw new Error('Independent signer selection contains duplicates')
  }
  for (const signerId of selected) {
    if (!plan.effectiveSelection.signerIds.includes(signerId)) {
      throw new Error(`Independent signer ${signerId} is not in the plan`)
    }
  }
  const stages = plan.stages.map((stage) => {
    const taskTemplates = stage.taskTemplates.filter(
      (task) =>
        selected.has(task.signer.id) &&
        (!selectedOwners ||
          [...selectedOwners].some((ownerId) => task.id.includes(ownerId))),
    )
    const taskIds = new Set(taskTemplates.map(({ id }) => id))
    return {
      ...stage,
      priorOutputs: [],
      taskTemplates,
      schedule: stage.schedule
        .map((batch) => ({
          ...batch,
          taskIds: batch.taskIds.filter((taskId) => taskIds.has(taskId)),
        }))
        .filter(({ taskIds: ids }) => ids.length > 0),
      artifacts: [],
    }
  })
  const projected: SigningPlan = {
    ...plan,
    kind: 'intent-independent',
    effectiveSelection: {
      ...plan.effectiveSelection,
      signerIds: plan.effectiveSelection.signerIds.filter((id) =>
        selected.has(id),
      ),
    },
    stages,
    publicOutputs: stages.flatMap((stage) =>
      stage.taskTemplates.map((task) => ({
        id: `${task.id}-contribution`,
        source: { kind: 'task-result' as const, taskId: task.id },
        exposedForIndependentSigning: true,
      })),
    ),
  }
  return {
    plan: projected,
    projection: {
      planKind: 'intent-independent',
      sourceIntentId: plan.payload.id,
      exposedArtifactIds: projected.publicOutputs.map(({ id }) => id),
      selectedSignerIds: [...signerIds],
    },
  }
}

function assertIntentRoutes(
  input: IntentSigningPlanCreationInput,
  plan: SigningPlan,
): void {
  const artifacts = plan.stages.flatMap((stage) => stage.artifacts)
  const requirements = new Map(
    input.intent.artifacts.map((artifact) => [artifact.id, artifact]),
  )
  if (requirements.size !== input.intent.artifacts.length) {
    throw new Error('Intent artifact requirements contain duplicate ids')
  }
  for (const requirement of input.intent.artifacts) {
    if (!artifacts.some(({ id }) => id === requirement.id)) {
      throw new Error(`Intent artifact ${requirement.id} has no assembly route`)
    }
  }
  const destination = input.intent.destination
  if (!destination) return
  const requirement = requirements.get(destination.artifactId)
  if (!requirement || requirement.usage !== 'intent-destination') {
    throw new Error('Intent destination artifact requirement is missing')
  }
  const route = artifacts.find(({ id }) => id === destination.artifactId)
  if (!route) throw new Error('Intent destination assembly route is missing')
  if (destination.mode === 'sign') {
    if (
      requirement.payloadId !== destination.payload.id ||
      route.input.kind !== 'task-results'
    ) {
      throw new Error('Intent destination signing route is incompatible')
    }
    return
  }
  if (
    route.input.kind !== 'reuse-artifact' ||
    route.input.artifactId !== destination.originArtifactId ||
    route.input.selection !== destination.selection
  ) {
    throw new Error('Intent destination reuse route is incompatible')
  }
}

function requireSingleArtifact<Artifact>(
  artifacts: readonly Artifact[],
  role: string,
): Artifact {
  if (artifacts.length !== 1) {
    throw new Error(`Intent ${role} requires exactly one artifact`)
  }
  return artifacts[0]
}

function assertPreparedMode(input: IntentSigningPlanCreationInput): void {
  const originArtifacts = input.intent.artifacts.filter(
    ({ usage }) =>
      usage === 'intent-origin' ||
      usage === 'intent-pre-claim' ||
      usage === 'intent-notarized-claim',
  )
  const expectedPerOrigin = 1
  const expected = input.intent.origins.length * expectedPerOrigin
  if (originArtifacts.length !== expected) {
    throw new Error(
      `Prepared signature mode requires ${expected} origin artifacts, received ${originArtifacts.length}`,
    )
  }
  const invalidShape = originArtifacts.some(({ shape }) =>
    input.intent.preparedSignatureMode === 'default'
      ? shape !== 'hex'
      : !['hex', 'session-claims'].includes(shape),
  )
  if (invalidShape) {
    const expectedShape =
      input.intent.preparedSignatureMode === 'default'
        ? 'hex'
        : 'hex or session-claims'
    throw new Error(
      `Prepared signature mode requires ${expectedShape} origin artifacts`,
    )
  }
}

export async function executeIntentSigning(input: {
  readonly planInput: IntentSigningPlanCreationInput
  readonly context: SigningContext
  readonly checkpoints: SigningCheckpointPort
}): Promise<SigningTranscript> {
  const plan = createIntentSigningPlan(input.planInput)
  return executeSigningPlan({
    plan,
    payloads: input.planInput.payloads,
    signerInvoker: input.context.signerInvoker,
    checkpoints: input.checkpoints,
    assembleStage: (stage) => assembleIntentStage(stage, input.context),
  })
}
