import type { ResolvedValidatorDefinition } from '../modules/validators/types'
import { SigningPipelineError } from './error'
import type {
  ArtifactAssemblyPlan,
  ConfiguredValidatorTopology,
  EffectiveSignerSelection,
  MaterializedSigningStage,
  PayloadSigningTask,
  SigningArtifact,
  SigningPayloadIdentity,
  SigningPayloadMaterial,
  SigningPayloadRegistry,
  SigningPlan,
  SigningPlanKind,
  SigningReadCheckpoint,
  SigningRuntimeFact,
  SigningStagePlan,
  SigningTask,
  SigningTaskTemplate,
} from './types'

export function validateSigningPlan(plan: SigningPlan): void {
  const stageIds = new Set<string>()
  const taskIds = new Set<string>()
  const artifactIds = new Set<string>()
  const artifactStages = new Map<string, string>()
  for (const stage of plan.stages) {
    assertUnique(stageIds, stage.id, `Duplicate signing stage ${stage.id}`)
    const declaredPriorOutputs = new Set<string>()
    for (const prior of stage.priorOutputs) {
      const key = priorOutputKey(prior)
      assertUnique(
        declaredPriorOutputs,
        key,
        `Duplicate prior output ${prior.stageId}:${prior.outputId}`,
      )
      if (artifactStages.get(prior.outputId) !== prior.stageId) {
        fail(
          plan,
          `Prior output ${prior.stageId}:${prior.outputId} is unavailable`,
          stage.id,
        )
      }
    }
    const scheduled = new Set<string>()
    const stageTasks = new Set<string>()
    for (const task of stage.taskTemplates) {
      assertUnique(taskIds, task.id, `Duplicate signing task ${task.id}`)
      stageTasks.add(task.id)
      if (
        task.payload.source === 'prior-output' &&
        !declaredPriorOutputs.has(priorOutputKey(task.payload))
      ) {
        fail(
          plan,
          `Signing task ${task.id} uses an undeclared prior output`,
          stage.id,
        )
      }
      if (
        task.payload.source === 'checkpoint-fact' &&
        (stage.checkpoint.kind === 'none' ||
          task.payload.checkpointId !== stage.checkpoint.id)
      ) {
        fail(
          plan,
          `Signing task ${task.id} uses an undeclared checkpoint`,
          stage.id,
        )
      }
      if (
        task.when &&
        (stage.checkpoint.kind !== 'delegation-code' ||
          task.when.factId !== stage.checkpoint.id)
      ) {
        fail(
          plan,
          `Signing task ${task.id} uses an undeclared delegation fact`,
          stage.id,
        )
      }
    }
    for (const batch of stage.schedule) {
      for (const taskId of batch.taskIds) {
        if (!stageTasks.has(taskId)) {
          fail(plan, `Schedule references unknown task ${taskId}`, stage.id)
        }
        assertUnique(
          scheduled,
          taskId,
          `Signing task ${taskId} is scheduled more than once`,
        )
      }
    }
    if (scheduled.size !== stageTasks.size) {
      fail(plan, `Stage ${stage.id} has unscheduled signing tasks`, stage.id)
    }
    for (const artifact of stage.artifacts) {
      if (artifact.stageId !== stage.id) {
        fail(plan, `Artifact ${artifact.id} belongs to another stage`, stage.id)
      }
      assertUnique(
        artifactIds,
        artifact.id,
        `Duplicate signing artifact ${artifact.id}`,
      )
      artifactStages.set(artifact.id, stage.id)
      switch (artifact.input.kind) {
        case 'task-results':
          for (const taskId of artifact.input.taskIds) {
            if (!stageTasks.has(taskId)) {
              fail(
                plan,
                `Artifact ${artifact.id} references a task outside its stage`,
                stage.id,
                artifact.id,
              )
            }
          }
          break
        case 'reuse-artifact': {
          const reference = {
            stageId: artifact.input.stageId,
            outputId: artifact.input.artifactId,
            selection: artifact.input.selection,
          }
          if (!declaredPriorOutputs.has(priorOutputKey(reference))) {
            fail(
              plan,
              `Artifact ${artifact.id} uses an undeclared prior output`,
              stage.id,
              artifact.id,
            )
          }
          break
        }
        case 'session-claim-pair':
          for (const componentId of [
            artifact.input.preClaimArtifactId,
            artifact.input.notarizedClaimArtifactId,
          ]) {
            if (
              componentId === artifact.id ||
              artifactStages.get(componentId) !== stage.id
            ) {
              fail(
                plan,
                `Session claim pair ${artifact.id} references an unavailable component`,
                stage.id,
                artifact.id,
              )
            }
          }
          break
      }
      if (
        artifact.validatorCodec.kind === 'smart-session-state' &&
        (stage.checkpoint.kind !== 'session-enabled' ||
          stage.checkpoint.id !== artifact.validatorCodec.factId)
      ) {
        fail(
          plan,
          `Artifact ${artifact.id} uses an undeclared session-state fact`,
          stage.id,
          artifact.id,
        )
      }
      if (artifact.validatorCodec.kind === 'smart-session-state') {
        const { whenEnabled, whenDisabled } = artifact.validatorCodec
        if (
          whenEnabled.validator.address.toLowerCase() !==
            whenDisabled.validator.address.toLowerCase() ||
          whenEnabled.permissionId.toLowerCase() !==
            whenDisabled.permissionId.toLowerCase()
        ) {
          fail(
            plan,
            `Artifact ${artifact.id} changes Smart Session identity by state`,
            stage.id,
            artifact.id,
          )
        }
        if (
          whenEnabled.mode === 'enable-and-use' ||
          whenDisabled.mode !== 'enable-and-use' ||
          !whenDisabled.enableData
        ) {
          fail(
            plan,
            `Artifact ${artifact.id} has an invalid Smart Session state route`,
            stage.id,
            artifact.id,
          )
        }
      } else if (
        artifact.validatorCodec.kind === 'smart-session' &&
        artifact.validatorCodec.mode === 'enable-and-use' &&
        !artifact.validatorCodec.enableData
      ) {
        fail(
          plan,
          `Artifact ${artifact.id} has no Smart Session enable data`,
          stage.id,
          artifact.id,
        )
      }
      if (artifact.erc6492.kind !== 'none' && artifact.usage !== 'erc1271') {
        fail(
          plan,
          `ERC-6492 is not permitted for ${artifact.usage}`,
          stage.id,
          artifact.id,
        )
      }
      if (plan.kind === 'account-message' && artifact.erc7739.kind !== 'none') {
        fail(
          plan,
          'ERC-7739 is not a message-signing operation',
          stage.id,
          artifact.id,
        )
      }
    }
  }
  const outputIds = new Set<string>()
  for (const output of plan.publicOutputs) {
    assertUnique(outputIds, output.id, `Duplicate public output ${output.id}`)
    if (
      output.source.kind === 'artifact' &&
      !artifactIds.has(output.source.artifactId)
    ) {
      fail(
        plan,
        `Public output references unknown artifact ${output.source.artifactId}`,
      )
    }
    if (
      output.source.kind === 'task-result' &&
      !taskIds.has(output.source.taskId)
    ) {
      fail(
        plan,
        `Public output references unknown task ${output.source.taskId}`,
      )
    }
  }
}

