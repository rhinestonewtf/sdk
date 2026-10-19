import { type Address, isAddressEqual } from 'viem'
import { recipientNotAllowed } from '../cross-chain-permits'
import {
  RefusalCollectionHalted,
  type Refuse,
  recover,
  refusal,
  refuser,
} from '../refusals'
import { allOf, anyOf, cumulativeCap, pin, swapAction } from '../swap/rules'
import { PERMIT2 } from '../swap/stable-floor'
import type {
  CrossChainPermit,
  CrossChainSettlementLayer,
  DroppedSettlementLayer,
  IntentExecutorSettlementLayer,
  Permission,
  ScopedAction,
} from '../types'
import { scopeCctp } from './cctp'
import { scopeEco } from './eco'
import {
  APPROVE_SELECTOR,
  servedFees,
  swapApprovesAsActions,
  withFeeActions,
} from './fees'
import { floorWithinCap, requireFloorsWithinCaps } from './floor'
import { scopeLz } from './lz'
import { scopeOft } from './oft'
import { scopeSameChain } from './same-chain'
import { SettlementLayerRefusal, served } from './served'
import type { SettlementCatalog, SettlementContext } from './types'

/**
 * Settlement-scoped cross-chain permits.
 *
 * A permit that names IntentExecutor layers compiles to scoped actions with
 * its recipient, destination chain, token and amount pinned in each layer's
 * calldata. Those pins only bind when nothing else can run, so such a session
 * is restricted: the wildcard fallback is dropped and only the layers'
 * settlement calls and their shared approve remain. `ACROSS` beside them adds
 * Permit2 as one more spender of that approve; its claim is bound from the
 * ERC-1271 list.
 */

const defined = (tokens: (Address | undefined)[]) =>
  tokens.filter((token): token is Address => token !== undefined)

/** Each layer's settlement contract on a chain and the scoped call it makes. */
// SAME_CHAIN_IE has no fixed target: it transfers the token itself or reuses the
// swap scope, so it is resolved before this table.
const LAYERS: Record<
  Exclude<IntentExecutorSettlementLayer, 'SAME_CHAIN_IE'>,
  {
    readonly target: (settlement: SettlementCatalog, chainId: number) => Address
    /** Who the account approves, when not the target (LZ's TransferDelegate). */
    readonly spender?: (
      settlement: SettlementCatalog,
      chainId: number,
    ) => Address
    readonly scope: (ctx: SettlementContext) => ScopedAction
    /** The tokens the layer moves on a chain, as served; empty where it is not. */
    readonly tokens: (
      settlement: SettlementCatalog,
      chainId: number,
    ) => Address[]
    /**
     * Each call costs the account a native messaging fee no pin can bound, so
     * a reusable session could repeat dust sends until the balance is gone.
     * A `maxAmount` caps the token, not that fee; only oneTimeUse or a
     * `maxNativeFee`, a ValueLimitPolicy on the call, bounds it.
     */
    readonly paysNativeFee?: true
    /** Enforces the leg's `to.minAmount` on what its call delivers. */
    readonly floorsDelivery?: true
  }
> = {
  CCTP: {
    target: (settlement, chainId) =>
      served(settlement, chainId, 'cctp').tokenMessenger,
    scope: scopeCctp,
    tokens: (settlement, chainId) => defined([settlement[chainId]?.cctp?.usdc]),
  },
  OFT: {
    target: (settlement, chainId) => served(settlement, chainId, 'oft').adapter,
    scope: scopeOft,
    tokens: (settlement, chainId) => defined([settlement[chainId]?.oft?.token]),
    paysNativeFee: true,
    floorsDelivery: true,
  },
  ECO_IE: {
    target: (settlement, chainId) => served(settlement, chainId, 'eco').portal,
    scope: scopeEco,
    tokens: (settlement, chainId) => [
      ...(settlement[chainId]?.eco?.stablecoins ?? []),
    ],
    floorsDelivery: true,
  },
  LZ: {
    target: (settlement, chainId) =>
      served(settlement, chainId, 'lz').multiCall,
    spender: (settlement, chainId) =>
      served(settlement, chainId, 'lz').transferDelegate,
    scope: scopeLz,
    tokens: (settlement, chainId) =>
      defined([
        settlement[chainId]?.lz?.stargateUsdc?.token,
        settlement[chainId]?.lz?.cctp?.token,
      ]),
    paysNativeFee: true,
    floorsDelivery: true,
  },
}

