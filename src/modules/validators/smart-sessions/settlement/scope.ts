import { type Address, isAddressEqual, toFunctionSelector } from 'viem'
import { allOf, anyOf, cumulativeCap, pin, swapAction } from '../swap/rules'
import type {
  CrossChainPermit,
  CrossChainSettlementLayer,
  IntentExecutorSettlementLayer,
  Permission,
  ScopedAction,
} from '../types'
import { scopeCctp } from './cctp'
import { scopeEco } from './eco'
import { servedFees, swapApprovesAsActions, withFeeActions } from './fees'
import { scopeLz } from './lz'
import { scopeOft } from './oft'
import { scopeSameChain } from './same-chain'
import { SettlementLayerRefusal, served } from './served'
import type { SettlementCatalog, SettlementContext } from './types'

/**
 * Settlement-scoped cross-chain permits (RHI-7826).
 *
 * A permit that names IntentExecutor layers compiles to scoped actions with
 * its recipient, destination chain, token and amount pinned in each layer's
 * calldata. Those pins only bind when nothing else can run, so such a session
 * is restricted: the wildcard fallback is dropped and only the layers'
 * settlement calls and their shared approve remain.
 */

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
    /**
     * Each call costs the account a native messaging fee no pin can bound, so
     * a reusable session could repeat dust sends until the balance is gone.
     */
    readonly requiresOneTimeUse?: true
  }