function priorOutputKey(input: {
  readonly stageId: string
  readonly outputId: string
  readonly selection: 'whole' | 'pre-claim'
}): string {
  return `${input.stageId}:${input.outputId}:${input.selection}`
}

export function materializeSigningStage(input: {
  readonly plan: SigningPlan
  readonly stage: SigningStagePlan
  readonly payloads: SigningPayloadRegistry
  readonly facts: readonly SigningRuntimeFact[]
  readonly priorOutputs: Readonly<Record<string, SigningArtifact>>
}): MaterializedSigningStage {
  return {
    stageId: input.stage.id,
    facts: input.facts,
    tasks: input.stage.taskTemplates
      .filter((template) => taskIsRequired(template, input.facts))
      .map((template) => materializeTask(template, input)),
    schedule: input.stage.schedule
      .map((batch) => ({
        ...batch,
        taskIds: batch.taskIds.filter((taskId) => {
          const template = input.stage.taskTemplates.find(
            ({ id }) => id === taskId,
          )
          return template && taskIsRequired(template, input.facts)
        }),
      }))
      .filter(({ taskIds }) => taskIds.length > 0),
  }
}

export function createSingleStageSigningPlan(input: {
  readonly kind: SigningPlanKind
  readonly payload: SigningPayloadIdentity
  readonly configuredTopology: ConfiguredValidatorTopology
  readonly effectiveSelection: EffectiveSignerSelection
  readonly stageId: string
  readonly checkpoint?: SigningReadCheckpoint
  readonly chain?: import('../chains/types').EvmChainReference
  readonly tasks: readonly PayloadSigningTask[]
  readonly artifacts: readonly Omit<ArtifactAssemblyPlan, 'stageId' | 'input'>[]
}): SigningPlan {
  const taskTemplates = input.tasks.map(
    (task): SigningTaskTemplate => ({
      ...task,
      ...(input.chain ? { chain: input.chain } : {}),
      payload: { source: 'plan-payload', payloadId: input.payload.id },
    }),
  )
  return {
    version: 1,
    kind: input.kind,
    payload: input.payload,
    configuredTopology: input.configuredTopology,
    effectiveSelection: input.effectiveSelection,
    stages: [
      {
        id: input.stageId,
        checkpoint: input.checkpoint ?? {
          kind: 'none',
          id: `${input.stageId}-no-read`,
        },
        priorOutputs: [],
        taskTemplates,
        schedule:
          taskTemplates.length === 0
            ? []
            : [
                {
                  id: `${input.stageId}-signers`,
                  execution: 'parallel',
                  taskIds: taskTemplates.map(({ id }) => id),
                },
              ],
        artifacts: input.artifacts.map((artifact) => ({
          ...artifact,
          stageId: input.stageId,
          input: {
            kind: 'task-results',
            taskIds: taskTemplates.map(({ id }) => id),
          },
        })),
      },
    ],
    publicOutputs: input.artifacts.map((artifact) => ({
      id: artifact.id,
      source: { kind: 'artifact', artifactId: artifact.id },
      exposedForIndependentSigning: false,
    })),
  }
}

