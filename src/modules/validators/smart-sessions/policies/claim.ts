import { isAddressEqual } from 'viem'
import { getArbitersForSettlementLayers } from '../../policies/claim/arbiters'
import type {
  InternalPermit2ClaimPolicy,
  Permit2ClaimMessage,
} from '../../policies/claim/permit2'
import { refusal } from '../refusals'
import type {
  CrossChainPermit,
  Permit2ClaimPolicy,
  SessionPolicy,
} from '../types'

export function expandCrossChainPermit(
  permit: CrossChainPermit,
  environment: 'production' | 'development',
  onceDeadline?: bigint,
): {
  readonly claim: Permit2ClaimPolicy
  readonly fallbackPolicies: readonly SessionPolicy[]
} {
  // Unreachable ('all' is settlement-scoped); narrows the type for the arbiters.
  if (permit.settlementLayers === 'all') {
    throw refusal(
      'ALL_LAYERS_NO_PERMIT2_CLAIM',
      "crossChainPermits: settlementLayers 'all' names IntentExecutor layers, which have no Permit2 claim",
    )
  }
  if (permit.maxFeeBps !== undefined) {
    throw refusal(
      'MAX_FEE_BPS_ONLY_ECO',
      'crossChainPermits: maxFeeBps applies only to ECO_IE',
    )
  }
  if (permit.allowFees) {
    throw refusal(
      'ALLOW_FEES_ONLY_INTENT_EXECUTOR',
      'crossChainPermits: allowFees applies only to IntentExecutor layers',
    )
  }
  if (permit.to?.some((leg) => leg.minAmount !== undefined)) {
    throw refusal(
      'MIN_AMOUNT_ON_PERMIT2_LAYER',
      'crossChainPermits: `to.minAmount` does not apply to Permit2 layers',
    )
  }
  const sourceTokens = permit.from?.length
    ? permit.from.map(({ chain, token }) => ({ chain, address: token }))
    : undefined
  const destinationTokens = permit.to?.length
    ? permit.to.map(({ chain, token }) => ({ chain, address: token }))
    : undefined
  const recipientsList = (permit.to ?? [])
    .filter(({ recipient }) => recipient !== undefined)
    .map(({ chain, recipient }) => ({
      chain,
      address: recipient as `0x${string}` | 'any',
    }))
  // The once-policy refuses a settlement past its deadline, so the claim does too.
  const maxDeadline = onceDeadline ?? permit.validUntil
  const permitDeadline =
    permit.validAfter !== undefined || maxDeadline !== undefined
      ? { min: permit.validAfter, max: maxDeadline }
      : undefined
  const claim: Permit2ClaimPolicy = {
    type: 'permit2',
    spenders: getArbitersForSettlementLayers(
      permit.settlementLayers,
      environment === 'development',
    ),
    sourceTokens,
    destinationTokens,
    recipients: recipientsList.length ? recipientsList : undefined,
    recipientIsAccount: permit.recipientIsAccount,
    permitDeadline,
    fillDeadline: permit.fillDeadline,
  }
  const fallbackPolicies: SessionPolicy[] = []
  const limits = (permit.from ?? [])
    .filter(({ maxAmount }) => maxAmount !== undefined)
    .map(({ token, maxAmount }) => ({ token, amount: maxAmount as bigint }))
  if (limits.length) fallbackPolicies.push({ type: 'spending-limits', limits })
  return { claim, fallbackPolicies }
}

export function permit2ClaimPolicyMatchesMessage(
  policy: Permit2ClaimPolicy,
  message: Permit2ClaimMessage,
): boolean {
  if (
    policy.spenders?.length &&
    !policy.spenders.some((spender) => isAddressEqual(spender, message.spender))
  ) {
    return false
  }
  if (policy.sourceTokens?.length) {
    const allowed = new Set(
      policy.sourceTokens.map(({ address }) => address.toLowerCase()),
    )
    if (
      !message.permitted.every(({ token }) => allowed.has(token.toLowerCase()))
    ) {
      return false
    }
  }
  const targetChain = message.mandate.target.targetChain
  if (policy.destinationTokens?.length) {
    const allowed = new Set(
      policy.destinationTokens
        .filter(({ chain }) => BigInt(chain.id) === targetChain)
        .map(({ address }) => address.toLowerCase()),
    )
    if (
      !message.mandate.target.tokenOut.every(({ token }) =>
        allowed.has(token.toLowerCase()),
      )
    ) {
      return false
    }
  }
  if (policy.recipients?.length) {
    const recipients = policy.recipients.filter(
      ({ chain }) => BigInt(chain.id) === targetChain,
    )
    if (
      recipients.length &&
      !recipients.some(
        ({ address }) =>
          address === 'any' ||
          isAddressEqual(address, message.mandate.target.recipient),
      )
    ) {
      return false
    }
  }
  return true
}

export function selectPermit2ClaimPolicyForMessage(
  policies: readonly Permit2ClaimPolicy[],
  message: Permit2ClaimMessage,
): Permit2ClaimPolicy | undefined {
  if (policies.length <= 1) return policies[0]
  return (
    policies.find((policy) =>
      permit2ClaimPolicyMatchesMessage(policy, message),
    ) ?? policies[0]
  )
}

export function resolvePermit2ClaimPolicy(
  policy: Permit2ClaimPolicy,
): InternalPermit2ClaimPolicy {
  return {
    type: 'permit2-claim',
    arbiters: policy.spenders ? [...policy.spenders] : undefined,
    tokensIn: policy.sourceTokens?.map(({ chain, address }) => ({
      chainId: chain.id,
      token: address,
    })),
    tokensOut: policy.destinationTokens?.map(({ chain, address }) => ({
      chainId: chain.id,
      token: address,
    })),
    recipients: policy.recipients?.map(({ chain, address }) => ({
      chainId: chain.id,
      recipient: address,
    })),
    recipientIsSponsor: policy.recipientIsAccount,
    expiryBounds: policy.permitDeadline,
    fillExpiryBounds: policy.fillDeadline?.map(({ chain, min, max }) => ({
      chainId: chain.id,
      min,
      max,
    })),
  }
}
