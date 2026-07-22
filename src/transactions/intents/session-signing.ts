import {
  type Address,
  encodePacked,
  type Hex,
  hashMessage,
  pad,
  type TypedDataDefinition,
} from 'viem'
import type { AccountSignatureEnvelope } from '../../accounts/types'
import { getSupportedChain, sharedChainCatalog } from '../../chains/catalog'
import { getValidatorCapabilities } from '../../modules/validators/capabilities'
import { defineValidator } from '../../modules/validators/definition'
import type { Permit2ClaimMessage } from '../../modules/validators/policies/claim/permit2'
import { buildPermit2ClaimPolicyCalldata } from '../../modules/validators/policies/claim/permit2'
import {
  resolveAtomicValidator,
  resolveValidator,
} from '../../modules/validators/resolve'
import { getSessionData } from '../../modules/validators/smart-sessions/digest'
import { getSmartSessionEmissaryAddress } from '../../modules/validators/smart-sessions/module'
import {
  resolvePermit2ClaimPolicy,
  selectPermit2ClaimPolicyForMessage,
} from '../../modules/validators/smart-sessions/policies/claim'
import type { ResolvedSessionSignerSet } from '../../modules/validators/smart-sessions/types'
import type {
  ResolvedValidatorDefinition,
  ValidatorContributionCodec,
} from '../../modules/validators/types'
import type { SigningContext } from '../../signing/context'
import { getAccountSignatureEnvelope } from '../../signing/context'
import type { IntentSigningPlanCreationInput } from '../../signing/intent-plans/types'
import {
  createValidatorSigningTasks,
  signingTopology,
} from '../../signing/plan'
import { createSignerInvocationPort } from '../../signing/signers/registry'
import type { ExternalSignerRegistry } from '../../signing/signers/types'
import type {
  ArtifactAssemblyPlan,
  SignerInvocationPort,
  SigningPayloadRegistry,
  SigningTaskTemplate,
} from '../../signing/types'
import type { PreparedIntent } from './types'

export function createIntentSessionSignerInvoker<CompatibilityConfig>(
  prepared: PreparedIntent<CompatibilityConfig>,
  fallback: SignerInvocationPort,
): SignerInvocationPort {
  const signers: Record<string, ExternalSignerRegistry[string]> = {}
  for (const resolved of Object.values(prepared.resolvedSessions ?? {})) {
    const validator = defineValidator(
      resolved.session.owners,
      'smart-session-validator',
    )
    const owners =
      validator.kind === 'multi-factor'
        ? validator.validators.flatMap(
            ({ owners: factorOwners }) => factorOwners,
          )
        : validator.owners
    for (const owner of owners) {
      signers[owner.signerId] =
        owner.kind === 'webauthn'
          ? { kind: 'webauthn', account: owner.account }
          : { kind: 'ecdsa', account: owner.account }
    }
  }
  const session = createSignerInvocationPort({
    signers,
    resolveChain: (chain) => getSupportedChain(sharedChainCatalog, chain.id),
  })
  return {
    has: (signer) => session.has?.(signer) ?? fallback.has?.(signer) ?? false,
    invoke: (signer, invocation) =>
      session.has?.(signer)
        ? session.invoke(signer, invocation)
        : fallback.invoke(signer, invocation),
  }
}