export function createValidatorSigningTasks(input: {
  readonly validator: ResolvedValidatorDefinition
  readonly signerReferences: Readonly<
    Record<string, import('./types').SignerReference>
  >
  readonly taskPrefix: string
  readonly ecdsaInvocation: 'ecdsa-sign-message' | 'ecdsa-sign-typed-data'
  readonly webauthnInvocation: 'webauthn-sign-hash' | 'webauthn-sign-typed-data'
  readonly role?: import('./types').SigningTaskRole
}): readonly PayloadSigningTask[] {
  const factors =
    input.validator.kind === 'multi-factor'
      ? input.validator.validators.map((validator) => ({
          factorId: validator.id,
          owners: validator.owners,
        }))
      : [{ factorId: undefined, owners: input.validator.owners }]
  return factors.flatMap((factor) =>
    factor.owners.map((owner) => {
      const signer = input.signerReferences[owner.signerId]
      if (!signer)
        throw new Error(`Signer reference ${owner.signerId} is missing`)
      const webauthn = owner.kind === 'webauthn'
      return {
        id: `${input.taskPrefix}:${owner.id}`,
        signer,
        role: input.role ?? (factor.factorId ? 'factor' : 'owner'),
        invocationKind: webauthn
          ? input.webauthnInvocation
          : input.ecdsaInvocation,
        contribution: webauthn
          ? {
              kind: 'webauthn' as const,
              ownerId: owner.id,
              publicKey: owner.account.publicKey,
              ...(factor.factorId ? { factorId: factor.factorId } : {}),
            }
          : {
              kind: 'ecdsa' as const,
              ownerId: owner.id,
              encoding: 'raw-signer' as const,
              ...(factor.factorId ? { factorId: factor.factorId } : {}),
            },
      }
    }),
  )
}

export function signingTopology(validator: ResolvedValidatorDefinition): {
  readonly configuredTopology: ConfiguredValidatorTopology
  readonly effectiveSelection: EffectiveSignerSelection
} {
  const validators =
    validator.kind === 'multi-factor' ? validator.validators : [validator]
  return {
    configuredTopology: {
      rootValidatorId: validator.id,
      validators: validators.map((item) => ({
        id: item.id,
        ownerIds: item.owners.map(({ id }) => id),
        threshold: item.threshold,
      })),
      threshold: validator.threshold,
    },
    effectiveSelection: {
      validatorIds: validators.map(({ id }) => id),
      signerIds: validators.flatMap((item) =>
        item.owners.map(({ signerId }) => signerId),
      ),
      threshold: validator.threshold,
    },
  }
}

