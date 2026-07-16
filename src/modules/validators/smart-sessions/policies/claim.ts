import { isAddressEqual } from 'viem'
import { FAR_FUTURE_MS } from '../../permissions'
import { getArbitersForSettlementLayers } from '../../policies/claim/arbiters'
import type {
  InternalPermit2ClaimPolicy,
  Permit2ClaimMessage,
} from '../../policies/claim/permit2'
import type {
  CrossChainPermit,
  Permit2ClaimPolicy,
  SessionPolicy,
} from '../types'

export function expandCrossChainPermit(
  permit: CrossChainPermit,
  environment: 'production' | 'development',
): {
  readonly claim: Permit2ClaimPolicy
  readonly fallbackPolicies: readonly SessionPolicy[]
} {
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
  const permitDeadline =
    permit.validAfter !== undefined || permit.validUntil !== undefined
      ? { min: permit.validAfter, max: permit.validUntil }
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
  if (permitDeadline) {
    fallbackPolicies.push({
      type: 'time-frame',
      validUntil:
        permit.validUntil === undefined
          ? FAR_FUTURE_MS
          : Number(permit.validUntil * 1000n),
      validAfter:
        permit.validAfter === undefined ? 0 : Number(permit.validAfter * 1000n),
    })
  }
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
