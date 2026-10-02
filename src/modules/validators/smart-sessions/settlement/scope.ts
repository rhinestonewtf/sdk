import { type Address, isAddressEqual, toFunctionSelector } from 'viem'
import { FAR_FUTURE_MS } from '../../permissions'
import { cumulativeCap, pin, swapAction } from '../swap/rules'
import type {
  CrossChainPermit,
  CrossChainSettlementLayer,
  IntentExecutorSettlementLayer,
  Permission,
  ScopedAction,
  SessionPolicy,
} from '../types'
import { scopeCctp } from './cctp'
import { scopeEco } from './eco'
import { scopeLz } from './lz'
import { scopeOft } from './oft'
import { scopeSameChain } from './same-chain'
import { served } from './served'
import type { SettlementCatalog, SettlementContext } from './types'

/**
 * Settlement-scoped cross-chain permits (RHI-7826).
 *
 * A permit that names an IntentExecutor layer compiles to scoped actions with
 * its recipient, destination chain, token and amount pinned in each layer's
 * calldata. Those pins only bind when nothing else can run, so such a session
 * is restricted: the wildcard fallback is dropped and only the layer's approve
 * and settlement call remain.
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

export function isSettlementScopedPermit(permit: CrossChainPermit): boolean {
  return permit.settlementLayers?.some(isIntentExecutorLayer) ?? false
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
  const layers = permit.settlementLayers ?? []
  const permit2Layers = layers.filter((layer) => !isIntentExecutorLayer(layer))
  if (permit2Layers.length) {
    throw new Error(
      `crossChainPermits: ${permit2Layers.join(', ')} cannot share a permit with IntentExecutor layers`,
    )
  }
  const settlementLayers = [...new Set(layers.filter(isIntentExecutorLayer))]
  // Each layer pins its own token set and call shape, so one permit scopes one
  // layer; a session that needs two uses two permits in two sessions.
  if (settlementLayers.length > 1) {
    throw new Error(
      'crossChainPermits: name one IntentExecutor layer per permit',
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
  // the session settles once.
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

  const timeFrame: SessionPolicy[] =
    permit.validAfter !== undefined || permit.validUntil !== undefined
      ? [
          {
            type: 'time-frame',
            validUntil:
              permit.validUntil === undefined
                ? FAR_FUTURE_MS
                : Number(permit.validUntil * 1000n),
            validAfter:
              permit.validAfter === undefined
                ? 0
                : Number(permit.validAfter * 1000n),
          },
        ]
      : []
  const withTimeFrame = (action: ScopedAction): ScopedAction => ({
    ...action,
    policies: [...(action.policies ?? []), ...timeFrame],
  })

  const [layer] = settlementLayers
  // Only ECO_IE prices its delivery against the reward; elsewhere the field would
  // be silently ignored.
  if (permit.maxFeeBps !== undefined && layer !== 'ECO_IE') {
    throw new Error('crossChainPermits: maxFeeBps applies only to ECO_IE')
  }
  if (
    layer !== 'SAME_CHAIN_IE' &&
    permit.to?.some((leg) => leg.minAmount !== undefined)
  ) {
    throw new Error(
      'crossChainPermits: `to.minAmount` applies only to a SAME_CHAIN_IE swap',
    )
  }
  if (layer === 'SAME_CHAIN_IE') {
    const sameChain = scopeSameChain({
      chainId: options.chainId,
      environment: options.environment,
      account: options.account,
      sourceTokens,
      destinations,
      cap,
      timeFrame,
      ...(permit.validAfter === undefined
        ? {}
        : { validAfter: permit.validAfter }),
      ...(permit.validUntil === undefined
        ? {}
        : { validUntil: permit.validUntil }),
    })
    return { ...sameChain, settlementLayers }
  }
  // No bundled fallback: the orchestrator is the one source for these addresses.
  // SAME_CHAIN_IE pins none of them, so only the layers below need it.
  const settlement = options.settlement
  if (settlement === undefined) {
    throw new Error(
      "crossChainPermits: IntentExecutor-layer permits need the orchestrator's settlement addresses; create the session with sdk.createSession",
    )
  }
  if (LAYERS[layer].requiresOneTimeUse && !options.oneTimeUse) {
    throw new Error(`crossChainPermits: an ${layer} permit requires oneTimeUse`)
  }
  const target = LAYERS[layer].target(settlement, options.chainId)
  const spender = LAYERS[layer].spender?.(settlement, options.chainId) ?? target
  const layerAction = LAYERS[layer].scope({
    chainId: options.chainId,
    settlement,
    target,
    account: options.account,
    sourceTokens,
    destinations,
    cap,
    timeFrame,
    ...(permit.maxFeeBps === undefined ? {} : { maxFeeBps: permit.maxFeeBps }),
    ...(permit.validUntil === undefined
      ? {}
      : { validUntil: permit.validUntil }),
  })

  // Only the layer's own approve: an unsponsored intent (paymaster approve and
  // callbackAllowMaxAmount) or one carrying an app fee (carve transfer) adds
  // calls this session does not authorise, so it cannot settle through it (v1).
  const approveActions = sourceTokens.map((token) =>
    withTimeFrame(
      swapAction(token, APPROVE_SELECTOR, [
        pin(0n, spender),
        // Cumulative: the burning transaction admits every op after the burn, so a
        // per-call bound would let repeated approves grant the cap many times.
        ...(cap === undefined ? [] : [cumulativeCap(32n, cap)]),
      ]),
    ),
  )
  return {
    actions: [layerAction, ...approveActions],
    permissions: [],
    settlementLayers,
  }
}