/** Why the layer cannot pin `ctx`'s one leg, or undefined when it can. */
function legRefusal(
  layer: keyof typeof LAYERS,
  ctx: SettlementContext,
): SettlementLayerRefusal | undefined {
  try {
    LAYERS[layer].scope(ctx)
    return undefined
  } catch (error) {
    if (error instanceof SettlementLayerRefusal) return error
    throw error
  }
}

/**
 * What a layer's call pins to reach a leg: its chain and token, and the CCTP
 * domain or LayerZero endpoint id of each route that delivers its token there.
 */
function deliveries(
  settlement: SettlementCatalog,
  leg: SettlementContext['destinations'][number],
): string[] {
  const at = settlement[leg.chainId]
  const is = (token: Address | undefined) =>
    token !== undefined && isAddressEqual(token, leg.token)
  return [
    `chain:${leg.chainId}:${leg.token.toLowerCase()}`,
    ...(at?.cctp && is(at.cctp.usdc) ? [`cctp:${at.cctp.domain}`] : []),
    ...(at?.lz?.cctp && is(at.lz.cctp.token)
      ? [`cctp:${at.lz.cctp.domain}`]
      : []),
    ...(at?.lz?.stargateUsdc && is(at.lz.stargateUsdc.token)
      ? [`stargate:${at.lz.stargateUsdc.eid}`]
      : []),
    ...(at?.oft && is(at.oft.token) ? [`oft:${at.oft.eid}`] : []),
  ]
}

export const INTENT_EXECUTOR_SETTLEMENT_LAYERS = [
  'CCTP',
  'OFT',
  'ECO_IE',
  'SAME_CHAIN_IE',
  'LZ',
] as const satisfies readonly IntentExecutorSettlementLayer[]

export function isIntentExecutorLayer(
  layer: CrossChainSettlementLayer,
): layer is IntentExecutorSettlementLayer {
  return (INTENT_EXECUTOR_SETTLEMENT_LAYERS as readonly string[]).includes(
    layer,
  )
}

/** The bridging layers, in the order a session compiles them; `'all'` names each. */
const CROSS_CHAIN_LAYERS = ['CCTP', 'OFT', 'ECO_IE', 'LZ'] as const

export function isSettlementScopedPermit(
  permit: Pick<CrossChainPermit, 'settlementLayers'>,
): boolean {
  return (
    permit.settlementLayers === 'all' ||
    (permit.settlementLayers?.some(isIntentExecutorLayer) ?? false)
  )
}

export interface SettlementScopeOptions {
  readonly chainId: number
  readonly environment: 'production' | 'development'
  readonly account: Address | undefined
  readonly oneTimeUse: boolean
  /** The orchestrator's `/chains` settlement addresses; IntentExecutor layers need them. */
  readonly settlement?: SettlementCatalog
  /** Dry run only: receives each independent refusal instead of throwing it. */
  readonly collect?: Refuse
  /** `oneTimeUse.validUntil`, in seconds. */
  readonly sessionDeadline?: bigint
  /** Set when the permit names `ACROSS` or is `'all'`: `dropped` is why `'all'` left it out. */
  readonly across?: { readonly dropped?: string }
}

export interface ResolvedSettlementScope {
  readonly actions: ScopedAction[]
  /** ABI-sugar permissions the layer adds (the SAME_CHAIN_IE swap's approve). */
  readonly permissions: Permission[]
  readonly settlementLayers: CrossChainSettlementLayer[]
  /** The layers `'all'` dropped, with the refusal that dropped each. */
  readonly dropped: DroppedSettlementLayer[]
}

export function resolveSettlementScope(
  permits: readonly CrossChainPermit[],
  options: SettlementScopeOptions,
): ResolvedSettlementScope | undefined {
  const scoped = permits.filter(isSettlementScopedPermit)
  if (scoped.length === 0) return undefined
  if (scoped.length !== permits.length) {
    throw refusal(
      'MIXED_PERMIT_KINDS',
      'crossChainPermits: a session cannot mix IntentExecutor-layer permits with Permit2-layer permits',
      {
        permitIndex: permits.findIndex(
          (permit) => !isSettlementScopedPermit(permit),
        ),
      },
    )
  }
  if (scoped.length > 1) {
    throw refusal(
      'MULTIPLE_INTENT_EXECUTOR_PERMITS',
      'crossChainPermits: give at most one IntentExecutor-layer permit per session',
      { permitIndex: permits.indexOf(scoped[1]) },
    )
  }
  const [permit] = scoped
  const permitIndex = permits.indexOf(permit)
  const refuse = refuser(options.collect, { permitIndex })
  // A refusal that leaves nothing valid to scope ends the dry run here.
  const scope = recover(refuse, () => scopePermit(permit, options, refuse))
  if (scope === undefined) throw new RefusalCollectionHalted()
  return scope
}

