import type { Address } from 'viem'
import type {
  IntentExecutorClaimPolicy,
  Permit2ClaimPolicy,
  SessionClaimPolicy,
  SessionSettlementLayer,
} from '../../../../types'

// Translates the public, settlement-layer-keyed `SessionClaimPolicy` into the
// mechanism-shaped configs the on-chain encoders consume. This is the only place
// that knows a settlement layer maps to a claim mechanism, keeping that detail
// out of the public API.

/** Claim mechanism backing each settlement layer. */
type ClaimMechanism = 'permit2' | 'intent-executor'

const LAYER_MECHANISM: Record<SessionSettlementLayer, ClaimMechanism> = {
  across: 'permit2',
  relay: 'intent-executor',
}

/** Every settlement layer the SDK supports today. `'any'` expands to this. */
export const ALL_SETTLEMENT_LAYERS: SessionSettlementLayer[] = [
  'across',
  'relay',
]

/**
 * Detects the deprecated, tagged `{ type: 'permit2-claim' }` shape that the SDK
 * still accepts for backward compatibility. It is treated as Across-only.
 */
function isLegacyPermit2(
  policy: SessionClaimPolicy,
): policy is Permit2ClaimPolicy {
  return 'type' in policy && policy.type === 'permit2-claim'
}

/** Resolves the concrete layer list a policy authorizes (`'any'`/omitted → all). */
function resolveLayers(policy: SessionClaimPolicy): SessionSettlementLayer[] {
  // Legacy Permit2 policies are Across-only by definition.
  if (isLegacyPermit2(policy)) {
    return ['across']
  }
  if (!policy.settlementLayers || policy.settlementLayers === 'any') {
    return ALL_SETTLEMENT_LAYERS
  }
  return policy.settlementLayers
}

/** The set of claim mechanisms a policy authorizes. */
export function mechanismsFor(policy: SessionClaimPolicy): Set<ClaimMechanism> {
  return new Set(resolveLayers(policy).map((l) => LAYER_MECHANISM[l]))
}

/** True when the policy authorizes the Permit2 (Across) mechanism. */
export function coversPermit2(policy: SessionClaimPolicy): boolean {
  return mechanismsFor(policy).has('permit2')
}

/** True when the policy authorizes the IntentExecutor (Relay) mechanism. */
export function coversIntentExecutor(policy: SessionClaimPolicy): boolean {
  return mechanismsFor(policy).has('intent-executor')
}

/** Builds the Permit2 mechanism config from a unified policy. */
export function toPermit2ClaimPolicy(
  policy: SessionClaimPolicy,
): Permit2ClaimPolicy {
  // The legacy shape already is a Permit2 config — pass it through unchanged.
  if (isLegacyPermit2(policy)) {
    return policy
  }
  return {
    type: 'permit2-claim',
    arbiters: policy.arbiters,
    tokensIn: policy.tokensIn,
    tokensOut: policy.tokensOut,
    recipients: policy.recipients,
    recipientIsSponsor: policy.recipientIsSponsor,
    expiryBounds: policy.expiryBounds,
    fillExpiryBounds: policy.fillExpiryBounds,
  }
}

/** Builds the IntentExecutor mechanism config from a unified policy. */
export function toIntentExecutorClaimPolicy(
  policy: SessionClaimPolicy,
): IntentExecutorClaimPolicy {
  // Legacy Permit2 policies never cover the IntentExecutor mechanism, so this is
  // unreachable in practice; return an empty config to satisfy the type.
  if (isLegacyPermit2(policy)) {
    return { type: 'intent-executor-claim' }
  }
  // The Relay adapter recipient whitelist has no wildcard, so 'any' recipients
  // (a Permit2-only feature) are dropped for the IntentExecutor mechanism.
  const recipients = policy.recipients
    ?.filter((r) => r.recipient !== 'any')
    .map((r) => ({ chainId: r.chainId, recipient: r.recipient as Address }))
  return {
    type: 'intent-executor-claim',
    gasTokens: policy.gasTokens,
    maxExchangeRate: policy.maxExchangeRate,
    requireGasRefund: policy.requireGasRefund,
    lockAccount: policy.lockAccount,
    tokensOut: policy.tokensOut,
    recipients,
  }
}
