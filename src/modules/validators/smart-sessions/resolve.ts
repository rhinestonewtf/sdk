import {
  type Address,
  encodeAbiParameters,
  type Hex,
  keccak256,
  toFunctionSelector,
  zeroHash,
} from 'viem'
import { defineValidator } from '../definition'
import { compareHexValues } from '../ordering'
import { resolvePermissions } from '../permissions'
import {
  encodePermit2ClaimPolicyInitData,
  PERMIT2_CLAIM_POLICY_ADDRESS,
} from '../policies/claim/permit2'
import { resolveValidator } from '../resolve'
import { resolveCrossChainPermission } from './cross-chain-permits'
import { getPermissionIdFromData } from './digest'
import {
  CONSUME_FOR_SELECTOR,
  CONSUME_SELECTOR,
  oneTimeUseIdErc1271Policy,
} from './one-time-use'
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
import { resolveSwapScope } from './swap/scope'
import type {
  ResolvedAction,
  ResolvedERC7739Policies,
  ResolvedPolicy,
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
  // `swap` is sugar over permissions + actions: it compiles to one merged
  // approve plus one scoped swap action per venue, then rides the same
  // resolution path. Venue routers, selectors and calldata offsets stay inside
  // swap-venues.ts so they never reach the public surface (RHI-6286).
  const swapScope = definition.swap
    ? resolveSwapScope(definition.swap, definition.chain.id, environment)
    : undefined
  // Declaring `swap` IS the restriction — a swap-scoped session that still
  // carried the wildcard fallback would let the session key call anything the
  // global intent-execution whitelist allows, which is the opposite of what the
  // caller asked for. `restrictToActions` stays as the explicit spelling for
  // sessions scoped by hand.
  const restricted =
    definition.restrictToActions === true || swapScope !== undefined
  const permissions = [
    ...(definition.permissions ?? []),
    ...(swapScope?.permissions ?? []),
  ]
  const userActions = permissions.length ? resolvePermissions(permissions) : []
  // Raw scoped actions (target + selector + policies) for calls that can't be
  // addressed by the ABI-name `permissions` sugar — e.g. a fynd swap scoped by
  // its raw selector with no ABI (RHI-6286).
  const rawActions = [
    ...(definition.actions ?? []),
    ...(swapScope?.actions ?? []),
  ]
  // A restricted session drops the fallback action, which is also where a
  // cross-chain permit's spending-limit / time-frame guardrails live — so a
  // restricted session combined with a permit would keep claim signing but lose
  // maxAmount/deadline enforcement. These are different authorization surfaces;
  // reject the combination rather than silently drop the guardrails.
  if (
    restricted &&
    (definition.crossChainPermits?.length || definition.claimPolicies?.length)
  ) {
    throw new Error(
      'restrictToActions is incompatible with crossChainPermits/claimPolicies: ' +
        'dropping the fallback also drops the permit guardrails (spending/time ' +
        'limits). Use a restricted scoped-action session or a permit session, ' +
        'not both.',
    )
  }
  if (definition.oneTimeUse) {
    if (definition.saltMode === 'v1') {
      throw new Error(
        "oneTimeUse cannot use saltMode 'v1': a 1.x session has no once-policy to reproduce",
      )
    }
  }
  // Guard raw actions from reintroducing the wildcard: reject one without
  // target+selector (would map to the fallback flags), or one that targets the
  // fallback sentinel outright — either would re-add the wildcard action that
  // restrictToActions drops.
  for (const a of rawActions) {
    if (!('target' in a) || !('selector' in a)) {
      throw new Error(
        'definition.actions entries must be scoped (target + selector); a ' +
          'fallback-shaped action would map to the wildcard fallback target',
      )
    }
    if (
      a.target.toLowerCase() ===
      SMART_SESSIONS_FALLBACK_TARGET_FLAG.toLowerCase()
    ) {
      throw new Error(
        'definition.actions must not target the fallback sentinel ' +
          `(${SMART_SESSIONS_FALLBACK_TARGET_FLAG}) — it reintroduces the wildcard action`,
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
    ...(options.wrappedNativeToken && !restricted
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
    ...(restricted ? [] : [fallbackAction]),
    {
      target: DUMMY_PRECLAIMOP_TARGET,
      selector: DUMMY_PRECLAIMOP_SELECTOR,
      // The real pre-claim op carries no value, so cap it for a restricted
      // session rather than granting sudo, which would let this injected action
      // send native value to the dummy target.
      //
      // 1 wei, NOT 0: `ValueLimitPolicy.initializeWithMultiplexer` does
      // `require(valueLimit != 0)`, so a zero limit reverts while the policy is
      // being installed. That made every restricted session impossible to
      // enable — the revert surfaces as `InvalidSignature()` from the emissary,
      // which reads as a signature problem rather than a policy-init one.
      // 1 wei is the smallest limit that installs, and the op carries no value.
      policies: restricted
        ? [{ type: 'value-limit', limit: 1n }]
        : [{ type: 'sudo' }],
    },
  ]
  if (restricted && !userActions.length && !rawActions.length) {
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
  // Only the permission-derived actions: a raw action is passed through in the
  // order it was given, on both majors, so reordering one would invent a
  // difference rather than remove one.
  const v1CompatibleActions =
    definition.saltMode === 'v1'
      ? userActions.map((action) => ({
          ...action,
          policies: v1PolicyOrder(action.policies),
        }))
      : userActions
  let actions: ResolvedAction[] =
    userActions.length || rawActions.length || permitFallbackPolicies.length
      ? [...v1CompatibleActions, ...rawActions, ...injectedActions].map(
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
  // 1.x salts a swap-scoped session over its PRODUCTION venues even when built
  // for dev, so the salt — and the permissionId with it — does not move between
  // environments. Reproducing one means reproducing that, and the cheapest
  // faithful way is to resolve the same definition again at production and salt
  // over those actions. The session itself keeps its dev venues; only the salt
  // changes. Terminates: the recursive call resolves at production, where this
  // is skipped.
  const v1SaltActions =
    definition.saltMode === 'v1' &&
    environment === 'development' &&
    definition.swap !== undefined
      ? resolveSessionData(definition, {
          ...options,
          environment: 'production',
        }).actions
      : undefined
  const rawClaimPolicies = [
    ...(definition.claimPolicies ?? []),
    ...expandedPermits.map(({ claim }) => claim),
  ]
  // The pre-claim entrypoint is permissionless and names its caller as the
  // arbiter, so an unpinned arbiter lets the session key settle without burning.
  if (
    definition.oneTimeUse &&
    rawClaimPolicies.some((claim) => !claim.spenders?.length)
  ) {
    throw new Error(
      'oneTimeUse claim policies must pin their spenders (the Permit2 arbiter)',
    )
  }
  let claimPolicies: { policy: Address; initData: Hex }[] =
    rawClaimPolicies.map((policy) => ({
      policy: PERMIT2_CLAIM_POLICY_ADDRESS,
      initData: encodePermit2ClaimPolicyInitData(
        resolvePermit2ClaimPolicy(policy),
      ),
    }))
  // A restricted session must not leave an open ERC-1271 signing surface: with
  // signing defaulting to unrestricted, a session key limited to swap/approve
  // could still sign e.g. a Permit2 approval off-chain and move funds. Default it
  // to `disabled` when restricting; the caller can still opt into a signing policy.
  // Without claim policies a one-time-use session settles through its actions
  // alone, and any 1271 signing surface would let its key settle through Permit2
  // unbounded by the id.
  const executorOnlyOneTimeUse =
    Boolean(definition.oneTimeUse) && claimPolicies.length === 0
  if (
    executorOnlyOneTimeUse &&
    definition.signing &&
    definition.signing.mode !== 'disabled'
  ) {
    throw new Error(
      'oneTimeUse without claim policies cannot sign; leave `signing` unset',
    )
  }
  const erc7739Policies = resolveSessionSigning({
    signing:
      definition.signing ??
      (restricted || executorOnlyOneTimeUse ? { mode: 'disabled' } : undefined),
    environment,
    addresses,
  })
  let erc1271Policies = erc7739Policies.erc1271Policies
  if (definition.oneTimeUse) {
    if (!addresses.oneTimeUseId) {
      throw new Error(
        'oneTimeUse requires policyAddresses.oneTimeUseId (no canonical deployment yet)',
      )
    }
    const validUntil = definition.oneTimeUse.validUntil
    // A deadline that rounds to 0 would read as "never expires"; a past one only
    // fails at enable, as an opaque signature error.
    if (
      validUntil !== undefined &&
      !(
        Number.isFinite(validUntil.getTime()) &&
        validUntil.getTime() > Date.now()
      )
    ) {
      throw new Error(
        'oneTimeUse.validUntil must be a valid Date in the future',
      )
    }
    const once = oneTimeUseIdErc1271Policy({
      policy: addresses.oneTimeUseId,
      id: definition.oneTimeUse.id,
      deadline: validUntil && BigInt(Math.floor(validUntil.getTime() / 1000)),
    })
    // Install the once-policy on EVERY action: on the executor route the contract's
    // on-chain guard (a `consume` may only name the session's own id) runs via
    // checkAction, once per execution, so a settler can't dodge it by composing the
    // batch out of some other permitted action. checkAction only fires in
    // verify-execution mode, which prepareIntentSessions forces for one-time-use
    // sessions (see there).
    actions = [
      ...actions.map((action) => ({
        ...action,
        actionPolicies: [...action.actionPolicies, once],
      })),
      // The burn itself, so every session shape can settle: checkAction pins it to
      // this session's own id and requires it before any other execution.
      ...[CONSUME_SELECTOR, CONSUME_FOR_SELECTOR].map(
        (actionTargetSelector) => ({
          actionTarget: addresses.oneTimeUseId as Address,
          actionTargetSelector,
          actionPolicies: [once],
        }),
      ),
    ]
    // The Permit2/arbiter route enforces via the 1271 list. The once-policy's
    // settling proof only binds when the digest-binding Permit2 claim policy sits
    // on the SAME surface (the 1271 list is an AND: it bounds WHAT may settle, the
    // once-policy bounds HOW MANY TIMES), so the claim policies move here from
    // `claimPolicies`. An executor-only session keeps the signing list it asked
    // for: a lone once-policy there would approve a Permit2 transfer nominated by
    // an executor-route consumeFor, with no claim policy bounding the spender.
    if (claimPolicies.length > 0) {
      const signing = definition.signing
      if (
        signing !== undefined &&
        signing.mode !== 'disabled' &&
        (signing.validAfter !== undefined || signing.validUntil !== undefined)
      ) {
        throw new Error(
          'oneTimeUse with claim policies cannot take a signing validity window',
        )
      }
      // Replace rather than append: leaving the permissive sudo entry on the 1271
      // list would let the arbiter route fall through to it, so the once-policy
      // would never bound the settlement.
      erc1271Policies = [...claimPolicies, once]
      claimPolicies = []
    }
  }
  const enabledErc7739Policies = { ...erc7739Policies, erc1271Policies }
  return {
    sessionValidator: validator.address,
    sessionValidatorInitData: validator.initData,
    // A one-time-use session must never share a permissionId with another
    // session: enabling it would union with that session's policies.
    salt: sessionSalt(
      definition.oneTimeUse ? 'strict' : definition.saltMode,
      restricted || Boolean(definition.oneTimeUse),
      {
        actions: v1SaltActions ?? actions,
        erc7739Policies: enabledErc7739Policies,
        claimPolicies,
      },
    ),
    erc7739Policies: enabledErc7739Policies,
    actions,
    claimPolicies,
  }
}

const POLICY_COMPONENTS = [
  { name: 'policy', type: 'address' },
  { name: 'initData', type: 'bytes' },
] as const

/**
 * Pick the salt for a session, defaulting to the historical `zeroHash`.
 *
 * Unsalted sessions are always `zeroHash`: an unrestricted session has only one
 * shape, so two for the same signer are the same session and sharing a
 * permissionId is correct. Restricted and one-time-use ones can differ, which is
 * what makes a salt necessary.
 */
function sessionSalt(
  mode: 'none' | 'v1' | 'strict' | undefined,
  salted: boolean,
  session: {
    actions: readonly ResolvedAction[]
    erc7739Policies: ResolvedERC7739Policies
    claimPolicies: readonly ResolvedPolicy[]
  },
): Hex {
  if (!salted || mode === undefined || mode === 'none') {
    return zeroHash
  }
  return mode === 'v1'
    ? v1RestrictedSalt(session.actions)
    : strictSessionSalt(session)
}

/**
 * The order 1.x puts an action's policies in.
 *
 * 1.x builds an approve action as `[arg policy, spending limits]`; here the
 * `spendingLimit` sugar expands before `params` compiles, so the pair comes
 * out reversed. Policies are hashed in their array order, so a 1.x session
 * only reproduces here if the order does too — the digests agree without a cap
 * and diverge with one, which is what makes this worth doing rather than
 * documenting.
 *
 * Stable in the sense that matters: the params policy moves to the front and
 * everything else keeps its order relative to the rest, though its index
 * shifts.
 */
const PARAMS_POLICY_TYPES = new Set(['arg-policy', 'universal-action'])

function v1PolicyOrder<T extends { readonly type: string }>(
  policies: readonly T[] | undefined,
): readonly T[] | undefined {
  if (!policies) return policies
  const fromParams = policies.filter((policy) =>
    PARAMS_POLICY_TYPES.has(policy.type),
  )
  if (fromParams.length === 0 || fromParams.length === policies.length) {
    return policies
  }
  return [
    ...fromParams,
    ...policies.filter((policy) => !PARAMS_POLICY_TYPES.has(policy.type)),
  ]
}

/**
 * The 1.x derivation: the actions alone, in the order they were built.
 *
 * Reproduced rather than improved. It exists so a session built on 1.x can be
 * rebuilt here byte for byte — sorting or widening it would defeat that.
 */
function v1RestrictedSalt(actions: readonly ResolvedAction[]): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {
          name: 'actions',
          type: 'tuple[]',
          components: [
            { name: 'actionTargetSelector', type: 'bytes4' },
            { name: 'actionTarget', type: 'address' },
            {
              name: 'actionPolicies',
              type: 'tuple[]',
              components: POLICY_COMPONENTS,
            },
          ],
        },
      ],
      [
        actions.map((action) => ({
          actionTargetSelector: action.actionTargetSelector,
          actionTarget: action.actionTarget,
          actionPolicies: action.actionPolicies.map((policy) => ({
            ...policy,
          })),
        })),
      ],
    ),
  )
}

/**
 * Bind a restricted session's permissionId to everything it authorises.
 *
 * The permissionId derives from the validator, its init data and this salt —
 * not from the permissions. With a constant salt every session for the same
 * signer shares one permissionId, and `enable` on-chain ADDS to each list
 * rather than replacing it (`ConfigLibV2.enable`). So enabling a restricted
 * session beside an existing one for that signer unions the two: the earlier
 * session's permissions stay authorised and the restriction silently buys
 * nothing.
 *
 * Every field `_enablePolicies` writes under the permissionId has to be in
 * here, or that field alone can still collide — actions, the ERC-1271 policies
 * and 7739 content behind them, and the claim policies.
 *
 * Actions are sorted by (target, selector) so the salt is a function of the
 * authorised SET: on-chain they are keyed by action id, so listing the same
 * ones in a different order is the same authorisation and must not change the
 * permissionId.
 *
 * Unrestricted sessions other than one-time-use ones keep `zeroHash`, which is
 * what their stored signatures already cover.
 */
function strictSessionSalt(session: {
  actions: readonly ResolvedAction[]
  erc7739Policies: ResolvedERC7739Policies
  claimPolicies: readonly ResolvedPolicy[]
}): Hex {
  const actions = [...session.actions]
    // By value, never host collation: `localeCompare` orders `0xaa…` after
    // `0xb1…` on Danish-family locales, which would make the salt — and so the
    // permissionId — depend on where it was derived.
    .sort(
      (a, b) =>
        compareHexValues(a.actionTarget, b.actionTarget) ||
        compareHexValues(a.actionTargetSelector, b.actionTargetSelector),
    )
    .map((action) => ({
      actionTargetSelector: action.actionTargetSelector,
      actionTarget: action.actionTarget,
      actionPolicies: action.actionPolicies.map((policy) => ({ ...policy })),
    }))

  return keccak256(
    encodeAbiParameters(
      [
        {
          name: 'actions',
          type: 'tuple[]',
          components: [
            { name: 'actionTargetSelector', type: 'bytes4' },
            { name: 'actionTarget', type: 'address' },
            {
              name: 'actionPolicies',
              type: 'tuple[]',
              components: POLICY_COMPONENTS,
            },
          ],
        },
        {
          name: 'erc1271Policies',
          type: 'tuple[]',
          components: POLICY_COMPONENTS,
        },
        {
          name: 'allowedERC7739Content',
          type: 'tuple[]',
          components: [
            { name: 'appDomainSeparator', type: 'bytes32' },
            { name: 'contentNames', type: 'string[]' },
          ],
        },
        {
          name: 'claimPolicies',
          type: 'tuple[]',
          components: POLICY_COMPONENTS,
        },
      ],
      [
        actions,
        session.erc7739Policies.erc1271Policies.map((policy) => ({
          ...policy,
        })),
        session.erc7739Policies.allowedERC7739Content.map((content) => ({
          appDomainSeparator: content.appDomainSeparator,
          contentNames: [...content.contentNames],
        })),
        session.claimPolicies.map((policy) => ({ ...policy })),
      ],
    ),
  )
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
    // Drives `verifyExecutions`, which selects the signature mode: false lets an
    // already-enabled session sign in pure ERC-1271 mode, and that mode never
    // reaches the emissary's `verifyExecution` — so the action policies are
    // never consulted. `swap` compiles to actions, so it MUST count here, or a
    // swap-only session would silently stop being action-checked the moment it
    // is enabled.
    hasExplicitPermissions: Boolean(
      definition.permissions?.length ||
        definition.actions?.length ||
        definition.swap,
    ),
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
    ...(definition.swap ? { swap: definition.swap } : {}),
    ...(definition.oneTimeUse && {
      claimPoliciesEnforcedVia1271:
        (definition.claimPolicies?.length ?? 0) + expandedClaims.length > 0,
      oneTimeUse: {
        id: definition.oneTimeUse.id,
        policy: resolvePolicyAddresses(definition.policyAddresses)
          .oneTimeUseId as Address,
      },
    }),
  }
}

export { DEFAULT_POLICY_ADDRESSES }