export function buildSessionIntentPlanInput<CompatibilityConfig>(
  prepared: PreparedIntent<CompatibilityConfig>,
  context: SigningContext,
): IntentSigningPlanCreationInput {
  const payloads: Record<Hex, SigningPayloadRegistry[Hex]> = {}
  const stages: IntentSigningPlanCreationInput['stages'][number][] = []
  for (const [index, origin] of prepared.signing.origins.entries()) {
    const session = requireSession(prepared, origin.chain.id)
    stages.push(
      buildSessionStage({
        id: `origin-${index}`,
        outputId: `origin-${index}`,
        usage: 'intent-origin',
        typedData: origin.typedData,
        payloadId: origin.id,
        chain: origin.chain,
        session,
        environment: requireSessionEnvironment(prepared),
        context,
        payloads,
        output: session.verifyExecutions ? 'pair' : 'notarized',
      }),
    )
  }
  const destination = prepared.signing.destination
  if (destination?.mode === 'sign') {
    const session = requireSession(prepared, destination.payload.chain.id)
    stages.push(
      buildSessionStage({
        id: 'destination',
        outputId: destination.artifactId,
        usage: 'intent-destination',
        typedData: destination.payload.typedData,
        payloadId: destination.payload.id,
        chain: destination.payload.chain,
        session,
        environment: requireSessionEnvironment(prepared),
        context,
        payloads,
        output: session.verifyExecutions ? 'pre-claim' : 'notarized',
        includeNotarized: session.verifyExecutions,
      }),
    )
  } else if (destination) {
    const stageId = destination.originArtifactId
    stages.push({
      id: 'destination',
      checkpoint: { kind: 'none', id: 'destination:none' },
      priorOutputs: [
        {
          stageId,
          outputId: destination.originArtifactId,
          selection: destination.selection,
        },
      ],
      tasks: [],
      schedule: [],
      artifacts: [
        {
          id: destination.artifactId,
          usage: 'intent-destination',
          input: {
            kind: 'reuse-artifact',
            stageId,
            artifactId: destination.originArtifactId,
            selection: destination.selection,
          },
          validatorCodec: { kind: 'none' },
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'none' },
          erc6492: { kind: 'none' },
        },
      ],
    })
  }
  if (prepared.signing.target) {
    const target = prepared.signing.target
    stages.push(
      buildSessionStage({
        id: 'target',
        outputId: 'target',
        usage: 'intent-target',
        typedData: target.typedData,
        payloadId: target.id,
        chain: target.chain,
        session: requireSession(prepared, target.chain.id),
        environment: requireSessionEnvironment(prepared),
        context,
        payloads,
        output: 'pre-claim',
      }),
    )
  }
  return { intent: prepared.signing, stages, payloads }
}

function buildSessionStage(input: {
  readonly id: string
  readonly outputId: string
  readonly usage: 'intent-origin' | 'intent-destination' | 'intent-target'
  readonly typedData: TypedDataDefinition
  readonly payloadId: Hex
  readonly chain: import('../../chains/types').EvmChainReference
  readonly session: ResolvedSessionSignerSet
  readonly environment: 'production' | 'development'
  readonly context: SigningContext
  readonly payloads: Record<Hex, SigningPayloadRegistry[Hex]>
  readonly output: 'pair' | 'pre-claim' | 'notarized'
  readonly includeNotarized?: boolean
}): IntentSigningPlanCreationInput['stages'][number] {
  const signing = sessionOwnerSigning(
    input.session,
    input.context.account.address,
  )
  const module = getSmartSessionEmissaryAddress(input.environment)
  const tasks: SigningTaskTemplate[] = []
  const artifacts: Omit<ArtifactAssemblyPlan, 'stageId'>[] = []
  const scheduleIds: string[] = []
  const checkpoint = input.session.enableData
    ? {
        kind: 'session-enabled' as const,
        id: `${input.id}:session-enabled`,
        chain: input.chain,
        account: input.context.account.address,
        permissionId: input.session.session.permissionId,
      }
    : { kind: 'none' as const, id: `${input.id}:none` }
  const notarizedId = `${input.id}:notarized`
  if (
    input.output === 'pair' ||
    input.output === 'notarized' ||
    input.includeNotarized
  ) {
    const payloadId = notarizedPayload(
      input.context.account.address,
      input.payloadId,
    )
    input.payloads[payloadId] = {
      kind: 'message',
      message: { raw: payloadId },
    }
    const stageTasks = sessionTasks(
      `${notarizedId}:signer`,
      signing,
      input.chain,
      payloadId,
      'session-notarized',
    )
    tasks.push(...stageTasks)
    scheduleIds.push(...stageTasks.map(({ id }) => id))
    artifacts.push({
      id: input.output === 'notarized' ? input.outputId : notarizedId,
      usage:
        input.output === 'notarized' ? input.usage : 'intent-notarized-claim',
      input: {
        kind: 'task-results',
        taskIds: stageTasks.map(({ id }) => id),
      },
      validatorCodec: sessionCodec(
        input.session,
        module,
        signing.signerCodec,
        'notarized',
        input.typedData,
      ),
      ...(signing.validatorFactors
        ? { validatorFactors: signing.validatorFactors }
        : {}),
      erc7739: { kind: 'none' },
      accountEnvelope: sessionAccountEnvelope(
        getAccountSignatureEnvelope(input.context),
        module,
      ),
      erc6492: { kind: 'none' },
    })
  }
  if (input.output === 'pair' || input.output === 'pre-claim') {
    input.payloads[input.payloadId] = {
      kind: 'message',
      message: { raw: input.payloadId },
    }
    const preClaimId =
      input.output === 'pre-claim' ? input.outputId : `${input.id}:pre-claim`
    const stageTasks = sessionTasks(
      `${preClaimId}:signer`,
      signing,
      input.chain,
      input.payloadId,
      'session-pre-claim',
    )
    tasks.push(...stageTasks)
    scheduleIds.push(...stageTasks.map(({ id }) => id))
    artifacts.push({
      id: preClaimId,
      usage: input.output === 'pre-claim' ? input.usage : 'intent-pre-claim',
      input: {
        kind: 'task-results',
        taskIds: stageTasks.map(({ id }) => id),
      },
      validatorCodec: sessionPreClaimCodec(
        input.session,
        module,
        signing.signerCodec,
        checkpoint.id,
      ),
      ...(signing.validatorFactors
        ? { validatorFactors: signing.validatorFactors }
        : {}),
      erc7739: { kind: 'none' },
      accountEnvelope: { kind: 'none' },
      erc6492: { kind: 'none' },
    })
  }
  if (input.output === 'pair') {
    artifacts.push({
      id: input.outputId,
      usage: input.usage,
      input: {
        kind: 'session-claim-pair',
        preClaimArtifactId: `${input.id}:pre-claim`,
        notarizedClaimArtifactId: notarizedId,
      },
      validatorCodec: { kind: 'none' },
      erc7739: { kind: 'none' },
      accountEnvelope: { kind: 'none' },
      erc6492: { kind: 'none' },
    })
  }
  return {
    id: input.id,
    checkpoint,
    priorOutputs: [],
    tasks,
    schedule: [
      {
        id: `${input.id}:session-signers`,
        execution: 'serial',
        taskIds: scheduleIds,
      },
    ],
    artifacts,
  }
}

