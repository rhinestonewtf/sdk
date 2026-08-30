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
import {
  DEFAULT_POLICY_ADDRESSES,
  resolvePolicyAddresses,
} from './policies/addresses'
import {
  expandCrossChainPermit,
  resolvePermit2ClaimPolicy,
} from './policies/claim'
import { encodeSessionPolicy } from './policies/encode'
import { resolveSessionSigning } from './signing'
import type {
  ResolvedAction,
  ScopedAction,
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
  // Raw scoped actions (target + selector + policies) for calls that can't be
  // addressed by the ABI-name `permissions` sugar — e.g. a fynd swap scoped by
  // its raw selector with no ABI (RHI-6286).
  const rawActions = definition.actions ?? []
  // A restricted session drops the fallback action, which is also where a
  // cross-chain permit's spending-limit / time-frame guardrails live — so a
  // restricted session combined with a permit would keep claim signing but lose
  // maxAmount/deadline enforcement. These are different authorization surfaces;
  // reject the combination rather than silently drop the guardrails.
  if (
    definition.restrictToActions &&
    (definition.crossChainPermits?.length || definition.claimPolicies?.length)
  ) {
    throw new Error(
      'restrictToActions is incompatible with crossChainPermits/claimPolicies: ' +
        'dropping the fallback also drops the permit guardrails (spending/time ' +
        'limits). Use a restricted scoped-action session or a permit session, ' +
        'not both.',
    )
  }
  // Guard against a cast: a raw action without target+selector would map back to
  // the wildcard fallback target — never allow that (it would defeat scoping).
  for (const a of rawActions) {
    if (!('target' in a) || !('selector' in a)) {
      throw new Error(
        'definition.actions entries must be scoped (target + selector); a ' +
          'fallback-shaped action would map to the wildcard fallback target',
      )
    }
  }
  const expandedPermits = (definition.crossChainPermits ?? []).map((input) =>
    expandCrossChainPermit(resolveCrossChainPermission(input), environment),
  )
  const permitFallbackPolicies = expandedPermits.flatMap(
    ({ fallbackPolicies }) => fallbackPolicies,
  )
  // The wildcard intent-execution fallback. Dropped for a restricted session so
  // the explicit permissions are the ONLY authorized ops — a non-listed selector
  // then reverts instead of escaping via the global intent-execution target
  // whitelist (RHI-6286).
  const fallbackAction: SessionAction = {
    policies: [{ type: 'intent-execution' }, ...permitFallbackPolicies],
  }
  const injectedActions: SessionAction[] = [
    // Native-wrap `deposit()` is only permitted when the caller supplies the
    // chain's wrapped-native token (e.g. via `RhinestoneSDK.createSession`,
    // which resolves it from `/chains`). Dropped for a restricted session so it
    // can't add an unrequested sudo action beyond the caller's permissions.
    ...(options.wrappedNativeToken && !definition.restrictToActions
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
    ...(definition.restrictToActions ? [] : [fallbackAction]),
    {
      target: DUMMY_PRECLAIMOP_TARGET,
      selector: DUMMY_PRECLAIMOP_SELECTOR,
      // The real pre-claim op carries no value; cap it at 0 for a restricted
      // session so this injected action can't be used to send native value to
      // the dummy target (a plain sudo would allow it).
      policies: definition.restrictToActions
        ? [{ type: 'value-limit', limit: 0n }]
        : [{ type: 'sudo' }],
    },
  ]
  if (
    definition.restrictToActions &&
    !userActions.length &&
    !rawActions.length
  ) {
    throw new Error(
      'restrictToActions drops the fallback, so the session must supply at ' +
        'least one permission or action — none were given',
    )
  }
  // Raw actions bypass resolvePermissions' duplicate guard, so a raw action that
  // collides with an ABI permission (or another raw action) on the same
  // (target, selector) would map to the same on-chain action id and silently
  // overwrite policy config — reject it instead.
  const scoped = [...userActions, ...rawActions].filter(
    (a): a is ScopedAction => 'target' in a && 'selector' in a,
  )
  const seen = new Set<string>()
  for (const a of scoped) {
    const key = `${a.target.toLowerCase()}:${a.selector.toLowerCase()}`
    if (seen.has(key)) {
      throw new Error(
        `Duplicate scoped action for (${a.target}, ${a.selector}) — permissions ` +
          'and actions share one on-chain action id; merge them into a single entry',
      )
    }
    seen.add(key)
  }
  const actions =
    userActions.length || rawActions.length || permitFallbackPolicies.length
      ? [...userActions, ...rawActions, ...injectedActions].map(
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
  const erc7739Policies = resolveSessionSigning({
    signing: definition.signing,
    environment,
    addresses,
  })
  return {
    sessionValidator: validator.address,
    sessionValidatorInitData: validator.initData,
    salt: zeroHash,
    erc7739Policies,
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
    hasExplicitPermissions: Boolean(
      definition.permissions?.length || definition.actions?.length,
    ),
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