function taskIsRequired(
  template: SigningTaskTemplate,
  facts: readonly SigningRuntimeFact[],
): boolean {
  if (!template.when) return true
  const fact = facts.find(({ id }) => id === template.when?.factId)
  if (fact?.kind !== 'delegation-code') {
    throw new Error(`Delegation fact ${template.when.factId} is missing`)
  }
  return (
    fact.code?.toLowerCase() !==
    `0xef0100${template.when.contract.slice(2)}`.toLowerCase()
  )
}

function materializeTask(
  template: SigningTaskTemplate,
  input: Parameters<typeof materializeSigningStage>[0],
): SigningTask {
  const material = resolvePayloadMaterial(template, input)
  const chain = template.chain
  switch (template.invocationKind) {
    case 'ecdsa-sign-message':
      requireMaterial(template, material, 'message')
      return {
        ...template,
        invocation: {
          kind: 'ecdsa-sign-message',
          ...(chain ? { chain } : {}),
          message: material.message,
        },
      }
    case 'ecdsa-sign-typed-data':
      requireMaterial(template, material, 'typed-data')
      return {
        ...template,
        invocation: {
          kind: 'ecdsa-sign-typed-data',
          ...(chain ? { chain } : {}),
          typedData: material.typedData,
        },
      }
    case 'webauthn-sign-hash':
      requireMaterial(template, material, 'message')
      return {
        ...template,
        invocation: { kind: 'webauthn-sign-hash', hash: material.message.raw },
      }
    case 'webauthn-sign-typed-data':
      requireMaterial(template, material, 'typed-data')
      return {
        ...template,
        invocation: {
          kind: 'webauthn-sign-typed-data',
          typedData: material.typedData,
        },
      }
    case 'sign-authorization':
      requireMaterial(template, material, 'authorization')
      if (!chain)
        throw new Error(`Authorization task ${template.id} has no chain`)
      return {
        ...template,
        invocation: {
          kind: 'sign-authorization',
          chain,
          authorization: material.authorization,
        },
      }
  }
}

function resolvePayloadMaterial(
  template: SigningTaskTemplate,
  input: Parameters<typeof materializeSigningStage>[0],
): SigningPayloadMaterial {
  const reference = template.payload
  if (reference.source === 'plan-payload') {
    const material = input.payloads[reference.payloadId]
    if (!material)
      throw new Error(`No payload material for ${reference.payloadId}`)
    return material
  }
  if (reference.source === 'prior-output') {
    const artifact =
      input.priorOutputs[`${reference.stageId}:${reference.outputId}`]
    const selected =
      reference.selection === 'pre-claim' &&
      typeof artifact === 'object' &&
      'preClaimSig' in artifact
        ? artifact.preClaimSig
        : artifact
    if (typeof selected !== 'string') {
      throw new Error(
        `Prior output ${reference.outputId} is not signable bytes`,
      )
    }
    return { kind: 'message', message: { raw: selected } }
  }
  const fact = input.facts.find(({ id }) => id === reference.factId)
  if (fact?.kind !== 'delegation-code' || !fact.code) {
    throw new Error(`Checkpoint fact ${reference.factId} is not signable bytes`)
  }
  return { kind: 'message', message: { raw: fact.code } }
}

function requireMaterial<Kind extends SigningPayloadMaterial['kind']>(
  template: SigningTaskTemplate,
  material: SigningPayloadMaterial,
  kind: Kind,
): asserts material is Extract<
  SigningPayloadMaterial,
  { readonly kind: Kind }
> {
  if (material.kind !== kind) {
    throw new Error(
      `Signing task ${template.id} requires ${kind}, received ${material.kind}`,
    )
  }
}

function assertUnique(
  values: Set<string>,
  value: string,
  message: string,
): void {
  if (values.has(value)) throw new Error(message)
  values.add(value)
}

function fail(
  plan: SigningPlan,
  message: string,
  stageId?: string,
  artifactId?: string,
): never {
  throw new SigningPipelineError(message, {
    planKind: plan.kind,
    payloadKind: plan.payload.kind,
    failureStage: 'plan',
    ...(stageId ? { stageId } : {}),
    ...(artifactId ? { artifactId } : {}),
  })
}
