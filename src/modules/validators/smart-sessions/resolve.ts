import {
  type Address,
  encodeAbiParameters,
  type Hex,
  isAddressEqual,
  keccak256,
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
  defaultPermit2SenderPolicy,
  oneTimeUseIdPolicyMissing,
  resolvePolicyAddresses,
  UNIVERSAL_ACTION_POLICY_ADDRESS,
  UNIVERSAL_ACTION_POLICY_COPIES,
  UNIVERSAL_ACTION_POLICY_COPY_CHAINS,
} from './policies/addresses'
import {
  expandCrossChainPermit,
  livePermit2Layers,
  resolvePermit2ClaimPolicy,
} from './policies/claim'
import { encodeActionPolicies } from './policies/encode'
import {
  DEPOSIT_SELECTOR,
  isNativeToken,
  permit2FallbackScope,
  permit2RouteScope,
  permit2SourceTokens,
} from './policies/permit2-approval'
import {
  collectRefusals,
  RefusalCollectionHalted,
  type Refuse,
  recover,
  refusal,
  type refusalLog,
  refuser,
  type SessionValidation,
  type SessionWarning,
} from './refusals'
import { servedFees } from './settlement/fees'
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
  CrossChainSettlementLayer,
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
 * any validAfter, is refused; a dry run records it and skips that window.
 */
