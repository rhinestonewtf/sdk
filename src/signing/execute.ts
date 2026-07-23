import { SigningPipelineError } from './error'
import { materializeSigningStage, validateSigningPlan } from './plan'
import type {
  MaterializedSigningStage,
  RawSignerResult,
  SigningArtifact,
  SigningCheckpointPort,
  SigningPayloadRegistry,
  SigningPlan,
  SigningStagePlan,
  SigningTranscript,
} from './types'

export interface SigningStageAssemblyInput {
  readonly plan: SigningPlan
  readonly stagePlan: SigningStagePlan
  readonly stage: MaterializedSigningStage
  readonly results: Readonly<Record<string, RawSignerResult>>
  readonly priorOutputs: Readonly<Record<string, SigningArtifact>>
}

export type SigningStageAssembler = (
  input: SigningStageAssemblyInput,
) => Readonly<Record<string, SigningArtifact>>

export async function executeSigningPlan(input: {
  readonly plan: SigningPlan
  readonly payloads: SigningPayloadRegistry
  readonly checkpoints: SigningCheckpointPort
  readonly signerInvoker: import('./types').SignerInvocationPort
  readonly assembleStage: SigningStageAssembler
}): Promise<SigningTranscript> {
  try {
    validateSigningPlan(input.plan)
  } catch (cause) {
    if (cause instanceof SigningPipelineError) throw cause
    throw pipelineError(
      input.plan,
      'plan',
      'Signing plan validation failed',
      {},
      cause,
    )
  }
  for (const stage of input.plan.stages) {
    for (const task of stage.taskTemplates) {
      if (
        !task.when &&
        input.signerInvoker.has &&
        !input.signerInvoker.has(task.signer)
      ) {
        throw pipelineError(
          input.plan,
          'invoke',
          `Missing signer ${task.signer.id}`,
          {
            stageId: stage.id,
            taskId: task.id,
            signerRole: task.role,
            ...(task.chain ? { chain: task.chain } : {}),
          },
        )
      }
    }
  }
  const priorOutputs: Record<string, SigningArtifact> = {}
  const transcripts: SigningTranscript['stages'][number][] = []
  for (const stagePlan of input.plan.stages) {
    let facts: Awaited<ReturnType<SigningCheckpointPort['read']>> = []
    if (stagePlan.checkpoint.kind !== 'none') {
      try {
        facts = await input.checkpoints.read(stagePlan.checkpoint)
      } catch (cause) {
        throw pipelineError(
          input.plan,
          'read',
          `Signing checkpoint ${stagePlan.checkpoint.id} failed`,
          { stageId: stagePlan.id },
          cause,
        )
      }
    }
    let declaredPriorOutputs: Readonly<Record<string, SigningArtifact>>
    let stage: MaterializedSigningStage
    try {
      declaredPriorOutputs = selectDeclaredPriorOutputs(stagePlan, priorOutputs)
      stage = materializeSigningStage({
        plan: input.plan,
        stage: stagePlan,
        payloads: input.payloads,
        facts,
        priorOutputs: declaredPriorOutputs,
      })
    } catch (cause) {
      throw pipelineError(
        input.plan,
        'plan',
        `Signing stage ${stagePlan.id} materialization failed`,
        { stageId: stagePlan.id },
        cause,
      )
    }
    for (const task of stage.tasks) {
      if (
        task.when &&
        input.signerInvoker.has &&
        !input.signerInvoker.has(task.signer)
      ) {
        throw pipelineError(
          input.plan,
          'invoke',
          `Missing signer ${task.signer.id}`,
          {
            stageId: stage.stageId,
            taskId: task.id,
            signerRole: task.role,
            ...(task.chain ? { chain: task.chain } : {}),
          },
        )
      }
    }
    const results: Record<string, RawSignerResult> = {}
    const invoke = async (taskId: string): Promise<void> => {
      const task = stage.tasks.find(({ id }) => id === taskId)
      if (!task) throw new Error(`Unknown materialized signing task ${taskId}`)
      try {
        results[task.id] = await input.signerInvoker.invoke(
          task.signer,
          task.invocation,
        )
      } catch (cause) {
        throw pipelineError(
          input.plan,
          'invoke',
          `Signing task ${task.id} failed`,
          {
            stageId: stage.stageId,
            taskId: task.id,
            signerRole: task.role,
            ...(task.chain ? { chain: task.chain } : {}),
          },
          cause,
        )
      }
    }
    for (const batch of stage.schedule) {
      if (batch.execution === 'parallel') {
        await Promise.all(batch.taskIds.map(invoke))
      } else {
        for (const taskId of batch.taskIds) await invoke(taskId)
      }
    }
    let outputs: Readonly<Record<string, SigningArtifact>>
    try {
      outputs = input.assembleStage({
        plan: input.plan,
        stagePlan,
        stage,
        results,
        priorOutputs: declaredPriorOutputs,
      })
    } catch (cause) {
      if (cause instanceof SigningPipelineError) throw cause
      throw pipelineError(
        input.plan,
        'final-assembly',
        `Signing stage ${stage.stageId} assembly failed`,
        { stageId: stage.stageId },
        cause,
      )
    }
    for (const artifact of stagePlan.artifacts) {
      const output = outputs[artifact.id]
      if (output === undefined) {
        throw pipelineError(
          input.plan,
          'final-assembly',
          `Assembler omitted artifact ${artifact.id}`,
          { stageId: stage.stageId, artifactId: artifact.id },
        )
      }
      priorOutputs[`${stage.stageId}:${artifact.id}`] = output
    }
    transcripts.push({ stage, results, outputs })
  }
  return {
    planKind: input.plan.kind,
    payloadId: input.plan.payload.id,
    stages: transcripts,
  }
}

function selectDeclaredPriorOutputs(
  stage: SigningStagePlan,
  outputs: Readonly<Record<string, SigningArtifact>>,
): Readonly<Record<string, SigningArtifact>> {
  return Object.fromEntries(
    stage.priorOutputs.map((reference) => {
      const key = `${reference.stageId}:${reference.outputId}`
      const output = outputs[key]
      if (output === undefined) {
        throw new Error(`Declared prior output ${key} is unavailable`)
      }
      return [key, output]
    }),
  )
}

function pipelineError(
  plan: SigningPlan,
  failureStage: ConstructorParameters<
    typeof SigningPipelineError
  >[1]['failureStage'],
  message: string,
  context: Omit<
    ConstructorParameters<typeof SigningPipelineError>[1],
    'planKind' | 'payloadKind' | 'failureStage'
  >,
  cause?: unknown,
): SigningPipelineError {
  return new SigningPipelineError(
    message,
    {
      planKind: plan.kind,
      payloadKind: plan.payload.kind,
      failureStage,
      ...context,
    },
    cause === undefined ? undefined : { cause },
  )
}
