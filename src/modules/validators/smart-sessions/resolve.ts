import { type Address, type Hex, toFunctionSelector, zeroHash } from 'viem'
import { type ChainCatalog, sharedChainCatalog } from '../../../chains/catalog'
import { getWrappedNativeTokenAddress } from '../../../chains/tokens'
import { defineValidator } from '../definition'
import { resolvePermissions } from '../permissions'
import {
  encodePermit2ClaimPolicyInitData,
  PERMIT2_CLAIM_POLICY_ADDRESS,
} from '../policies/claim/permit2'
import { resolveValidator } from '../resolve'
import { resolveCrossChainPermission } from './cross-chain-permits'
import { getPermissionIdFromData } from './digest'
import {
  DEFAULT_POLICY_ADDRESSES,
  resolvePolicyAddresses,
} from './policies/addresses'
import {
  expandCrossChainPermit,
  resolvePermit2ClaimPolicy,
} from './policies/claim'
import { encodeSessionPolicy } from './policies/encode'
import type {
  ResolvedAction,
  Session,
  SessionAction,
  SessionData,
  SessionDefinition,
} from './types'

export const SMART_SESSIONS_FALLBACK_TARGET_FLAG: Address =
  '0x0000000000000000000000000000000000000001'
export const SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG: Hex = '0x00000001'
export const SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG_PERMITTED_TO_CALL_SMARTSESSION =
  '0x00000002' as const
export const DUMMY_PRECLAIMOP_TARGET =
  '0x0000000000000000000000000000000000000420' as const
export const DUMMY_PRECLAIMOP_SELECTOR = '0x69123456' as const

function usesEns(definition: SessionDefinition['owners']): boolean {
  return (
    definition.type === 'ens' ||
    (definition.type === 'multi-factor' &&
      definition.validators.some((validator) => validator.type === 'ens'))
  )
}

export interface ResolveSessionOptions {
  readonly environment?: 'production' | 'development'
  readonly catalog?: ChainCatalog
}

export function resolveSessionData(
  definition: SessionDefinition,
  options: ResolveSessionOptions = {},
): SessionData {
  if (usesEns(definition.owners)) {
    throw new Error('ENS owners are not supported for smart sessions')
  }
  const environment = options.environment ?? 'production'
  const catalog = options.catalog ?? sharedChainCatalog
  const addresses = resolvePolicyAddresses(definition.policyAddresses)
  const validator = resolveValidator(
    defineValidator(definition.owners, 'session-validator'),
  )
  const sudoAction: ResolvedAction = {
    actionTargetSelector: SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
    actionTarget: SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    actionPolicies: [{ policy: addresses.sudo, initData: '0x' }],
  }
  const userActions = definition.permissions?.length
    ? resolvePermissions(definition.permissions)
    : []
  const expandedPermits = (definition.crossChainPermits ?? []).map((input) =>
    expandCrossChainPermit(
      resolveCrossChainPermission(input, catalog),
      environment,
    ),
  )
  const permitFallbackPolicies = expandedPermits.flatMap(
    ({ fallbackPolicies }) => fallbackPolicies,
  )
  const injectedActions: SessionAction[] = [
    {
      target: getWrappedNativeTokenAddress(catalog, definition.chain.id),
      selector: toFunctionSelector({
        type: 'function',
        name: 'deposit',
        inputs: [],
        outputs: [],
        stateMutability: 'payable',
      }),
    },
    {
      policies: [{ type: 'intent-execution' }, ...permitFallbackPolicies],
    },
    {
      target: DUMMY_PRECLAIMOP_TARGET,
      selector: DUMMY_PRECLAIMOP_SELECTOR,
      policies: [{ type: 'sudo' }],
    },
  ]
  const actions =
    userActions.length || permitFallbackPolicies.length
      ? [...userActions, ...injectedActions].map(
          (action): ResolvedAction => ({
            actionTargetSelector:
              'selector' in action
                ? action.selector
                : SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
            actionTarget:
              'target' in action
                ? action.target
                : SMART_SESSIONS_FALLBACK_TARGET_FLAG,
            actionPolicies: action.policies?.map((policy) =>
              encodeSessionPolicy(policy, environment, addresses),
            ) ?? [{ policy: addresses.sudo, initData: '0x' }],
          }),
        )
      : [sudoAction]
  const claimPolicies = [
    ...(definition.claimPolicies ?? []),
    ...expandedPermits.map(({ claim }) => claim),
  ].map((policy) => ({
    policy: PERMIT2_CLAIM_POLICY_ADDRESS,
    initData: encodePermit2ClaimPolicyInitData(
      resolvePermit2ClaimPolicy(policy),
    ),
  }))
  return {
    sessionValidator: validator.address,
    sessionValidatorInitData: validator.initData,
    salt: zeroHash,
    erc7739Policies: {
      allowedERC7739Content: [
        { contentNames: [''], appDomainSeparator: zeroHash },
      ],
      erc1271Policies: [{ policy: addresses.sudo, initData: '0x' }],
    },
    actions,
    claimPolicies,
  }
}

export function toSession(
  definition: SessionDefinition,
  options: ResolveSessionOptions = {},
): Session {
  const environment = options.environment ?? 'production'
  const catalog = options.catalog ?? sharedChainCatalog
  const data = resolveSessionData(definition, { environment, catalog })
  const expandedClaims = (definition.crossChainPermits ?? []).map(
    (input) =>
      expandCrossChainPermit(
        resolveCrossChainPermission(input, catalog),
        environment,
      ).claim,
  )
  return {
    chain: definition.chain,
    owners: definition.owners,
    hasExplicitPermissions: Boolean(definition.permissions?.length),
    permissionId: getPermissionIdFromData(data),
    sessionValidator: data.sessionValidator,
    sessionValidatorInitData: data.sessionValidatorInitData,
    salt: data.salt,
    erc7739Policies: data.erc7739Policies,
    actions: data.actions,
    claimPolicies: [...(definition.claimPolicies ?? []), ...expandedClaims],
  }
}

export { DEFAULT_POLICY_ADDRESSES }
