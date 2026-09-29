import { type Address, isAddressEqual, toFunctionSelector } from 'viem'
import { FAR_FUTURE_MS } from '../../permissions'
import { pin, swapAction } from '../swap/rules'
import type {
  CrossChainPermit,
  CrossChainSettlementLayer,
  IntentExecutorSettlementLayer,
  ScopedAction,
  SessionPolicy,
} from '../types'
import { cctpTokenMessenger, scopeCctp } from './cctp'
import { oftAdapter, scopeOft } from './oft'
import type { SettlementContext } from './types'

/** Each layer's settlement contract on a chain and the scoped call it makes. */
const LAYERS: Record<
  IntentExecutorSettlementLayer,
  {
    readonly target: (chainId: number) => Address
    readonly scope: (ctx: SettlementContext) => ScopedAction
  }
> = {
  CCTP: { target: cctpTokenMessenger, scope: scopeCctp },
  OFT: { target: oftAdapter, scope: scopeOft },
}

/**
 * Settlement-scoped cross-chain permits (RHI-7826).
 *
 * A permit that names an IntentExecutor layer compiles to scoped actions with
 * its recipient, destination chain, token and amount pinned in each layer's
 * calldata. Those pins only bind when nothing else can run, so such a session
 * is restricted: the wildcard fallback is dropped and only the layer's approve
 * and settlement call remain.
 */

export const INTENT_EXECUTOR_SETTLEMENT_LAYERS = [
  'CCTP',
  'OFT',
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
  readonly account: Address | undefined
  readonly oneTimeUse: boolean
}

export interface ResolvedSettlementScope {
  readonly actions: ScopedAction[]
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
  // Each layer moves its own token (CCTP USDC, OFT USDT0), so one `from` leg
  // could never satisfy two of them.
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
  const destinations = permit.to.map(({ chain, token, recipient }) => ({
    chainId: chain.id,
    token,
    recipient: resolveRecipient(recipient),
  }))

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
  const target = LAYERS[layer].target(options.chainId)
  const layerAction = LAYERS[layer].scope({
    chainId: options.chainId,
    target,
    account: options.account,
    sourceTokens,
    destinations,
    cap,
    timeFrame,
  })

  // Only the layer's own approve: an unsponsored intent (paymaster approve and
  // callbackAllowMaxAmount) or one carrying an app fee (carve transfer) adds
  // calls this session does not authorise, so it cannot settle through it (v1).
  const approveActions = sourceTokens.map((token) =>
    withTimeFrame(swapAction(token, APPROVE_SELECTOR, [pin(0n, target)])),
  )
  return { actions: [layerAction, ...approveActions], settlementLayers }
}