function sessionTasks(
  taskPrefix: string,
  signing: ReturnType<typeof sessionOwnerSigning>,
  chain: import('../../chains/types').EvmChainReference,
  payloadId: Hex,
  role: 'session-notarized' | 'session-pre-claim',
): readonly SigningTaskTemplate[] {
  return createValidatorSigningTasks({
    validator: signing.validator,
    signerReferences: signing.signerReferences,
    taskPrefix,
    ecdsaInvocation: 'ecdsa-sign-message',
    webauthnInvocation: 'webauthn-sign-hash',
    role,
  }).map((task) => ({
    ...task,
    chain,
    payload: { source: 'plan-payload', payloadId },
  }))
}

function sessionOwnerSigning(
  session: ResolvedSessionSignerSet,
  account: Address,
) {
  const validator = defineValidator(
    session.session.owners,
    'smart-session-validator',
  )
  const owners = validatorOwners(validator)
  const capabilities = getValidatorCapabilities(
    validator,
    resolveValidator(validator),
    'smart-session-owner',
    'intent',
    false,
  )
  return {
    validator,
    ...signingTopology(validator),
    signerReferences: Object.fromEntries(
      owners.map((owner) => [
        owner.signerId,
        {
          id: owner.signerId,
          kind:
            owner.kind === 'webauthn'
              ? ('webauthn' as const)
              : ('ecdsa' as const),
        },
      ]),
    ),
    signerCodec: withWebauthnContext(
      requireSessionSignerCodec(capabilities.contributionCodec),
      validator.kind === 'passkey',
      account,
    ),
    ...(validator.kind === 'multi-factor'
      ? {
          validatorFactors: validator.validators.map((factor) => ({
            id: factor.id,
            publicId: factor.publicId,
            validator: resolveAtomicValidator(factor).address,
            codec: withWebauthnContext(
              requireAtomicSignerCodec(
                getValidatorCapabilities(
                  factor,
                  resolveAtomicValidator(factor),
                  'smart-session-owner',
                  'intent',
                  false,
                ).contributionCodec,
              ),
              factor.kind === 'passkey',
              account,
            ),
          })),
        }
      : {}),
  }
}

function sessionCodec(
  session: ResolvedSessionSignerSet,
  validator: `0x${string}`,
  signerCodec: SessionSignerCodec,
  mode: 'notarized' | 'pre-claim',
  typedData?: TypedDataDefinition,
) {
  return {
    kind: 'smart-session' as const,
    validator: { kind: 'validator' as const, address: validator },
    mode,
    permissionId: session.session.permissionId,
    signerCodec,
    ...(mode === 'notarized'
      ? { claimPolicyData: claimPolicyData(session, typedData) }
      : {}),
  }
}