function sessionWindowDeadlines(
  definition: SessionDefinition,
  refuse: Refuse,
): bigint[] {
  const deadlines: bigint[] = []
  const take = (
    field: string,
    validUntil: unknown,
    hasValidAfter: boolean,
    permitIndex?: number,
  ) => {
    const context = permitIndex === undefined ? {} : { permitIndex }
    if (hasValidAfter || (validUntil !== undefined && !definition.oneTimeUse)) {
      refuse(
        refusal(
          'SESSION_WINDOW_REQUIRES_ONE_TIME_USE',
          sessionWindowRefusal(field),
          context,
        ),
      )
      return
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
      refuse(
        refusal(
          'VALID_UNTIL_NOT_IN_FUTURE',
          `${field}: validUntil must be a valid Date in the future`,
          context,
        ),
      )
      return
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
        index,
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

/**
 * The dry run of `toSession`: every refusal it meets and, when there is none,
 * the `access` and `settlementCoverage` the session gets. Never throws a refusal.
 */
export function validateSessionDefinition(
  definition: SessionDefinition,
  options: ResolveSessionOptions = {},
  log?: ReturnType<typeof refusalLog>,
): SessionValidation {
  const { refusals, result } = collectRefusals(
    (collect) => resolveSession(definition, options, collect),
    log,
  )
  const warnings = sessionWarnings(definition)
  const warned = warnings.length ? { warnings } : {}
  if (result === undefined) return { refusals, ...warned }
  const { access, settlementCoverage } = result
  return {
    refusals,
    access,
    ...(settlementCoverage && { settlementCoverage }),
    ...warned,
  }
}

/**
 * Under `fallback`, the wildcard admits IntentExecutor-layer settlement
 * without reading its recipient, and the claim policy that pins it checks
 * only Permit2 (`ACROSS`) claims.
 */
function sessionWarnings(definition: SessionDefinition): SessionWarning[] {
  if (definition.fallback === undefined) return []
  return (definition.crossChainPermits ?? []).flatMap((permit, permitIndex) =>
    !isSettlementScopedPermit(permit) &&
    (!permit.allowRecipientNotAccount ||
      [permit.to ?? []]
        .flat()
        .some(({ recipient }) => recipient && recipient !== 'any'))
      ? [
          {
            code: 'FALLBACK_RECIPIENT_PIN_ACROSS_ONLY',
            message:
              'crossChainPermits: with `fallback`, the recipient pin holds only for intents settled through ACROSS; use a settlement-scoped permit without `fallback` to pin it on IntentExecutor layers',
            permitIndex,
          },
        ]
      : [],
  )
}

/**
 * The session data and the IntentExecutor layers its actions were scoped to.
 * With `collect`, a dry run: independent refusals are recorded, not thrown.
 */
function resolveSession(
  definition: SessionDefinition,
  options: ResolveSessionOptions,
  collect?: Refuse,
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
  const addresses = resolvePolicyAddresses(sessionPolicyAddresses(definition), {
    chainId: definition.chain.id,
    environment,
  })
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
  const refuse = refuser(collect)
  const windowDeadlines = sessionWindowDeadlines(definition, refuse)
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
  const resolvedPermits = (definition.crossChainPermits ?? []).map(
    (input, permitIndex) => {
      const until = input.validUntil
      // As for oneTimeUse.validUntil: 0 or less would read as "never expires",
      // and a past deadline only fails at enable, as an opaque signature error.
      if (
        until !== undefined &&
        isSettlementScopedPermit(input) &&
        !(Number.isFinite(until.getTime()) && until.getTime() > Date.now())
      ) {
        refuse(
          refusal(
            'VALID_UNTIL_NOT_IN_FUTURE',
            'crossChainPermits: an IntentExecutor-layer permit validUntil must be a valid Date in the future',
            { permitIndex },
          ),
        )
      }
      return resolveCrossChainPermission(input, (error) =>
        refuse(error, { permitIndex }),
      )
    },
  )
  // An invalid oneTimeUse.validUntil is left out here and refused below.
  const otuUntil = definition.oneTimeUse?.validUntil
  const sessionDeadline = windowDeadlines.reduce(
    minDefined,
    otuUntil !== undefined &&
      Number.isFinite(otuUntil.getTime()) &&
      otuUntil.getTime() > Date.now()
      ? BigInt(Math.floor(otuUntil.getTime() / 1000))
      : undefined,
  )
  // A permit naming an IntentExecutor layer compiles to argument-pinned scoped
  // actions, which only bind with the fallback gone — so it restricts too.
  const settlementScope = resolveSettlementScope(resolvedPermits, {
    chainId: definition.chain.id,
    environment,
    account: definition.account,
    oneTimeUse: Boolean(definition.oneTimeUse),
    ...(options.settlement ? { settlement: options.settlement } : {}),
    ...(collect ? { collect } : {}),
    ...(sessionDeadline === undefined ? {} : { sessionDeadline }),
  })
  // An ERC-1271 signing surface would let the key sign a Permit2 transfer that
  // none of the calldata pins ever see.
  if (
    settlementScope !== undefined &&
    definition.signing !== undefined &&
    definition.signing.mode !== 'disabled'
  ) {
    refuse(
      refusal(
        'SIGNING_WITH_INTENT_EXECUTOR_PERMIT',
        'crossChainPermits: an IntentExecutor-layer permit cannot enable `signing`',
      ),
    )
  }
  if (settlementScope !== undefined && definition.saltMode === 'v1') {
    refuse(
      refusal(
        'SETTLEMENT_SCOPED_SALT_V1',
        "crossChainPermits: a settlement-scoped session cannot use saltMode 'v1': it must not share a permissionId with an unscoped session",
      ),
    )
  }
  const permit2Permits = resolvedPermits.filter(
    (permit) => !isSettlementScopedPermit(permit),
  )
  const fallback = definition.fallback
  if (
    fallback !== undefined &&
    (permit2Permits.length === 0 ||
      swapScope !== undefined ||
      definition.restrictToActions === true)
  ) {
    refuse(
      refusal(
        'FALLBACK_NOT_APPLICABLE',
        'fallback needs a Permit2-layer permit, without restrictToActions or swap',
      ),
    )
  }
  const access = sessionAccess(
    definition,
    resolvedPermits,
    swapScope !== undefined,
    settlementScope?.settlementLayers,
  )
  const restricted = access.kind === 'scoped'
  const chainId = definition.chain.id
  for (const [permitIndex, permit] of resolvedPermits.entries()) {
    const at = { permitIndex, chainId }
    // The burn and a fee carve are pre-claim calls, and an IntentExecutor
    // layer has no claim.
    if (
      permit.preClaimOps &&
      (definition.oneTimeUse ||
        permit.allowFees ||
        isSettlementScopedPermit(permit))
    ) {
      refuse(
        refusal(
          'PRE_CLAIM_OPS_NOT_APPLICABLE',
          'crossChainPermits: preClaimOps needs a Permit2-layer permit without oneTimeUse or allowFees',
          at,
        ),
      )
    }
    if (isSettlementScopedPermit(permit)) continue
    // Permit2 moves the wrapped token, so a native leg never matches the claim.
    if (permit.from?.some(({ token }) => isNativeToken(token))) {
      refuse(
        refusal(
          'NATIVE_SOURCE_UNSUPPORTED',
          'crossChainPermits: a Permit2-layer `from` must be an ERC-20, e.g. the wrapped native token',
          at,
        ),
      )
    }
  }
  const permit2Tokens = permit2SourceTokens(permit2Permits, chainId)
  // A sudo wildcard already admits every fee call, so allowFees adds nothing.
  const feesIndex =
    fallback === 'sudo'
      ? -1
      : resolvedPermits.findIndex(
          (permit) => !isSettlementScopedPermit(permit) && permit.allowFees,
        )
  const permit2Fees =
    permit2Tokens.size && feesIndex !== -1
      ? recover(
          (error) => refuse(error, { permitIndex: feesIndex }),
          () =>
            servedFees(options.settlement, chainId, [...permit2Tokens.keys()]),
        )
      : undefined
  // The orchestrator wraps native funding of a wrapped native `from` leg. The
  // address comes from `/chains`, so the wrap is granted only within that
  // leg's cap.
  const wrapped = options.wrappedNativeToken
  const wrapCap =
    restricted && wrapped
      ? [...permit2Tokens].find(([token]) =>
          isAddressEqual(token, wrapped),
        )?.[1]
      : undefined
  // ValueLimitPolicy refuses a zero limit when the session is enabled.
  if (wrapCap === 0n) {
    refuse(
      refusal(
        'WRAPPED_NATIVE_ZERO_CAP',
        'crossChainPermits: a wrapped native `from` leg needs a maxAmount above 0',
        { chainId },
      ),
    )
  }
  const permissions = [
    ...(definition.permissions ?? []).map(withoutWindow),
    ...(swapScope?.permissions ?? []),
    ...(settlementScope?.permissions ?? []),
  ]
  // The wildcard admits a fallback session's approves; an exact approve action
  // would take precedence over it and refuse every other spender.
  const permit2Actions =
    recover(refuse, () =>
      fallback === undefined
        ? permit2RouteScope(
            permit2Tokens,
            permissions,
            definition.actions ?? [],
            permit2Fees,
            wrapped && wrapCap ? { token: wrapped, cap: wrapCap } : undefined,
          )
        : permit2FallbackScope(
            permit2Tokens,
            permissions,
            definition.actions ?? [],
            permit2Fees,
          ),
    ) ?? []
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
    ...permit2Actions,
  ]
  // Raw claimPolicies keep their spending guardrails on the fallback action, so
  // a restricted session would drop them. A crossChainPermits entry carries
  // its own on its scoped actions (a Permit2-layer permit's cap rides its
  // Permit2 approve, its claim policy the 1271 list).
  if (restricted && definition.claimPolicies?.length) {
    refuse(
      refusal(
        'RESTRICTED_WITH_PERMIT2_GRANTS',
        'a scoped session (restrictToActions, swap or crossChainPermits) ' +
          'cannot hold claimPolicies, whose spending limits need the fallback; use crossChainPermits',
      ),
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
  // A Permit2-route maxAmount is enforced together with oneTimeUse.
  const uncappedIndex = definition.oneTimeUse
    ? -1
    : resolvedPermits.findIndex(
        (permit) =>
          !isSettlementScopedPermit(permit) &&
          permit.from?.some(({ maxAmount }) => maxAmount !== undefined),
      )
  if (uncappedIndex !== -1) {
    refuse(
      refusal(
        'PERMIT2_MAX_AMOUNT_REQUIRES_ONE_TIME_USE',
        "crossChainPermits: a Permit2-route permit's maxAmount is enforced only with oneTimeUse; set oneTimeUse or drop maxAmount",
        { permitIndex: uncappedIndex },
      ),
    )
  }
  let expansionRefused = false
  const expandedPermits = resolvedPermits.flatMap((permit, permitIndex) => {
    if (isSettlementScopedPermit(permit)) return []
    const expanded = recover(
      (error) => {
        expansionRefused = true
        refuse(error, { permitIndex })
      },
      () =>
        expandCrossChainPermit(
          permit,
          environment,
          onceDeadline,
          definition.account,
          definition.chain,
        ),
    )
    return expanded === undefined ? [] : [expanded]
  })
  // The claims a dry run dropped feed the checks below, so it stops here.
  if (expansionRefused) throw new RefusalCollectionHalted()
  const permit2Sender = defaultPermit2SenderPolicy(chainId)
  // After the claim checks, so a refused claim reports its own reason first.
  for (const permit of permit2Permits) {
    const at = { permitIndex: resolvedPermits.indexOf(permit), chainId }
    const fromHere = permit.from?.some((leg) => leg.chain.id === chainId)
    if (
      !fromHere &&
      (fallback === undefined || (permit.allowFees && fallback !== 'sudo'))
    ) {
      refuse(
        refusal(
          'PERMIT2_ROUTE_NEEDS_FROM',
          `crossChainPermits: a Permit2-layer permit needs a \`from\` token on chain ${chainId}`,
          at,
        ),
      )
    }
    if (fallback !== undefined) continue
    if (!boundsPreClaimCalls(definition, permit, permit2Sender)) {
      refuse(
        refusal(
          'PERMIT2_ROUTE_NEEDS_BOUND',
          `crossChainPermits: a Permit2-layer permit needs one of ${[...PRE_CLAIM_BOUNDS, 'fallback'].join(', ')}; chain ${chainId} has no Permit2SenderPolicy`,
          at,
        ),
      )
    }
    // Smart accounts settle same-chain intents through the IntentExecutor, so
    // ACROSS is the one Permit2 layer a scoped session needs.
    if (livePermit2Layers(permit).some((layer) => layer !== 'ACROSS')) {
      refuse(
        refusal(
          'PERMIT2_ROUTE_ACROSS_ONLY',
          'crossChainPermits: a scoped Permit2-layer permit settles through ACROSS only',
          at,
        ),
      )
    }
    // The claim pins the native token, which an ACROSS fill never delivers.
    if (permit.to?.some(({ token }) => isNativeToken(token))) {
      refuse(
        refusal(
          'NATIVE_DESTINATION_UNSUPPORTED',
          'crossChainPermits: a scoped Permit2-layer `to` must be an ERC-20, e.g. the wrapped native token',
          at,
        ),
      )
    }
  }
  const permitFallbackPolicies = expandedPermits.flatMap(
    ({ fallbackPolicies }) => fallbackPolicies,
  )
  // The wildcard intent-execution fallback. Dropped for a restricted session so
  // the explicit permissions are the ONLY authorized ops — a non-listed selector
  // then reverts instead of escaping via the global intent-execution target
  // whitelist (RHI-6286).
  const fallbackAction: SessionAction = {
    policies:
      fallback === 'sudo'
        ? [{ type: 'sudo' }]
        : [{ type: 'intent-execution' }, ...permitFallbackPolicies],
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
            selector: DEPOSIT_SELECTOR,
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
  // A Permit2-route session without `from` has already been refused.
  if (
    restricted &&
    !userActions.length &&
    !rawActions.length &&
    !permit2Permits.length
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
    // The session's own burn actions are added below; a user action on the policy
    // would share their action id.
    if (
      definition.oneTimeUse &&
      addresses.oneTimeUseId &&
      a.target.toLowerCase() === addresses.oneTimeUseId.toLowerCase()
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
  // With nothing to scope, the wildcard fallback carries sudo, not intent-execution.
  const sudoFallback = !(
    userActions.length ||
    rawActions.length ||
    expandedPermits.length
  )
  let actions: ResolvedAction[] = !sudoFallback
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
      ? resolveSession(
          definition,
          { ...options, environment: 'production' },
          collect,
        ).data.actions
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
  // to `disabled` when restricting, unless it holds claim policies: they are
  // reached through the unrestricted content gate and then become its whole
  // 1271 list, which bounds every signature (a Permit2-route session is scoped
  // only when that list also bounds pre-claim calls; see boundsPreClaimCalls).
  // The caller can still opt into a signing policy.
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
      ((restricted && rawClaimPolicies.length === 0) || executorOnlyOneTimeUse
        ? { mode: 'disabled' }
        : undefined),
    environment,
    addresses,
  })
  let erc1271Policies = erc7739Policies.erc1271Policies
  let onceErc1271Policy: { policy: Address; initData: Hex } | undefined
  if (definition.oneTimeUse) {
    if (!addresses.oneTimeUseId) {
      throw new Error(
        oneTimeUseIdPolicyMissing(definition.chain.id, environment),
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
    const signing = definition.signing
    // `scoped` and `disabled` rewrite `allowedERC7739Content`, the gate the claim
    // policy is reached through, so the policy would never be consulted. A
    // validity window instead lowers to a TimeFramePolicy, which ANDs with the
    // claim policies and leaves the gate alone, so it is carried; a windowless
    // signing policy is sudo and is dropped rather than advertising a capability
    // the session no longer has.
    if (signing !== undefined && signing.mode !== 'unrestricted') {
      throw refusal(
        'CLAIM_POLICIES_SIGNING_MODE',
        `Claim policies take over the session's ERC-1271 list, so \`signing.mode: '${signing.mode}'\` cannot also be configured — it rewrites the ERC-7739 content gate the claim policy is reached through, leaving the policy unreachable. Omit \`signing\` to keep only the claim policies, or use \`{ mode: 'unrestricted', validAfter, validUntil }\` to bound them with a window.`,
      )
    }
    const hasWindow =
      signing?.validAfter !== undefined || signing?.validUntil !== undefined
    // The 1271 list is the only authorization surface a claim-policy session
    // has, so an expired window is not a narrow session but a dead one: it
    // enables and then fails every signature. Refuse it the way oneTimeUse does
    // rather than hand back something that can never settle.
    if (
      signing?.validUntil !== undefined &&
      !(
        Number.isFinite(signing.validUntil.getTime()) &&
        signing.validUntil.getTime() > Date.now()
      )
    ) {
      throw refusal(
        'CLAIM_POLICIES_SIGNING_WINDOW_CLOSED',
        'signing.validUntil must be a valid Date in the future when the session carries claim policies — an expired window leaves no surface that can authorize a claim',
      )
    }
    erc1271Policies = [
      ...claimPolicies,
      // Only where no other bound holds, so those sessions keep their ids.
      ...(fallback === undefined &&
      permit2Sender &&
      permit2Permits.some((permit) => !boundsPreClaimCalls(definition, permit))
        ? [{ policy: permit2Sender, initData: '0x' as Hex }]
        : []),
      ...(hasWindow ? erc1271Policies : []),
      ...(onceErc1271Policy ? [onceErc1271Policy] : []),
    ]
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
        throw refusal(
          'DUPLICATE_ERC1271_POLICY',
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
    access: sudoFallback
      ? {
          kind: 'open',
          reason: definition.claimPolicies?.length
            ? 'claimPolicies only; the wildcard fallback is sudo'
            : 'no restriction set; the wildcard fallback is sudo',
        }
      : access,
  }
}

/** Whether the session drops the intent-execution fallback, and what decided it. */
function sessionAccess(
  definition: SessionDefinition,
  permits: readonly CrossChainPermit[],
  swapScoped: boolean,
  settlementLayers: readonly IntentExecutorSettlementLayer[] | undefined,
): SessionAccess {
  if (definition.fallback !== undefined) {
    return { kind: 'open', reason: `fallback: ${definition.fallback}` }
  }
  const permit2 = permits.filter((permit) => !isSettlementScopedPermit(permit))
  const scopedBy = [
    ...(definition.restrictToActions === true ? ['restrictToActions'] : []),
    ...(swapScoped ? ['swap scope'] : []),
    ...(settlementLayers
      ? [`settlement-scoped permit (${settlementLayers.join(', ')})`]
      : []),
    ...(permit2.length
      ? [`Permit2-route permit (${permit2LayerSet(permit2).join(', ')})`]
      : []),
  ]
  if (scopedBy.length) return { kind: 'scoped', reason: scopedBy.join('; ') }
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
 * The Permit2 layers the session's permit names. Empty when it names none,
 * which admits every Permit2 arbiter. A session carries at most one Permit2
 * permit (a second claim policy is refused when the session resolves).
 */
function namedPermit2Layers(
  permits: readonly CrossChainPermit[],
): CrossChainSettlementLayer[] {
  return [
    ...new Set(
      permits.flatMap(({ settlementLayers }) =>
        Array.isArray(settlementLayers) ? settlementLayers : [],
      ),
    ),
  ]
}

/** The ways a Permit2-route session's ERC-1271 list bounds the calls a claim carries. */
const PRE_CLAIM_BOUNDS = [
  'oneTimeUse',
  "preClaimOps: 'none'",
  'Permit2SenderPolicy',
]

/**
 * Whether the session's ERC-1271 list bounds the pre-claim calls a claim
 * through this permit may carry, which a scoped session needs: the once-policy
 * and Permit2SenderPolicy admit only Permit2 as the requester, so pre-claim
 * calls are checked as executions, and `preClaimOps: 'none'` admits none.
 */
function boundsPreClaimCalls(
  definition: SessionDefinition,
  permit: CrossChainPermit,
  permit2Sender?: Address,
): boolean {
  return (
    Boolean(definition.oneTimeUse) ||
    permit.preClaimOps === 'none' ||
    permit2Sender !== undefined
  )
}

/** Every Permit2 layer the permits settle through, once each. */
function permit2LayerSet(
  permits: readonly CrossChainPermit[],
): CrossChainSettlementLayer[] {
  return [...new Set(permits.flatMap(livePermit2Layers))]
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
  const resolvedPermits = (definition.crossChainPermits ?? []).map((permit) =>
    resolveCrossChainPermission(permit),
  )
  const scopedPermits = resolvedPermits.filter(isSettlementScopedPermit)
  const permit2Permits = resolvedPermits.filter(
    (permit) => !isSettlementScopedPermit(permit),
  )
  const permit2Scoped = access.kind === 'scoped' && permit2Permits.length > 0
  // A scoped Permit2-route session settles only through the live arbiters.
  const intentLayers = settlementLayers.length
    ? settlementLayers
    : permit2Scoped
      ? permit2LayerSet(permit2Permits)
      : namedPermit2Layers(resolvedPermits)
  const expandedClaims = permit2Permits.map(
    (permit) =>
      expandCrossChainPermit(
        permit,
        environment,
        undefined,
        undefined,
        definition.chain,
      ).claim,
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
        definition.swap ||
        scopedPermits.length ||
        permit2Scoped,
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
    ...(intentLayers.length ? { settlementLayers: intentLayers } : {}),
    ...(settlementCoverage ? { settlementCoverage } : {}),
    ...(permit2Scoped && {
      permit2Sources: [
        ...new Map(
          permit2Permits.flatMap(({ from = [] }) =>
            from.map(({ chain }) => [chain.id, chain] as const),
          ),
        ).values(),
      ].flatMap((chain) =>
        [...permit2SourceTokens(permit2Permits, chain.id)].map(
          ([token, maxAmount]) => ({
            chain,
            token,
            ...(maxAmount === undefined ? {} : { maxAmount }),
          }),
        ),
      ),
    }),
    access,
    ...(definition.oneTimeUse && {
      oneTimeUse: {
        id: definition.oneTimeUse.id,
        policy: resolvePolicyAddresses(definition.policyAddresses, {
          chainId: definition.chain.id,
          environment,
        }).oneTimeUseId as Address,
        ...(definition.policyAddresses?.oneTimeUseId === undefined
          ? { defaultPolicy: true as const }
          : {}),
      },
    }),
  }
}

export { DEFAULT_POLICY_ADDRESSES }
