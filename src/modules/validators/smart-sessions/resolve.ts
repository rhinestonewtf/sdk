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
  sessionWindowRefusal,
} from './one-time-use'
import {
  DEFAULT_POLICY_ADDRESSES,
  resolvePolicyAddresses,
  UNIVERSAL_ACTION_POLICY_ADDRESS,
  UNIVERSAL_ACTION_POLICY_COPIES,
  UNIVERSAL_ACTION_POLICY_COPY_CHAINS,
} from './policies/addresses'
import {
  expandCrossChainPermit,
  resolvePermit2ClaimPolicy,
} from './policies/claim'
import { encodeActionPolicies } from './policies/encode'
import {
  isSettlementScopedPermit,
  resolveSettlementScope,
} from './settlement/scope'
import type { SettlementCatalog } from './settlement/types'
import { resolveSessionSigning } from './signing'
import { swapperAddresses } from './swap/rhinestone'
import { resolveSwapScope } from './swap/scope'
import { assertStableFloorIsolated } from './swap/stable-floor'
import type {
  CrossChainPermit,
  IntentExecutorSettlementLayer,
  Permission,
  ResolvedAction,
  ResolvedERC7739Policies,
  ResolvedPolicy,
  ScopedAction,
  Session,
  SessionAccess,
  SessionAction,
  SessionData,
  SessionDefinition,
  SessionPolicyAddresses,
  SettlementCoverage,
} from './types'

export const SMART_SESSIONS_FALLBACK_TARGET_FLAG: Address =
  '0x0000000000000000000000000000000000000001'
export const SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG: Hex = '0x00000001'
export const SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG_PERMITTED_TO_CALL_SMARTSESSION =
  '0x00000002' as const
export const DUMMY_PRECLAIMOP_TARGET =
  '0x0000000000000000000000000000000000000420' as const
export const DUMMY_PRECLAIMOP_SELECTOR = '0x69123456' as const

function minDefined(a?: bigint, b?: bigint): bigint | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return a < b ? a : b
}

/**
 * Each validUntil the session's actions set, in seconds. A session's time window
 * is expressed as the one-time-use deadline, so a window without oneTimeUse, or
 * any validAfter, is refused.
 */
function sessionWindowDeadlines(definition: SessionDefinition): bigint[] {
  const deadlines: bigint[] = []
  const take = (field: string, validUntil: unknown, hasValidAfter: boolean) => {
    if (hasValidAfter || (validUntil !== undefined && !definition.oneTimeUse)) {
      throw new Error(sessionWindowRefusal(field))
    }
    if (validUntil === undefined) return
    // As for oneTimeUse.validUntil: 0 or less would read as "never expires".
    if (
      !(
        validUntil instanceof Date &&
        Number.isFinite(validUntil.getTime()) &&
        validUntil.getTime() > Date.now()
      )
    ) {
      throw new Error(`${field}: validUntil must be a valid Date in the future`)
    }
    deadlines.push(BigInt(Math.floor(validUntil.getTime() / 1000)))
  }
  for (const { address, functions } of definition.permissions ?? []) {
    for (const [name, config] of Object.entries(functions)) {
      if (config) {
        take(
          `permissions[${address}].${name}`,
          config.validUntil,
          config.validAfter !== undefined,
        )
      }
    }
  }
  for (const { target, selector, policies } of definition.actions ?? []) {
    for (const policy of policies ?? []) {
      if (policy.type === 'time-frame') {
        take(
          `actions[${target}:${selector}]`,
          typeof policy.validUntil === 'number'
            ? new Date(policy.validUntil)
            : policy.validUntil,
          policy.validAfter !== 0,
        )
      }
    }
  }
  // An IntentExecutor-layer permit's window is resolved with its scope.
  for (const [index, permit] of (
    definition.crossChainPermits ?? []
  ).entries()) {
    if (!isSettlementScopedPermit(permit)) {
      take(
        `crossChainPermits[${index}]`,
        permit.validUntil,
        permit.validAfter !== undefined,
      )
    }
  }
  return deadlines
}

/** The permission without its window, which the session carries as its deadline. */
function withoutWindow(permission: Permission): Permission {
  return {
    ...permission,
    functions: Object.fromEntries(
      Object.entries(permission.functions).map(([name, config]) => {
        if (!config) return [name, config]
        const { validUntil: _until, validAfter: _after, ...rest } = config
        return [name, rest]
      }),
    ),
  } as Permission
}

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
  // The orchestrator's `/chains` settlement addresses. IntentExecutor-layer
  // permits (other than SAME_CHAIN_IE) and `swap.stableFloor` need them;
  // `createSession` passes them.
  readonly settlement?: SettlementCatalog
}

