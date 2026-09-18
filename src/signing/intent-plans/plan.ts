import type { SigningContext } from '../context'
import { executeSigningPlan } from '../execute'
import type {
  SigningCheckpointPort,
  SigningPlan,
  SigningTranscript,
} from '../types'
import { assembleIntentStage } from './assemble'
import {
  eip712Requests,
  type IndependentSigningProjection,
  type IntentSigningPlanCreationInput,
} from './types'

export function createIntentSigningPlan(
  input: IntentSigningPlanCreationInput,
): SigningPlan {
  const reuses = eip712Requests(input.intent).flatMap((request) =>
    request.reuse
      ? [
          {
            artifactId: request.artifactId,
            sourceArtifactId: request.reuse.artifactId,
            selection: request.reuse.selection,
          },
        ]
      : [],
  )
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
      ...(reuses.length > 0 ? { reuses } : {}),
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
  for (const request of eip712Requests(input.intent)) {
    const requirement = requirements.get(request.artifactId)
    if (!requirement) {
      throw new Error(
        `Intent request ${request.index} has no artifact requirement`,
      )
    }
    const route = artifacts.find(({ id }) => id === request.artifactId)
    if (!route) {
      throw new Error(`Intent request ${request.index} has no assembly route`)
    }
    if (!request.reuse) {
      if (
        requirement.payloadId !== request.payload.id ||
        route.input.kind === 'reuse-artifact'
      ) {
        throw new Error(
          `Intent request ${request.index} signing route is incompatible`,
        )
      }
      continue
    }
    if (
      route.input.kind !== 'reuse-artifact' ||
      route.input.artifactId !== request.reuse.artifactId ||
      route.input.selection !== request.reuse.selection
    ) {
      throw new Error(
        `Intent request ${request.index} reuse route is incompatible`,
      )
    }
  }
}

function assertPreparedMode(input: IntentSigningPlanCreationInput): void {
  const signed = eip712Requests(input.intent).filter(({ reuse }) => !reuse)
  const claimArtifacts = input.intent.artifacts.filter(
    ({ usage }) =>
      usage === 'intent-pre-claim' || usage === 'intent-notarized-claim',
  )
  const expected = signed.length
  const produced = input.intent.artifacts.length - claimArtifacts.length
  if (produced < expected) {
    throw new Error(
      `Prepared signature mode requires ${expected} signed artifacts, received ${produced}`,
    )
  }
  const invalidShape = input.intent.artifacts.some(({ shape }) =>
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
      `Prepared signature mode requires ${expectedShape} artifacts`,
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