function sessionPreClaimCodec(
  session: ResolvedSessionSignerSet,
  validator: `0x${string}`,
  signerCodec: SessionSignerCodec,
  factId: string,
) {
  const enabled = sessionCodec(session, validator, signerCodec, 'pre-claim')
  if (!session.enableData) return enabled
  return {
    kind: 'smart-session-state' as const,
    factId,
    whenEnabled: enabled,
    whenDisabled: {
      kind: 'smart-session' as const,
      validator: { kind: 'validator' as const, address: validator },
      mode: 'enable-and-use' as const,
      permissionId: session.session.permissionId,
      signerCodec,
      enableData: {
        ...session.enableData,
        session: getSessionData(session.session),
      },
    },
  }
}

type SessionSignerCodec = Exclude<
  ValidatorContributionCodec,
  { readonly kind: 'smart-session' }
>

function requireSessionSignerCodec(
  codec: ValidatorContributionCodec,
): SessionSignerCodec {
  if (codec.kind === 'smart-session') {
    throw new Error('A Smart Session owner cannot use a session validator')
  }
  return codec
}

function requireAtomicSignerCodec(
  codec: ValidatorContributionCodec,
): Extract<ValidatorContributionCodec, { readonly kind: 'ordered-threshold' }> {
  if (codec.kind !== 'ordered-threshold') {
    throw new Error('A Smart Session factor must use an atomic validator')
  }
  return codec
}

function validatorOwners(validator: ResolvedValidatorDefinition) {
  return validator.kind === 'multi-factor'
    ? validator.validators.flatMap(({ owners }) => owners)
    : validator.owners
}

function withWebauthnContext(
  codec: Extract<
    ValidatorContributionCodec,
    { readonly kind: 'ordered-threshold' }
  >,
  webauthn: boolean,
  account: Address,
): Extract<ValidatorContributionCodec, { readonly kind: 'ordered-threshold' }>
function withWebauthnContext(
  codec: SessionSignerCodec,
  webauthn: boolean,
  account: Address,
): SessionSignerCodec
function withWebauthnContext(
  codec: SessionSignerCodec,
  webauthn: boolean,
  account: Address,
): SessionSignerCodec {
  if (!webauthn || codec.kind !== 'ordered-threshold') return codec
  return {
    ...codec,
    webauthn: {
      account,
      usePrecompile: false,
      format: 'current',
    },
  }
}

function sessionAccountEnvelope(
  envelope: AccountSignatureEnvelope,
  validator: `0x${string}`,
): AccountSignatureEnvelope {
  if (envelope.kind === 'none') return envelope
  return envelope.kind === 'kernel'
    ? { ...envelope, validator, isRoot: false }
    : { ...envelope, validator }
}

function notarizedPayload(account: `0x${string}`, payload: Hex): Hex {
  return hashMessage({
    raw: encodePacked(
      ['bytes32', 'bytes32'],
      [pad(account, { size: 32 }), payload],
    ),
  })
}

function claimPolicyData(
  session: ResolvedSessionSignerSet,
  typedData: TypedDataDefinition | undefined,
): Hex | undefined {
  if (
    !typedData ||
    typedData.primaryType !== 'PermitBatchWitnessTransferFrom' ||
    session.session.claimPolicies.length === 0
  ) {
    return undefined
  }
  const message = typedData.message as unknown as Permit2ClaimMessage
  const policy = selectPermit2ClaimPolicyForMessage(
    session.session.claimPolicies,
    message,
  )
  return policy
    ? buildPermit2ClaimPolicyCalldata(
        resolvePermit2ClaimPolicy(policy),
        message,
      )
    : undefined
}

function requireSession<CompatibilityConfig>(
  prepared: PreparedIntent<CompatibilityConfig>,
  chainId: number,
): ResolvedSessionSignerSet {
  const session = prepared.resolvedSessions?.[chainId]
  if (!session)
    throw new Error(`Prepared session for chain ${chainId} is missing`)
  return session
}

function requireSessionEnvironment<CompatibilityConfig>(
  prepared: PreparedIntent<CompatibilityConfig>,
): 'production' | 'development' {
  if (!prepared.sessionEnvironment) {
    throw new Error('Prepared Smart Session environment is missing')
  }
  return prepared.sessionEnvironment
}