export function resolveSessionData(
  definition: SessionDefinition,
  options: ResolveSessionOptions = {},
): SessionData {
  return resolveSession(definition, options).data
}

/** The session data and the IntentExecutor layers its actions were scoped to. */
function resolveSession(
  definition: SessionDefinition,
  options: ResolveSessionOptions,
): {
  readonly data: SessionData
  readonly settlementLayers: readonly IntentExecutorSettlementLayer[]
  readonly settlementCoverage: SettlementCoverage | undefined
  readonly access: SessionAccess
} {
  if (usesEns(definition.owners)) {
    throw new Error('ENS owners are not supported for smart sessions')
  }
  const environment = options.environment ?? 'production'
  const addresses = resolvePolicyAddresses(sessionPolicyAddresses(definition))
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
    ? resolveSwapScope(
        definition.swap,
        definition.chain.id,
        environment,
        options.settlement?.[definition.chain.id]?.usdStablecoins,
      )
    : undefined
  const windowDeadlines = sessionWindowDeadlines(definition)
  const stableFloor = definition.swap?.stableFloor !== undefined
  if (stableFloor && definition.swap) {
    assertStableFloorIsolated({
      sellToken: (definition.swap.sell.token ??
        definition.swap.sell.tokens?.[0]) as Address,
      swapper: swapperAddresses(environment).swapper,
      userTargets: [
        ...(definition.permissions ?? []).map((p) => p.address),
        ...(definition.actions ?? []).map((a) => a.target),
      ],
      signingMode: definition.signing?.mode,
      hasCrossChainGrants: Boolean(
        definition.crossChainPermits?.length ||
          definition.claimPolicies?.length,
      ),
    })
    if (definition.saltMode === 'v1') {
      throw new Error(
        "swap.stableFloor cannot use saltMode 'v1': it must not share a permissionId with an unfloored session",
      )
    }
  }
  // Declaring `swap` IS the restriction — a swap-scoped session that still
  // carried the wildcard fallback would let the session key call anything the
  // global intent-execution whitelist allows, which is the opposite of what the
  // caller asked for. `restrictToActions` stays as the explicit spelling for
  // sessions scoped by hand.
  const resolvedPermits = (definition.crossChainPermits ?? []).map((input) => {
    const until = input.validUntil
    // As for oneTimeUse.validUntil: 0 or less would read as "never expires",
    // and a past deadline only fails at enable, as an opaque signature error.
    if (
      until !== undefined &&
      isSettlementScopedPermit(input) &&
      !(Number.isFinite(until.getTime()) && until.getTime() > Date.now())
    ) {
      throw new Error(
        'crossChainPermits: an IntentExecutor-layer permit validUntil must be a valid Date in the future',
      )
    }
    return resolveCrossChainPermission(input)
  })
  // A permit naming an IntentExecutor layer compiles to argument-pinned scoped
  // actions, which only bind with the fallback gone — so it restricts too.
  const settlementScope = resolveSettlementScope(resolvedPermits, {
    chainId: definition.chain.id,
    environment,
    account: definition.account,
    oneTimeUse: Boolean(definition.oneTimeUse),
    ...(options.settlement ? { settlement: options.settlement } : {}),
  })
  // An ERC-1271 signing surface would let the key sign a Permit2 transfer that
  // none of the calldata pins ever see.
  if (
    settlementScope !== undefined &&
    definition.signing !== undefined &&
    definition.signing.mode !== 'disabled'
  ) {
    throw new Error(
      'crossChainPermits: an IntentExecutor-layer permit cannot enable `signing`',
    )
  }
  if (settlementScope !== undefined && definition.saltMode === 'v1') {
    throw new Error(
      "crossChainPermits: a settlement-scoped session cannot use saltMode 'v1': it must not share a permissionId with an unscoped session",
    )
  }
  const access = sessionAccess(
    definition,
    resolvedPermits,
    swapScope !== undefined,
    settlementScope?.settlementLayers,
  )
  const restricted = access.kind === 'scoped'
  const permissions = [
    ...(definition.permissions ?? []).map(withoutWindow),
    ...(swapScope?.permissions ?? []),
    ...(settlementScope?.permissions ?? []),
  ]
  const userActions = permissions.length ? resolvePermissions(permissions) : []
  // Raw scoped actions (target + selector + policies) for calls that can't be
  // addressed by the ABI-name `permissions` sugar — e.g. a fynd swap scoped by
  // its raw selector with no ABI (RHI-6286).
  // A time-frame policy is carried as the deadline; an action left with no
  // policy is sudo, as a permission with only a window is.
  const rawActions = [
    ...(definition.actions ?? []).map((action): ScopedAction => {
      if (!action.policies?.some((policy) => policy.type === 'time-frame')) {
        return action
      }
      const { policies, ...rest } = action
      const kept = policies.filter((policy) => policy.type !== 'time-frame')
      return kept.length ? { ...rest, policies: kept } : rest
    }),
    ...(swapScope?.actions ?? []),
    ...(settlementScope?.actions ?? []),
  ]
  // A restricted session drops the fallback action, which is also where a
  // cross-chain permit's spending-limit guardrails live — so a restricted
  // session combined with a permit would keep claim signing but lose maxAmount
  // enforcement. These are different authorization surfaces;
  // reject the combination rather than silently drop the guardrails.
  // A settlement-scoped permit carries its guardrails on its own actions, so it
  // is the one permit shape a restricted session can hold.
  if (
    restricted &&
    ((definition.crossChainPermits?.length && settlementScope === undefined) ||
      definition.claimPolicies?.length)
  ) {
    throw new Error(
      'restrictToActions is incompatible with crossChainPermits/claimPolicies: ' +
        'dropping the fallback also drops the permit guardrails (spending ' +
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
  if (
    definition.saltMode === 'v1' &&
    definition.policyAddresses?.universalActionCopies?.length
  ) {
    throw new Error(
      "universalActionCopies cannot use saltMode 'v1': a 1.x session has no split policies to reproduce",
    )
  }
  const validUntil = definition.oneTimeUse?.validUntil
  // A deadline that rounds to 0 would read as "never expires"; a past one only
  // fails at enable, as an opaque signature error.
  if (
    validUntil !== undefined &&
    !(
      Number.isFinite(validUntil.getTime()) && validUntil.getTime() > Date.now()
    )
  ) {
    throw new Error('oneTimeUse.validUntil must be a valid Date in the future')
  }
  // Every other validUntil on the session joins it as the session deadline.
  const onceDeadline = definition.oneTimeUse
    ? [settlementScope?.onceDeadline, ...windowDeadlines].reduce(
        minDefined,
        validUntil && BigInt(Math.floor(validUntil.getTime() / 1000)),
      )
    : undefined
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
  const permit2Permits = resolvedPermits.filter(
    (permit) => !isSettlementScopedPermit(permit),
  )
  // A Permit2-route maxAmount is enforced together with oneTimeUse.
  if (
    !definition.oneTimeUse &&
    permit2Permits.some((permit) =>
      permit.from?.some(({ maxAmount }) => maxAmount !== undefined),
    )
  ) {
    throw new Error(
      "crossChainPermits: a Permit2-route permit's maxAmount is enforced only with oneTimeUse; set oneTimeUse or drop maxAmount",
    )
  }
  const expandedPermits = permit2Permits.map((permit) =>
    expandCrossChainPermit(permit, environment, onceDeadline),
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
    // A one-time-use session enables with its burn, which replaces the dummy op.
    ...(definition.oneTimeUse
      ? []
      : [
          {
            target: DUMMY_PRECLAIMOP_TARGET,
            selector: DUMMY_PRECLAIMOP_SELECTOR,
            // The real pre-claim op carries no value, so cap it for a
            // restricted session rather than granting sudo, which would let
            // this injected action send native value to the dummy target.
            //
            // 1 wei, NOT 0: `ValueLimitPolicy.initializeWithMultiplexer`
            // does `require(valueLimit != 0)`, so a zero limit reverts while
            // the policy is being installed. That made every restricted
            // session impossible to enable — the revert surfaces as
            // `InvalidSignature()` from the emissary, which reads as a
            // signature problem rather than a policy-init one. 1 wei is the
            // smallest limit that installs, and the op carries no value.
            policies: restricted
              ? [{ type: 'value-limit', limit: 1n }]
              : [{ type: 'sudo' }],
          } satisfies ScopedAction,
        ]),
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
    // The session's own burn actions are added below; a user action on the policy
    // would share their action id.
    if (
      definition.oneTimeUse &&
      definition.policyAddresses?.oneTimeUseId &&
      a.target.toLowerCase() ===
        definition.policyAddresses.oneTimeUseId.toLowerCase()
    ) {
      throw new Error(
        'oneTimeUse sessions authorise their own burn; do not add an action on the policy',
      )
    }
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
    userActions.length || rawActions.length || expandedPermits.length
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
            actionPolicies: action.policies
              ? encodeActionPolicies(action.policies, environment, addresses)
              : [{ policy: addresses.sudo, initData: '0x' }],
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
  let onceErc1271Policy: { policy: Address; initData: Hex } | undefined
  if (definition.oneTimeUse) {
    if (!addresses.oneTimeUseId) {
      throw new Error(
        'oneTimeUse requires policyAddresses.oneTimeUseId (no canonical deployment yet)',
      )
    }
    const once = oneTimeUseIdErc1271Policy({
      policy: addresses.oneTimeUseId,
      id: definition.oneTimeUse.id,
      deadline: onceDeadline,
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
    onceErc1271Policy = once
  }
  // Permit2 verifies a contract owner through `isValidSignature`, so claim
  // policies only bind from the 1271 list; the on-chain `claimPolicies` field
  // feeds the Compact claim path, which the manager skips entirely under
  // NO_LOCKTAG. For a one-time-use session they must additionally sit on the
  // SAME surface as the once-policy (the 1271 list is an AND: it bounds WHAT may
  // settle, the once-policy bounds HOW MANY TIMES). A session declaring none
  // keeps the signing list it asked for: a lone once-policy there would approve a
  // Permit2 transfer nominated by an executor-route consumeFor, with no claim
  // policy bounding the spender.
  const claimPoliciesMoved = claimPolicies.length > 0
  if (claimPoliciesMoved) {
    // The claim policies take over the 1271 list, so anything the caller asked
    // for on that surface would be dropped: a validity window lives on the
    // signing policy, and a scoped or disabled mode decides the 7739 content the
    // claim policy is reached through. Refuse rather than silently discard it.
    if (definition.signing !== undefined) {
      throw new Error(
        `Claim policies take over the session's ERC-1271 list, so \`signing\` cannot also be configured — its policy and validity window would be dropped. Drop \`signing\` or the claim policies.`,
      )
    }
    // Replace rather than append. The list is an AND, so a permissive sudo entry
    // alongside cannot weaken it — but it would be dead config that reads as a
    // signing capability the session no longer has.
    erc1271Policies = onceErc1271Policy
      ? [...claimPolicies, onceErc1271Policy]
      : claimPolicies
    claimPolicies = []
  }
  // Same hazard on the ERC-1271 list: it is an AddressSet keyed by policy, and
  // the config is keyed per (policy, configId), so a repeat address stores once
  // and keeps only the last config. Every Permit2 claim policy resolves to the
  // same contract, so several declared permits land here.
  {
    const seen = new Set<string>()
    for (const { policy } of erc1271Policies) {
      const key = policy.toLowerCase()
      if (seen.has(key)) {
        throw new Error(
          `Session carries ERC-1271 policy ${policy} twice; the second config would overwrite the first on-chain, so only one of the declared restrictions would be enforced. Split them across sessions.`,
        )
      }
      seen.add(key)
    }
  }
  // Enabling keeps one config per policy contract and action, so a second
  // entry for the same policy would overwrite the first instead of ANDing.
  for (const action of actions) {
    const seen = new Set<string>()
    for (const { policy } of action.actionPolicies) {
      const key = policy.toLowerCase()
      if (seen.has(key)) {
        throw new Error(
          `Action (${action.actionTarget}, ${action.actionTargetSelector}) carries policy ${policy} twice; the second config would overwrite the first on-chain`,
        )
      }
      seen.add(key)
    }
  }
  const enabledErc7739Policies = { ...erc7739Policies, erc1271Policies }
  const data: SessionData = {
    sessionValidator: validator.address,
    sessionValidatorInitData: validator.initData,
    // A one-time-use, stable-floor, settlement-scoped or claim-policy session
    // must never share a permissionId with another session: enabling it would
    // union with that session's policies, and for a floor or a settlement scope
    // that means the unscoped actions.
    // A claim-policy session is never `restricted`, so without this it would
    // salt to zeroHash and collide with any plain session for the same signer,
    // leaving that session's signing policy beside the claim policy.
    salt: sessionSalt(
      definition.oneTimeUse ||
        stableFloor ||
        claimPoliciesMoved ||
        settlementScope !== undefined
        ? 'strict'
        : definition.saltMode,
      restricted || Boolean(definition.oneTimeUse) || claimPoliciesMoved,
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
  return {
    data,
    settlementLayers: settlementScope?.settlementLayers ?? [],
    settlementCoverage: settlementScope && {
      dropped: settlementScope.dropped,
    },
    access,
  }
}

/** Whether the session drops the intent-execution fallback, and what decided it. */
function sessionAccess(
  definition: SessionDefinition,
  permits: readonly CrossChainPermit[],
  swapScoped: boolean,
  settlementLayers: readonly IntentExecutorSettlementLayer[] | undefined,
): SessionAccess {
  const scopedBy = [
    ...(definition.restrictToActions === true ? ['restrictToActions'] : []),
    ...(swapScoped ? ['swap scope'] : []),
    ...(settlementLayers
      ? [`settlement-scoped permit (${settlementLayers.join(', ')})`]
      : []),
  ]
  if (scopedBy.length) return { kind: 'scoped', reason: scopedBy.join('; ') }
  if (permits.length) {
    const layers = [
      ...new Set(
        permits.flatMap(({ settlementLayers: named }) =>
          Array.isArray(named) ? named : [],
        ),
      ),
    ]
    return {
      kind: 'open',
      reason: `Permit2-route permit (${layers.length ? layers.join(', ') : 'any layer'}) keeps the intent-execution fallback`,
    }
  }
  if (definition.claimPolicies?.length) {
    return {
      kind: 'open',
      reason: 'claimPolicies keep the intent-execution fallback',
    }
  }
  return { kind: 'open', reason: 'no restriction set' }
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

/**
 * The definition's policy addresses, with the deployed UniversalActionPolicy
 * copies defaulted in for a settlement-scoped session on a chain that has them.
 */
export function sessionPolicyAddresses(
  definition: SessionDefinition,
): SessionPolicyAddresses | undefined {
  const overrides = definition.policyAddresses
  const universalAction = overrides?.universalAction
  if (
    overrides?.universalActionCopies !== undefined ||
    // A pinned ArgPolicy asks for the ArgPolicy encoding; splitting would move it.
    overrides?.argPolicy !== undefined ||
    // The copies hold the canonical code, so they cannot stand in for another.
    (universalAction !== undefined &&
      universalAction.toLowerCase() !==
        UNIVERSAL_ACTION_POLICY_ADDRESS.toLowerCase()) ||
    // resolve refuses it; this only spares createSession a code check first.
    definition.saltMode === 'v1' ||
    !UNIVERSAL_ACTION_POLICY_COPY_CHAINS.has(definition.chain.id) ||
    !definition.crossChainPermits?.some(isSettlementScopedPermit)
  ) {
    return overrides
  }
  return { ...overrides, universalActionCopies: UNIVERSAL_ACTION_POLICY_COPIES }
}

export function toSession(
  definition: SessionDefinition,
  options: ResolveSessionOptions = {},
): Session {
  const environment = options.environment ?? 'production'
  // One resolution: 'all' depends on the clock and the catalog, so a second
  // could keep a different set of layers than the session's actions.
  const { data, settlementLayers, settlementCoverage, access } = resolveSession(
    definition,
    {
      environment,
      ...(options.wrappedNativeToken
        ? { wrappedNativeToken: options.wrappedNativeToken }
        : {}),
      ...(options.settlement ? { settlement: options.settlement } : {}),
    },
  )
  const resolvedPermits = (definition.crossChainPermits ?? []).map(
    resolveCrossChainPermission,
  )
  const scopedPermits = resolvedPermits.filter(isSettlementScopedPermit)
  const expandedClaims = resolvedPermits
    .filter((permit) => !isSettlementScopedPermit(permit))
    .map((permit) => expandCrossChainPermit(permit, environment).claim)
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
        definition.swap ||
        scopedPermits.length,
    ),
    permissionId: getPermissionIdFromData(data),
    sessionValidator: data.sessionValidator,
    sessionValidatorInitData: data.sessionValidatorInitData,
    salt: data.salt,
    erc7739Policies: data.erc7739Policies,
    actions: data.actions,
    // Keep the raw claim policies on the high-level session for both routes: the
    // permit2 settlement signature builds their calldata from here (see
    // claimPolicyData in session-signing). They are enforced via the erc1271
    // surface (already in data.erc7739Policies); getSessionData leaves the
    // on-chain claim (lockTag) field empty, which the manager skips anyway.
    claimPolicies: [...(definition.claimPolicies ?? []), ...expandedClaims],
    ...(definition.swap ? { swap: definition.swap } : {}),
    ...(settlementLayers.length ? { settlementLayers } : {}),
    ...(settlementCoverage ? { settlementCoverage } : {}),
    access,
    ...(definition.oneTimeUse && {
      oneTimeUse: {
        id: definition.oneTimeUse.id,
        policy: resolvePolicyAddresses(definition.policyAddresses)
          .oneTimeUseId as Address,
      },
    }),
  }
}

export { DEFAULT_POLICY_ADDRESSES }