> = {
  CCTP: {
    target: (settlement, chainId) =>
      served(settlement, chainId, 'cctp').tokenMessenger,
    scope: scopeCctp,
  },
  OFT: {
    target: (settlement, chainId) => served(settlement, chainId, 'oft').adapter,
    scope: scopeOft,
    requiresOneTimeUse: true,
  },
  ECO_IE: {
    target: (settlement, chainId) => served(settlement, chainId, 'eco').portal,
    scope: scopeEco,
  },
  LZ: {
    target: (settlement, chainId) =>
      served(settlement, chainId, 'lz').multiCall,
    spender: (settlement, chainId) =>
      served(settlement, chainId, 'lz').transferDelegate,
    scope: scopeLz,
    requiresOneTimeUse: true,
  },
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

const APPROVE_SELECTOR = toFunctionSelector('approve(address,uint256)')

export interface SettlementScopeOptions {
  readonly chainId: number
  readonly environment: 'production' | 'development'
  readonly account: Address | undefined
  readonly oneTimeUse: boolean
  /** The orchestrator's `/chains` settlement addresses; IntentExecutor layers need them. */
  readonly settlement?: SettlementCatalog
}

export interface ResolvedSettlementScope {
  readonly actions: ScopedAction[]
  /** ABI-sugar permissions the layer adds (the SAME_CHAIN_IE swap's approve). */
  readonly permissions: Permission[]
  readonly settlementLayers: IntentExecutorSettlementLayer[]
  /** The latest deadline the once-policy may carry: the permit's validUntil. */
  readonly onceDeadline?: bigint
}

export function resolveSettlementScope(
  permits: readonly CrossChainPermit[],
  options: SettlementScopeOptions,
): ResolvedSettlementScope | undefined {
  const scoped = permits.filter(isSettlementScopedPermit)
  if (scoped.length === 0) return undefined
  if (scoped.length !== permits.length) {
    throw new Error(
      'crossChainPermits: a session cannot mix IntentExecutor-layer permits with Permit2-layer permits',
    )
  }
  if (scoped.length > 1) {
    throw new Error(
      'crossChainPermits: give at most one IntentExecutor-layer permit per session',
    )
  }
  const permit = scoped[0]
  // The one-time-use deadline bounds every action in time, so a window it cannot
  // carry is refused. A hard error, never a per-layer skip.
  if (
    permit.validAfter !== undefined ||
    (permit.validUntil !== undefined && !options.oneTimeUse)
  ) {
    throw new Error(
      'crossChainPermits: an IntentExecutor-layer permit supports validUntil only together with oneTimeUse, and does not support validAfter; set oneTimeUse with validUntil to bound the session',
    )
  }
  const named = permit.settlementLayers
  const all = named === 'all'
  const layers = all ? [...CROSS_CHAIN_LAYERS] : (named ?? [])
  const permit2Layers = layers.filter((layer) => !isIntentExecutorLayer(layer))
  if (permit2Layers.length) {
    throw new Error(
      `crossChainPermits: ${permit2Layers.join(', ')} cannot share a permit with IntentExecutor layers`,
    )
  }
  const requested = [...new Set(layers.filter(isIntentExecutorLayer))]
  // SAME_CHAIN_IE's transfer or swap shares no call shape with a bridge.
  if (requested.length > 1 && requested.includes('SAME_CHAIN_IE')) {
    throw new Error(
      'crossChainPermits: SAME_CHAIN_IE cannot share a permit with other IntentExecutor layers',
    )
  }

  const fromLegs = (permit.from ?? []).filter(
    (leg) => leg.chain.id === options.chainId,
  )
  if (fromLegs.length === 0) {
    throw new Error(
      `crossChainPermits: the permit names no \`from\` token on chain ${options.chainId}`,
    )
  }
  const caps = fromLegs.flatMap(({ maxAmount }) =>
    maxAmount === undefined ? [] : [maxAmount],
  )
  // Every scoped action keeps its own counter, so a cap is a total only when
  // the session settles once. With several layers each call is still capped on
  // its own; only the shared approve cap bounds what they draw together.
  if (caps.length && !options.oneTimeUse) {
    throw new Error(
      'crossChainPermits: maxAmount on an IntentExecutor-layer permit requires oneTimeUse',
    )
  }
  if (caps.length > 1) {
    throw new Error(
      'crossChainPermits: give maxAmount on at most one `from` token per chain',
    )
  }
  const cap = caps[0]
  const sourceTokens = fromLegs.map(({ token }) => token)

  const recipientIsAccount = permit.recipientIsAccount ?? true
  const resolveRecipient = (
    recipient: Address | 'any' | undefined,
  ): Address | undefined => {
    if (recipient === 'any') {
      if (recipientIsAccount) {
        throw new Error(
          "crossChainPermits: recipient 'any' requires allowRecipientNotAccount",
        )
      }
      return undefined
    }
    if (recipient === undefined || recipientIsAccount) {
      if (!options.account) {
        throw new Error(
          'crossChainPermits: pinning the recipient to the account needs `account` on the session definition',
        )
      }
      if (
        recipient !== undefined &&
        !isAddressEqual(recipient, options.account)
      ) {
        throw new Error(
          'crossChainPermits: a recipient other than the account requires allowRecipientNotAccount',
        )
      }
      return options.account
    }
    return recipient
  }
  // Without a destination pin the key picks the domain, and a burn to a domain
  // where the recipient cannot mint (e.g. Solana, whose recipient is an ATA)
  // is lost.
  if (!permit.to?.length) {
    throw new Error(
      'crossChainPermits: an IntentExecutor-layer permit must name its `to` chains',
    )
  }
  // fillDeadline bounds a Permit2 claim; no IntentExecutor layer carries one.
  if (permit.fillDeadline?.length) {
    throw new Error(
      'crossChainPermits: fillDeadline applies only to Permit2 layers',
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

  // resolve folds validUntil into the once-policy on every action. A deadline of
  // 0 would read as "never expires".
  if (permit.validUntil !== undefined && permit.validUntil <= 0n) {
    throw new Error(
      'crossChainPermits: an IntentExecutor-layer permit validUntil must be a valid Date in the future',
    )
  }
  const onceDeadline =
    permit.validUntil === undefined ? {} : { onceDeadline: permit.validUntil }

  const sameChainOnly = requested[0] === 'SAME_CHAIN_IE'
  // Only ECO_IE prices its delivery against the reward; elsewhere the field would
  // be silently ignored.
  if (permit.maxFeeBps !== undefined && !requested.includes('ECO_IE')) {
    throw new Error('crossChainPermits: maxFeeBps applies only to ECO_IE')
  }
  if (!sameChainOnly && permit.to?.some((leg) => leg.minAmount !== undefined)) {
    throw new Error(
      'crossChainPermits: `to.minAmount` applies only to a SAME_CHAIN_IE swap',
    )
  }
  const fees = permit.allowFees
    ? servedFees(options.settlement, options.chainId, sourceTokens)
    : undefined
  if (sameChainOnly) {
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
      return { ...sameChain, settlementLayers, ...onceDeadline }
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
      ...onceDeadline,
    }
  }
  // No bundled fallback: the orchestrator is the one source for these addresses.
  // SAME_CHAIN_IE pins none of them, so only the layers below need it.
  const settlement = options.settlement
  if (settlement === undefined) {
    throw new Error(
      "crossChainPermits: IntentExecutor-layer permits need the orchestrator's settlement addresses; create the session with sdk.createSession",
    )
  }
  const scopeLayer = (layer: (typeof CROSS_CHAIN_LAYERS)[number]) => {
    if (LAYERS[layer].requiresOneTimeUse && !options.oneTimeUse) {
      throw new SettlementLayerRefusal(
        `crossChainPermits: an ${layer} permit requires oneTimeUse`,
      )
    }
    const target = LAYERS[layer].target(settlement, options.chainId)
    const spender =
      LAYERS[layer].spender?.(settlement, options.chainId) ?? target
    const action = LAYERS[layer].scope({
      chainId: options.chainId,
      settlement,
      target,
      account: options.account,
      sourceTokens,
      destinations,
      cap,
      ...(permit.maxFeeBps === undefined
        ? {}
        : { maxFeeBps: permit.maxFeeBps }),
      ...(permit.validUntil === undefined
        ? {}
        : { validUntil: permit.validUntil }),
    })
    return { layer, spender, action }
  }
  // An explicit list is strict: a layer that cannot scope throws. 'all' keeps
  // only the layers that can; any other error still throws. A fixed order keeps
  // the session the same however the layers were listed.
  const skipped = new Map<string, string>()
  const scopedLayers = CROSS_CHAIN_LAYERS.filter((layer) =>
    requested.includes(layer),
  ).flatMap((layer) => {
    if (!all) return [scopeLayer(layer)]
    try {
      return [scopeLayer(layer)]
    } catch (error) {
      if (!(error instanceof SettlementLayerRefusal)) throw error
      skipped.set(layer, error.message.replace(/^crossChainPermits: /, ''))
      return []
    }
  })
  const ecoSkipped = skipped.get('ECO_IE')
  if (permit.maxFeeBps !== undefined && ecoSkipped !== undefined) {
    throw new Error(
      `crossChainPermits: maxFeeBps asks for ECO_IE, which cannot settle this permit: ${ecoSkipped}`,
    )
  }
  if (scopedLayers.length === 0) {
    throw new Error(
      `crossChainPermits: no IntentExecutor layer can settle this permit on chain ${options.chainId} (${[
        ...skipped,
      ]
        .map(([layer, reason]) => `${layer}: ${reason}`)
        .join('; ')})`,
    )
  }
  // Each layer's call allows one send, but one burning transaction admits both,
  // and each pays a native fee no pin bounds.
  const feePaying = scopedLayers.filter(
    ({ layer }) => LAYERS[layer].requiresOneTimeUse,
  )
  if (feePaying.length > 1) {
    throw new Error(
      `crossChainPermits: ${feePaying.map(({ layer }) => layer).join(' and ')} each pay a native LayerZero fee, so a permit may use only one of them; name the layers to keep`,
    )
  }
  const settlementLayers = scopedLayers.map(({ layer }) => layer)
  const spenders = scopedLayers
    .map(({ spender }) => spender)
    .filter(
      (spender, i, list) =>
        list.findIndex((other) => isAddressEqual(other, spender)) === i,
    )

  // Without allowFees, only the layers' own approves: an unsponsored intent or
  // one carrying an app fee adds calls this session does not authorise.
  // Cumulative: the burning transaction admits every op after the burn, so a
  // per-call bound would let repeated approves grant the cap many times.
  const capRules = cap === undefined ? [] : [cumulativeCap(32n, cap)]
  const spenderPins = anyOf(spenders.map((s) => allOf([pin(0n, s)])))
  const approveActions = sourceTokens.map(
    (token): ScopedAction =>
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
  )
  const actions = [
    ...scopedLayers.map(({ action }) => action),
    ...approveActions,
  ]
  return {
    actions:
      fees === undefined
        ? actions
        : withFeeActions(actions, sourceTokens, fees),
    permissions: [],
    settlementLayers,
    ...onceDeadline,
  }
}