function scopePermit(
  permit: CrossChainPermit,
  options: SettlementScopeOptions,
  refuse: Refuse,
): ResolvedSettlementScope {
  const named = permit.settlementLayers
  const all = named === 'all'
  const layers = all ? [...CROSS_CHAIN_LAYERS] : (named ?? [])
  const across = options.across !== undefined && !options.across.dropped
  const permit2Layers = layers.filter(
    (layer) => !isIntentExecutorLayer(layer) && !(across && layer === 'ACROSS'),
  )
  if (permit2Layers.length) {
    throw refusal(
      'PERMIT2_LAYER_WITH_INTENT_EXECUTOR_LAYER',
      `crossChainPermits: ${permit2Layers.join(', ')} cannot share a permit with IntentExecutor layers`,
    )
  }
  const requested = [...new Set(layers.filter(isIntentExecutorLayer))]
  // SAME_CHAIN_IE's transfer or swap shares no call shape with a bridge.
  if ((requested.length > 1 || across) && requested.includes('SAME_CHAIN_IE')) {
    throw refusal(
      'SAME_CHAIN_IE_WITH_OTHER_LAYERS',
      `crossChainPermits: SAME_CHAIN_IE cannot share a permit with ${across ? 'ACROSS' : 'other IntentExecutor layers'}`,
    )
  }

  const fromLegs = (permit.from ?? []).filter(
    (leg) => leg.chain.id === options.chainId,
  )
  if (fromLegs.length === 0) {
    throw refusal(
      'NO_FROM_ON_CHAIN',
      `crossChainPermits: the permit names no \`from\` token on chain ${options.chainId}`,
      { chainId: options.chainId },
    )
  }
  const caps = fromLegs.flatMap(({ maxAmount }) =>
    maxAmount === undefined ? [] : [maxAmount],
  )
  if (caps.length > 1) {
    refuse(
      refusal(
        'MULTIPLE_MAX_AMOUNTS',
        'crossChainPermits: give maxAmount on at most one `from` token per chain',
        { chainId: options.chainId, leg: 'from' },
      ),
    )
  }
  const cap = caps[0]
  const capToken = fromLegs.find(
    ({ maxAmount }) => maxAmount !== undefined,
  )?.token
  const nativeFees = fromLegs.flatMap(({ maxNativeFee }) =>
    maxNativeFee === undefined ? [] : [maxNativeFee],
  )
  if (nativeFees.length > 1) {
    refuse(
      refusal(
        'MULTIPLE_MAX_NATIVE_FEES',
        'crossChainPermits: give maxNativeFee on at most one `from` token per chain',
        { chainId: options.chainId, leg: 'from' },
      ),
    )
  }
  const maxNativeFee = nativeFees[0]
  // ValueLimitPolicy refuses a zero limit at enable.
  if (maxNativeFee !== undefined && maxNativeFee <= 0n) {
    refuse(
      refusal(
        'MAX_NATIVE_FEE_NOT_POSITIVE',
        'crossChainPermits: maxNativeFee must be positive',
        { chainId: options.chainId, leg: 'from' },
      ),
    )
  }
  const nativeFeeNotApplicable = (why = 'neither settles this permit') =>
    refusal(
      'MAX_NATIVE_FEE_NOT_APPLICABLE',
      `crossChainPermits: maxNativeFee applies only to LZ and OFT, and ${why} on chain ${options.chainId}`,
      { chainId: options.chainId, leg: 'from' },
    )
  const sourceTokens = fromLegs.map(({ token }) => token)

  const recipientIsAccount = permit.recipientIsAccount ?? true
  const resolveRecipient = (
    recipient: Address | 'any' | undefined,
  ): Address | undefined => {
    if (recipient === 'any') {
      if (recipientIsAccount) throw recipientNotAllowed(recipient)
      return undefined
    }
    if (recipient === undefined || recipientIsAccount) {
      if (!options.account) {
        throw refusal(
          'RECIPIENT_NEEDS_ACCOUNT',
          'crossChainPermits: pinning the recipient to the account needs `account` on the session definition',
        )
      }
      if (
        recipient !== undefined &&
        !isAddressEqual(recipient, options.account)
      ) {
        throw recipientNotAllowed(recipient)
      }
      return options.account
    }
    return recipient
  }
  // Without a destination pin the key picks the domain, and a burn to a domain
  // where the recipient cannot mint (e.g. Solana, whose recipient is an ATA)
  // is lost.
  if (!permit.to?.length) {
    throw refusal(
      'MISSING_TO',
      'crossChainPermits: an IntentExecutor-layer permit must name its `to` chains',
    )
  }
  // fillDeadline bounds a Permit2 claim; no IntentExecutor layer carries one,
  // so 'all' keeps ACROSS alone.
  const fillDeadlineDrops = Boolean(
    permit.fillDeadline?.length && all && across,
  )
  if (permit.fillDeadline?.length && !fillDeadlineDrops) {
    refuse(
      refusal(
        'FILL_DEADLINE_ONLY_PERMIT2',
        'crossChainPermits: fillDeadline applies only to Permit2 layers',
      ),
    )
  }
  const destinations = permit.to.map(
    ({ chain, token, recipient, minAmount }) => ({
      chainId: chain.id,
      token,
      recipient: resolveRecipient(recipient),
      ...(minAmount === undefined ? {} : { minAmount }),
    }),
  )

  const sameChainOnly = requested[0] === 'SAME_CHAIN_IE'
  // Only ECO_IE prices its delivery against the reward; elsewhere the field would
  // be silently ignored.
  if (permit.maxFeeBps !== undefined && !requested.includes('ECO_IE')) {
    refuse(
      refusal(
        'MAX_FEE_BPS_ONLY_ECO_IE',
        'crossChainPermits: maxFeeBps applies only to ECO_IE',
      ),
    )
  }
  // A layer delivering a floored leg must enforce its `to.minAmount`, or the key
  // would settle around it: scopeLayer refuses one that cannot (CCTP never can).
  const minAmount = permit.to.some((leg) => leg.minAmount !== undefined)
  if (minAmount && !sameChainOnly && options.settlement) {
    const settlement = options.settlement
    // A floor is judged against the caps that fund the same asset to it: a
    // one-token bridge (OFT, LZ) or ECO_IE between two of one stablecoin. A
    // different stablecoin's cap funds it only through ECO_IE; a units mistake
    // fits none of them. Each layer still leaves out a leg its own cap cannot fund
    // (see scopeLayer), so no fit here vouches for another route.
    const carries = (
      layer: 'OFT' | 'LZ' | 'ECO_IE',
      chainId: number,
      token: Address,
    ) =>
      LAYERS[layer]
        .tokens(settlement, chainId)
        .some((moved) => isAddressEqual(moved, token))
    const symbol = (chainId: number, token: Address) =>
      settlement[chainId]?.usdStablecoins?.find((stable) =>
        isAddressEqual(stable.address, token),
      )?.symbol
    recover(refuse, () =>
      requireFloorsWithinCaps(permit, settlement, (from, to) => {
        const both = (layer: 'OFT' | 'LZ' | 'ECO_IE') =>
          carries(layer, from.chain.id, from.token) &&
          carries(layer, to.chain.id, to.token)
        const sameStable =
          symbol(from.chain.id, from.token) !== undefined &&
          symbol(from.chain.id, from.token) === symbol(to.chain.id, to.token)
        if (both('OFT') || both('LZ') || (both('ECO_IE') && sameStable))
          return 'same'
        return both('ECO_IE') ? 'other' : undefined
      }),
    )
  }
  // A dry run that refuses the fee addresses goes on to check the layers. A
  // bridge permit's tokens are judged once its kept routes are known: only
  // the tokens that get fee calls must be served stablecoins.
  const fees = permit.allowFees
    ? recover(refuse, () =>
        servedFees(
          options.settlement,
          options.chainId,
          sameChainOnly ? sourceTokens : [],
        ),
      )
    : undefined
  if (sameChainOnly) {
    if (maxNativeFee !== undefined) refuse(nativeFeeNotApplicable())
    const settlementLayers = requested
    const sameChain = scopeSameChain({
      chainId: options.chainId,
      environment: options.environment,
      account: options.account,
      sourceTokens,
      destinations,
      cap,
    })
    if (fees === undefined) {
      return { ...sameChain, settlementLayers, dropped: [] }
    }
    // A swap's approve is a permission; as a raw action the paymaster approve can
    // join it. Only the swap shape has permissions.
    const actions = [
      ...sameChain.actions,
      ...swapApprovesAsActions(sameChain.permissions, cap),
    ]
    return {
      actions: withFeeActions(actions, sourceTokens, fees),
      permissions: [],
      settlementLayers,
      dropped: [],
    }
  }
  // No bundled fallback: the orchestrator is the one source for these addresses.
  // SAME_CHAIN_IE pins none of them, so only the layers below need it.
  const settlement = options.settlement
  if (settlement === undefined) {
    throw refusal(
      'SETTLEMENT_CATALOG_MISSING',
      "crossChainPermits: IntentExecutor layers and 'all' (the default) need options.settlement from GET /chains; pass it or name settlementLayers, e.g. ['ACROSS']",
    )
  }
  // Two legs that admit the same delivery but set different floors leave the
  // looser one open: a layer that leaves out the floored leg would still pin its
  // twin. Every flooring layer refuses such a pair, so the permit does too. A
  // layer pins a destination by its domain or endpoint id, which another chain
  // (a testnet) can share, so those count as the same delivery as well.
  const twin = destinations.find((leg, i) =>
    destinations.some(
      (other, j) =>
        j < i &&
        deliveries(settlement, other).some((key) =>
          deliveries(settlement, leg).includes(key),
        ) &&
        (other.recipient === undefined ||
          leg.recipient === undefined ||
          isAddressEqual(other.recipient, leg.recipient)) &&
        other.minAmount !== leg.minAmount,
    ),
  )
  if (twin) {
    refuse(
      refusal(
        'CONFLICTING_LEG_FLOORS',
        `crossChainPermits: two \`to\` legs reach the same destination as ${twin.token} on chain ${twin.chainId}, for the same recipient, with different \`to.minAmount\`s; give it once`,
        { chainId: twin.chainId, leg: 'to' },
      ),
    )
  }
  // ECO_IE pins Eco's deadlines under the earlier of the permit's validUntil and
  // the one-time-use deadline.
  const validUntil =
    permit.validUntil === undefined ||
    (options.sessionDeadline !== undefined &&
      options.sessionDeadline < permit.validUntil)
      ? options.sessionDeadline
      : permit.validUntil
  const scopeLayer = (layer: (typeof CROSS_CHAIN_LAYERS)[number]) => {
    if (fillDeadlineDrops) {
      throw new SettlementLayerRefusal(
        'crossChainPermits: fillDeadline applies only to Permit2 layers',
        { code: 'FILL_DEADLINE_ONLY_PERMIT2' },
      )
    }
    const paysNativeFee = LAYERS[layer].paysNativeFee
    if (paysNativeFee && !options.oneTimeUse && maxNativeFee === undefined) {
      throw new SettlementLayerRefusal(
        `crossChainPermits: an ${layer} permit requires oneTimeUse or a maxNativeFee on its \`from\` leg`,
        { code: 'LAYER_REQUIRES_ONE_TIME_USE' },
      )
    }
    const target = LAYERS[layer].target(settlement, options.chainId)
    const spender =
      LAYERS[layer].spender?.(settlement, options.chainId) ?? target
    // Each layer is offered only the tokens it moves, so its one pinned token
    // is chosen here and no action ORs two tokens. With none left, the layer
    // refuses the permit's tokens as before.
    const moves = (chainId: number, token: Address) =>
      LAYERS[layer]
        .tokens(settlement, chainId)
        .some((moved) => isAddressEqual(moved, token))
    const tokens = sourceTokens.filter((token) => moves(options.chainId, token))
    if (tokens.length === 0 && sourceTokens.length > 1) {
      throw new SettlementLayerRefusal(
        `crossChainPermits: ${layer} moves none of the \`from\` tokens on chain ${options.chainId}`,
        { code: 'TOKEN_NOT_ROUTED', chainId: options.chainId, leg: 'from' },
      )
    }
    // The layer's call counts the cap in its own token's units, so a cap set on
    // another token would bound nothing.
    if (
      capToken !== undefined &&
      tokens.length === 1 &&
      !isAddressEqual(tokens[0], capToken)
    ) {
      throw new SettlementLayerRefusal(
        `crossChainPermits: ${layer} moves ${tokens[0]} on chain ${options.chainId}, but maxAmount is set on ${capToken}`,
        { code: 'CAP_TOKEN_MISMATCH', chainId: options.chainId, leg: 'from' },
      )
    }
    // A leg on a chain the layer does not serve is left to the other layers; the
    // explicit-list coverage check below refuses one none of them takes.
    const legs = destinations.filter((leg) => moves(leg.chainId, leg.token))
    // A layer must enforce the floor on every leg it delivers, or the key would
    // settle around it, so one that cannot leaves floored legs to those that can.
    const unfloorable = LAYERS[layer].floorsDelivery
      ? undefined
      : new SettlementLayerRefusal(
          `crossChainPermits: ${layer} cannot enforce \`to.minAmount\``,
          { code: 'MIN_AMOUNT_NOT_ENFORCEABLE' },
        )
    const ctx: SettlementContext = {
      chainId: options.chainId,
      settlement,
      target,
      account: options.account,
      sourceTokens: tokens.length ? tokens : sourceTokens,
      destinations: legs.length ? legs : destinations,
      cap,
      // Only the `from` legs this layer moves, on any chain: another token's cap
      // bounds nothing it publishes.
      fromCaps: (permit.from ?? [])
        .filter((leg) => moves(leg.chain.id, leg.token))
        .map(({ maxAmount }) => maxAmount),
      ...(permit.maxFeeBps === undefined
        ? {}
        : { maxFeeBps: permit.maxFeeBps }),
      ...(validUntil === undefined ? {} : { validUntil }),
      ...(options.oneTimeUse ? {} : { reusable: true as const }),
    }
    // A leg the layer cannot pin alone (no route, no shared prover, an unpinnable
    // recipient) is left to the other layers rather than dropping this one; with
    // none pinnable, the layer refuses as before.
    // The call funds every floored leg it pins from this chain's cap, in the
    // cap's own token: a floor that cap cannot fund keeps the leg off this layer,
    // whatever another route or chain's cap would allow.
    const outsideCap = (leg: (typeof legs)[number]) =>
      cap !== undefined &&
      capToken !== undefined &&
      leg.minAmount !== undefined &&
      floorWithinCap(
        settlement,
        { chainId: options.chainId, token: capToken, maxAmount: cap },
        { chainId: leg.chainId, token: leg.token, minAmount: leg.minAmount },
      ) === false
        ? new SettlementLayerRefusal(
            `crossChainPermits: \`to.minAmount\` ${leg.minAmount} on chain ${leg.chainId} must be between half of and all of the chain ${options.chainId} maxAmount, which funds ${layer}`,
            { code: 'MIN_AMOUNT_OUTSIDE_CAP', chainId: leg.chainId, leg: 'to' },
          )
        : undefined
    const refused = new Map(
      legs.flatMap((leg) => {
        const why =
          unfloorable && leg.minAmount !== undefined
            ? unfloorable
            : (outsideCap(leg) ??
              legRefusal(layer, { ...ctx, destinations: [leg] }))
        return why ? [[leg, why] as const] : []
      }),
    )
    const pinned = legs.filter((leg) => !refused.has(leg))
    // With no leg left, refuse for the legs' own reasons: never fall back to
    // building over a leg this layer was refused (a floor it cannot enforce or
    // fund).
    if (pinned.length === 0 && refused.size > 0) {
      throw unfloorable && legs.some((leg) => leg.minAmount !== undefined)
        ? unfloorable
        : [...refused.values()][0]
    }
    const scoped = LAYERS[layer].scope(
      pinned.length ? { ...ctx, destinations: pinned } : ctx,
    )
    // The call's `msg.value` is all the native it takes from the account, so
    // the cumulative policy bounds every fee the session pays on this layer.
    // It counts what is sent, not refunds: an overpaid send still uses it, and
    // the key may spend all of it as real fees on 1-unit sends.
    const action =
      paysNativeFee && maxNativeFee !== undefined
        ? {
            ...scoped,
            policies: [
              ...(scoped.policies ?? []),
              { type: 'value-limit' as const, limit: maxNativeFee },
            ],
          }
        : scoped
    return { layer, spender, action, tokens, legs: pinned, refused }
  }
  // An explicit list is strict: a layer that cannot scope throws. 'all' keeps
  // only the layers that can; any other error still throws. A fixed order keeps
  // the session the same however the layers were listed.
  const skipped = new Map<DroppedSettlementLayer['layer'], string>(
    options.across?.dropped ? [['ACROSS', options.across.dropped]] : [],
  )
  const bridges = CROSS_CHAIN_LAYERS.filter((layer) =>
    requested.includes(layer),
  )
  const built = bridges.flatMap((layer) => {
    if (!all) {
      const scopedLayer = recover(
        (error) => refuse(error, { layer }),
        () => scopeLayer(layer),
      )
      return scopedLayer === undefined ? [] : [scopedLayer]
    }
    try {
      return [scopeLayer(layer)]
    } catch (error) {
      if (!(error instanceof SettlementLayerRefusal)) throw error
      skipped.set(layer, error.message.replace(/^crossChainPermits: /, ''))
      return []
    }
  })
  // Each layer's call allows one send, but one burning transaction admits both,
  // and each pays a native fee no pin bounds. 'all' keeps neither rather than
  // pick one; an explicit list is refused below.
  const feePaying = built.filter(({ layer }) => LAYERS[layer].paysNativeFee)
  const feeConflict = `${feePaying.map(({ layer }) => layer).join(' and ')} each pay a native LayerZero fee, so a permit may use only one of them; name the layers to keep`
  if (all && feePaying.length > 1) {
    for (const { layer } of feePaying) skipped.set(layer, feeConflict)
  }
  const scopedLayers =
    all && feePaying.length > 1
      ? built.filter((scoped) => !feePaying.includes(scoped))
      : built
  // The budget belongs to the fee-paying layer kept. With none kept, refuse
  // rather than let 'all' settle without the layer the budget was set for. A
  // named fee-paying layer that was refused has said why already.
  if (
    maxNativeFee !== undefined &&
    (all || !bridges.some((layer) => LAYERS[layer].paysNativeFee)) &&
    !scopedLayers.some(({ layer }) => LAYERS[layer].paysNativeFee)
  ) {
    refuse(
      nativeFeeNotApplicable(
        all && feePaying.length > 1
          ? `'all' keeps neither here: ${feeConflict}`
          : 'neither settles this permit',
      ),
    )
  }
  // Only a dry run gets here with no named layer scoped; it has recorded why.
  if (!all && scopedLayers.length === 0) throw new RefusalCollectionHalted()
  const ecoSkipped = skipped.get('ECO_IE')
  if (permit.maxFeeBps !== undefined && ecoSkipped !== undefined) {
    refuse(
      refusal(
        'MAX_FEE_BPS_ECO_IE_UNAVAILABLE',
        `crossChainPermits: maxFeeBps asks for ECO_IE, which cannot settle this permit: ${ecoSkipped}`,
        { layer: 'ECO_IE' },
      ),
    )
  }
  // maxFeeBps asks ECO_IE to settle the permit, so it must pin every leg.
  const eco = scopedLayers.find(({ layer }) => layer === 'ECO_IE')
  const ecoMisses = eco
    ? destinations.find((leg) => !eco.legs.includes(leg))
    : undefined
  if (permit.maxFeeBps !== undefined && ecoMisses) {
    refuse(
      refusal(
        'MAX_FEE_BPS_ECO_IE_UNAVAILABLE',
        `crossChainPermits: maxFeeBps asks for ECO_IE, which cannot settle the \`to\` leg ${ecoMisses.token} on chain ${ecoMisses.chainId}`,
        { layer: 'ECO_IE', chainId: ecoMisses.chainId, leg: 'to' },
      ),
    )
  }
  if (scopedLayers.length === 0 && !across) {
    throw refusal(
      'NO_LAYER_CAN_SETTLE',
      `crossChainPermits: no ${options.across ? '' : 'IntentExecutor '}layer can settle this permit on chain ${options.chainId} (${[
        ...skipped,
      ]
        .map(([layer, reason]) => `${layer}: ${reason}`)
        .join('; ')})`,
      { chainId: options.chainId },
    )
  }
  if (!all && feePaying.length > 1) {
    refuse(
      refusal(
        'MULTIPLE_FEE_PAYING_LAYERS',
        `crossChainPermits: ${feeConflict}`,
      ),
    )
  }
  // An explicit list is strict about tokens too: one no named layer moves
  // would sit in the permit unusable. A dry run that refused a layer has
  // said why already.
  if (!all && !across && scopedLayers.length === bridges.length) {
    const token = sourceTokens.find(
      (token) =>
        !scopedLayers.some(({ tokens }) =>
          tokens.some((moved) => isAddressEqual(moved, token)),
        ),
    )
    if (token) {
      refuse(
        refusal(
          'TOKEN_NOT_ROUTED',
          `crossChainPermits: no named layer moves the \`from\` token ${token} on chain ${options.chainId}`,
          { chainId: options.chainId, leg: 'from' },
        ),
      )
    }
    // A leg on this chain is not this session's to bridge (LZ skips it), unless
    // its floor binds a named layer that moves its token and cannot enforce it.
    const ownChainExempt = (leg: (typeof destinations)[number]) =>
      leg.minAmount === undefined ||
      !scopedLayers.some(
        ({ layer, tokens }) =>
          !LAYERS[layer].floorsDelivery &&
          tokens.some((moved) => isAddressEqual(moved, leg.token)),
      )
    const leg = destinations.find(
      (leg) =>
        (leg.chainId !== options.chainId || !ownChainExempt(leg)) &&
        !scopedLayers.some(({ legs }) => legs.includes(leg)),
    )
    // A named layer that could not pin the leg says why; otherwise none moves it.
    const why = leg
      ? scopedLayers.find(({ refused }) => refused.has(leg))
      : undefined
    if (leg && why) {
      refuse(why.refused.get(leg) as Error, { layer: why.layer })
    } else if (leg) {
      const served = bridges.some(
        (layer) => LAYERS[layer].tokens(settlement, leg.chainId).length > 0,
      )
      refuse(
        served
          ? refusal(
              'TOKEN_NOT_ROUTED',
              `crossChainPermits: no named layer delivers the \`to\` token ${leg.token} on chain ${leg.chainId}`,
              { chainId: leg.chainId, leg: 'to' },
            )
          : refusal(
              'LAYER_NOT_SERVED',
              `crossChainPermits: no named layer routes to chain ${leg.chainId}`,
              { chainId: leg.chainId, leg: 'to' },
            ),
      )
    }
  }
  const settlementLayers: CrossChainSettlementLayer[] = [
    ...(across ? (['ACROSS'] as const) : []),
    ...scopedLayers.map(({ layer }) => layer),
  ]
  // Permit2 joins the one approve, so ACROSS draws on the same maxAmount. A
  // token is approved only to the layers that move it.
  const spendersOf = (token: Address) =>
    [
      ...scopedLayers
        .filter(({ tokens }) =>
          tokens.some((moved) => isAddressEqual(moved, token)),
        )
        .map(({ spender }) => spender),
      ...(across ? [PERMIT2] : []),
    ].filter(
      (spender, i, list) =>
        list.findIndex((other) => isAddressEqual(other, spender)) === i,
    )

  // Without allowFees, only the layers' own approves: an unsponsored intent or
  // one carrying an app fee adds calls this session does not authorise.
  // Cumulative: the burning transaction admits every op after the burn, and a
  // reusable session every later intent, so a per-call bound would let
  // repeated approves grant the cap many times. Each layer call keeps its own
  // counter; this one is what bounds them together, for the session's life.
  const capRules = cap === undefined ? [] : [cumulativeCap(32n, cap)]
  const approveActions = sourceTokens.flatMap((token): ScopedAction[] => {
    const spenders = spendersOf(token)
    if (spenders.length === 0) return []
    const spenderPins = anyOf(spenders.map((s) => allOf([pin(0n, s)])))
    return [
      spenders.length === 1
        ? swapAction(token, APPROVE_SELECTOR, [
            pin(0n, spenders[0]),
            ...capRules,
          ])
        : {
            target: token,
            selector: APPROVE_SELECTOR,
            policies: [
              {
                type: 'arg-policy',
                valueLimitPerUse: 0n,
                // One cap rule after the spender OR: the chain counts usage per
                // rule, so every layer draws on the same budget.
                expression:
                  cap === undefined
                    ? spenderPins
                    : {
                        type: 'and',
                        left: spenderPins,
                        right: allOf(capRules),
                      },
              },
            ],
          },
    ]
  })
  const actions = [
    ...scopedLayers.map(({ action }) => action),
    ...approveActions,
  ]
  // Fee calls only for tokens a kept route spends; ACROSS spends every one.
  const feeTokens = across
    ? sourceTokens
    : sourceTokens.filter((token) =>
        scopedLayers.some(({ tokens }) =>
          tokens.some((moved) => isAddressEqual(moved, token)),
        ),
      )
  // Every token that gets a fee call is validated here, and only those.
  const feeScope =
    fees === undefined
      ? undefined
      : recover(refuse, () =>
          servedFees(settlement, options.chainId, feeTokens),
        )
  return {
    actions:
      feeScope === undefined
        ? actions
        : withFeeActions(actions, feeTokens, feeScope),
    permissions: [],
    settlementLayers,
    dropped: [...skipped].map(([layer, reason]) => ({ layer, reason })),
  }
}
