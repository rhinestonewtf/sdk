import { type Address, type Hex, toFunctionSelector, zeroHash } from 'viem'
import { defineValidator } from '../definition'
import { resolvePermissions } from '../permissions'
import {
  encodePermit2ClaimPolicyInitData,
  PERMIT2_CLAIM_POLICY_ADDRESS,
} from '../policies/claim/permit2'
import { resolveValidator } from '../resolve'
import { resolveCrossChainPermission } from './cross-chain-permits'
import { getPermissionIdFromData } from './digest'
import { oneTimeUseIdErc1271Policy } from './one-time-use'
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
  // The chain's wrapped-native token address. Provide it to permit the
  // native-wrap `deposit()` action; omit for a fully offline, pure build.
  readonly wrappedNativeToken?: Address
}

export function resolveSessionData(
  definition: SessionDefinition,
  options: ResolveSessionOptions = {},
): SessionData {
  if (usesEns(definition.owners)) {
    throw new Error('ENS owners are not supported for smart sessions')
  }
  const environment = options.environment ?? 'production'
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
    expandCrossChainPermit(resolveCrossChainPermission(input), environment),
  )
  const permitFallbackPolicies = expandedPermits.flatMap(
    ({ fallbackPolicies }) => fallbackPolicies,
  )
  const injectedActions: SessionAction[] = [
    // Native-wrap `deposit()` is only permitted when the caller supplies the
    // chain's wrapped-native token (e.g. via `RhinestoneSDK.createSession`,
    // which resolves it from `/chains`).
    ...(options.wrappedNativeToken
      ? [
          {
            target: options.wrappedNativeToken,
            selector: toFunctionSelector({
              type: 'function',
              name: 'deposit',
              inputs: [],
              outputs: [],
              stateMutability: 'payable',
            }),
          },
        ]
      : []),
    {
      policies: [{ type: 'intent-execution' }, ...permitFallbackPolicies],
    },
    {
      target: DUMMY_PRECLAIMOP_TARGET,
      selector: DUMMY_PRECLAIMOP_SELECTOR,
      policies: [{ type: 'sudo' }],
    },
  ]
  let actions: ResolvedAction[] =
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
  let claimPolicies: { policy: Address; initData: Hex }[] = [
    ...(definition.claimPolicies ?? []),
    ...expandedPermits.map(({ claim }) => claim),
  ].map((policy) => ({
    policy: PERMIT2_CLAIM_POLICY_ADDRESS,
    initData: encodePermit2ClaimPolicyInitData(
      resolvePermit2ClaimPolicy(policy),
    ),
  }))
  // Extra pre-encoded 1271 policies (e.g. an IntentExecutor settlement-layer
  // policy). They are enforcing, so they replace the default sudo entry to keep
  // the 1271 list a strict AND rather than letting sudo pass everything. A
  // route-gating 1271 policy (settlement-layer) and Permit2 claim policies gate
  // different routes on this shared AND-list, so the caller must not combine them
  // (defineSpendSession guards this); doing so yields a session that cannot
  // settle rather than a bypass.
  const extraErc1271 = definition.erc1271Policies ?? []
  let erc1271Policies: { policy: Address; initData: Hex }[] =
    extraErc1271.length
      ? [...extraErc1271]
      : [{ policy: addresses.sudo, initData: '0x' }]
  if (definition.oneTimeUse) {
    if (!addresses.oneTimeUseId) {
      throw new Error(
        'oneTimeUse requires policyAddresses.oneTimeUseId (no canonical deployment yet)',
      )
    }
    const once = oneTimeUseIdErc1271Policy({
      policy: addresses.oneTimeUseId,
      id: definition.oneTimeUse.id,
    })
    // Install the once-policy on EVERY action: on the executor route the contract's
    // on-chain guard (a `consume` may only name the session's own id) runs via
    // checkAction, once per execution, so a settler can't dodge it by composing the
    // batch out of some other permitted action. checkAction only fires in
    // verify-execution mode, which prepareIntentSessions forces for one-time-use
    // sessions (see there). Replay of a burned id is additionally blocked on the
    // 1271 surface below, which is consulted in every mode.
    actions = actions.map((action) => ({
      ...action,
      actionPolicies: [...action.actionPolicies, once],
    }))
    // The Permit2/arbiter route enforces via the 1271 list. The once-policy's
    // settling proof only binds when the digest-binding Permit2 claim policy sits
    // on the SAME surface (the 1271 list is an AND: it bounds WHAT may settle, the
    // once-policy bounds HOW MANY TIMES), so the claim policies move here from
    // `claimPolicies`. A permit2 one-time-use session must therefore supply a claim
    // policy; an executor-only session may have none.
    erc1271Policies = [...claimPolicies, ...extraErc1271, once]
    claimPolicies = []
  }
  return {
    sessionValidator: validator.address,
    sessionValidatorInitData: validator.initData,
    salt: zeroHash,
    erc7739Policies: {
      allowedERC7739Content: [
        { contentNames: [''], appDomainSeparator: zeroHash },
      ],
      erc1271Policies,
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
  const data = resolveSessionData(definition, {
    environment,
    ...(options.wrappedNativeToken
      ? { wrappedNativeToken: options.wrappedNativeToken }
      : {}),
  })
  const expandedClaims = (definition.crossChainPermits ?? []).map(
    (input) =>
      expandCrossChainPermit(resolveCrossChainPermission(input), environment)
        .claim,
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
    // Keep the raw claim policies on the high-level session for both routes: the
    // permit2 settlement signature builds their calldata from here (see
    // claimPolicyData in session-signing). For a one-time-use session they are
    // enforced via the erc1271 surface (already in data.erc7739Policies), so the
    // flag tells getSessionData NOT to re-encode them onto the on-chain claim
    // (lockTag) surface — otherwise they'd settle on both surfaces.
    claimPolicies: [...(definition.claimPolicies ?? []), ...expandedClaims],
    claimPoliciesEnforcedVia1271: Boolean(definition.oneTimeUse),
    oneTimeUse: Boolean(definition.oneTimeUse),
  }
}

export { DEFAULT_POLICY_ADDRESSES }
