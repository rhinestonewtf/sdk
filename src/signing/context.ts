import type { Hex } from 'viem'
import type { AccountAdapter, AccountRuntime } from '../accounts/adapter'
import type { AccountCapabilities, AccountIdentity } from '../accounts/types'
import { getValidatorCapabilities } from '../modules/validators/capabilities'
import { resolveValidator } from '../modules/validators/resolve'
import { ecdsaSignerId } from '../modules/validators/signer-id'
import type {
  ResolvedValidatorDefinition,
  ValidatorCapabilities,
  ValidatorContributionCodec,
  ValidatorSigningPurpose,
} from '../modules/validators/types'
import { signingTopology } from './plan'
import type {
  ArtifactAssemblyPlan,
  EffectiveSignerSelection,
  OwnerSignerSelection,
  SignerInvocationPort,
  SignerReference,
} from './types'

export interface SigningContext {
  readonly account: AccountIdentity
  readonly accountAdapter: AccountAdapter
  readonly accountCapabilities: AccountCapabilities
  readonly validator: ResolvedValidatorDefinition
  readonly validatorCapabilities: ValidatorCapabilities
  readonly effectiveSigners: EffectiveSignerSelection
  readonly signerReferences: Readonly<Record<string, SignerReference>>
  readonly signerInvoker: SignerInvocationPort
}

const zeroAddress = '0x0000000000000000000000000000000000000000' as const

export function createAccountSigningContext(input: {
  readonly runtime: AccountRuntime
  readonly purpose: ValidatorSigningPurpose
  readonly signerInvoker: SignerInvocationPort
  readonly selection?: OwnerSignerSelection
}): SigningContext {
  const validator =
    input.selection?.validator ??
    input.runtime.construction.owner ??
    eoaValidator(input.runtime)
  const module =
    input.selection?.validator === undefined &&
    input.runtime.construction.owner === undefined
      ? {
          kind: 'validator' as const,
          address: zeroAddress,
          initData: '0x' as Hex,
          deInitData: '0x' as Hex,
          additionalContext: '0x' as Hex,
        }
      : resolveValidator(validator)
  const signerReferences = Object.fromEntries(
    validatorOwners(validator).map((owner) => [
      owner.signerId,
      {
        id: owner.signerId,
        kind:
          owner.kind === 'webauthn'
            ? ('webauthn' as const)
            : ('ecdsa' as const),
      },
    ]),
  )
  const topology =
    input.selection?.validator === undefined &&
    input.runtime.construction.owner === undefined
      ? {
          configuredTopology: {
            rootValidatorId: 'eoa',
            validators: [],
            threshold: 1,
          },
          effectiveSelection: {
            validatorIds: [],
            signerIds: Object.keys(signerReferences),
            threshold: 1,
          },
        }
      : signingTopology(validator, input.selection?.signerIds)
  return {
    account: input.runtime.identity,
    accountAdapter: input.runtime.adapter,
    accountCapabilities: input.runtime.adapter.capabilities,
    validator,
    validatorCapabilities: getValidatorCapabilities(
      validator,
      module,
      input.runtime.construction.account.kind,
      input.purpose,
      input.runtime.adapter.capabilities.supportsOriginSignatureReuse,
    ),
    effectiveSigners: topology.effectiveSelection,
    signerReferences,
    signerInvoker: input.signerInvoker,
  }
}

export function getSigningValidatorCodec(
  context: SigningContext,
  payloadKind?: 'message' | 'typed-data',
): ValidatorContributionCodec {
  const codec = context.validatorCapabilities.contributionCodec
  const normalizedCodec =
    payloadKind === 'typed-data' && codec.kind === 'ordered-threshold'
      ? { ...codec, recoveryEncoding: 'ethereum' as const }
      : codec
  if (
    context.validator.kind !== 'passkey' ||
    normalizedCodec.kind !== 'ordered-threshold'
  ) {
    return normalizedCodec
  }
  return {
    ...normalizedCodec,
    webauthn: {
      account: context.account.address,
      usePrecompile: false,
      format: 'current',
    },
  }
}

export function getSigningValidatorFactors(
  context: SigningContext,
  payloadKind?: 'message' | 'typed-data',
): NonNullable<ArtifactAssemblyPlan['validatorFactors']> {
  if (context.validator.kind !== 'multi-factor') return []
  return context.validator.validators.map((factor) => {
    const module = resolveValidator(factor)
    const codec = getValidatorCapabilities(
      factor,
      module,
      context.account.definition.kind,
      context.validatorCapabilities.compatibilityKey.purpose,
      context.accountCapabilities.supportsOriginSignatureReuse,
    ).contributionCodec
    const normalizedCodec =
      payloadKind === 'typed-data' && codec.kind === 'ordered-threshold'
        ? { ...codec, recoveryEncoding: 'ethereum' as const }
        : codec
    if (normalizedCodec.kind !== 'ordered-threshold') {
      throw new Error(`Multi-factor validator ${factor.id} is not atomic`)
    }
    return {
      id: factor.id,
      publicId: factor.publicId,
      validator: module.address,
      codec:
        factor.kind === 'passkey'
          ? {
              ...normalizedCodec,
              webauthn: {
                account: context.account.address,
                usePrecompile: false,
                format: 'current' as const,
              },
            }
          : normalizedCodec,
    }
  })
}

export function getAccountSignatureRoute(
  runtime: AccountRuntime,
  context: SigningContext,
  erc7739: ArtifactAssemblyPlan['erc7739'] = { kind: 'none' },
  payloadKind: 'message' | 'typed-data' = 'message',
): Omit<ArtifactAssemblyPlan, 'id' | 'stageId' | 'input' | 'usage'> {
  const deployment = runtime.adapter.getDeploymentPlan(runtime.construction)
  let erc6492: ArtifactAssemblyPlan['erc6492'] = { kind: 'none' }
  if (!deployment.deployed) {
    if (!deployment.factory || !deployment.factoryData) {
      throw new Error('Account factory arguments are unavailable')
    }
    erc6492 = {
      kind: 'wrap-deployless',
      factory: deployment.factory,
      factoryData: deployment.factoryData,
    }
  }
  return {
    validatorCodec: getSigningValidatorCodec(context, payloadKind),
    ...(context.validator.kind === 'multi-factor'
      ? { validatorFactors: getSigningValidatorFactors(context, payloadKind) }
      : {}),
    erc7739,
    accountEnvelope: context.accountCapabilities.signatureEnvelope,
    erc6492,
  }
}

function eoaValidator(runtime: AccountRuntime): ResolvedValidatorDefinition {
  const account = runtime.construction.eoa
  if (!account) throw new Error('EOA account signer is missing')
  return {
    kind: 'ecdsa',
    id: 'eoa',
    publicId: 0,
    module: { source: 'explicit', address: zeroAddress },
    owners: [
      {
        kind: 'ecdsa',
        id: 'eoa/owner/0',
        signerId: ecdsaSignerId(account),
        account,
      },
    ],
    threshold: 1,
  }
}

function validatorOwners(validator: ResolvedValidatorDefinition) {
  return validator.kind === 'multi-factor'
    ? validator.validators.flatMap(({ owners }) => owners)
    : validator.owners
}
