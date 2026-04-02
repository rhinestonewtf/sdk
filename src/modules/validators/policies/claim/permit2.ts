import {
  type Address,
  concat,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  hashStruct,
  keccak256,
  maxUint256,
  toHex,
} from 'viem'
import type { Permit2ClaimPolicy } from '../../../../types'
import {
  ANY_ADDRESS,
  FIELD_ARBITER,
  FIELD_EXPIRY,
  FIELD_FILL_EXPIRY,
  FIELD_RECIPIENT,
  FIELD_RECIPIENT_IS_SPONSOR,
  FIELD_TOKEN_IN,
  FIELD_TOKEN_OUT,
  MODE_CHECK_STORAGE,
} from './types'

// EIP-712 type definitions for Permit2/Mandate struct encoding.
// Note: the token-out struct is named 'Token' in the Solidity contract (matching the
// signed Permit2 message types in execution/permit2.ts).
const PERMIT2_TYPES = {
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  Token: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  Ops: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
  Op: [
    { name: 'vt', type: 'bytes32' },
    { name: 'ops', type: 'Ops[]' },
  ],
  Target: [
    { name: 'recipient', type: 'address' },
    { name: 'tokenOut', type: 'Token[]' },
    { name: 'targetChain', type: 'uint256' },
    { name: 'fillExpiry', type: 'uint256' },
  ],
  Mandate: [
    { name: 'target', type: 'Target' },
    { name: 'minGas', type: 'uint128' },
    { name: 'originOps', type: 'Op' },
    { name: 'destOps', type: 'Op' },
    { name: 'q', type: 'bytes32' },
  ],
} as const

/** Typed representation of the Permit2 message fields used for calldata building */
export interface Permit2ClaimMessage {
  permitted: readonly { token: Address; amount: bigint }[]
  spender: Address
  nonce: bigint
  deadline: bigint
  mandate: {
    target: {
      recipient: Address
      tokenOut: readonly { token: Address; amount: bigint }[]
      targetChain: bigint
      fillExpiry: bigint
    }
    minGas: bigint
    originOps: {
      vt: Hex
      ops: readonly { to: Address; value: bigint; data: Hex }[]
    }
    destOps: {
      vt: Hex
      ops: readonly { to: Address; value: bigint; data: Hex }[]
    }
    q: Hex
  }
}

// --- EIP-712 hash helpers ---

function hashArray(hashes: Hex[]): Hex {
  return keccak256(hashes.length > 0 ? concat(hashes) : '0x')
}

function hashTokenPermissionsArray(
  permitted: readonly { token: Address; amount: bigint }[],
): Hex {
  return hashArray(
    permitted.map(({ token, amount }) =>
      hashStruct({
        primaryType: 'TokenPermissions',
        types: PERMIT2_TYPES,
        data: { token, amount },
      }),
    ),
  )
}

function hashTokenOutArray(
  tokenOut: readonly { token: Address; amount: bigint }[],
): Hex {
  return hashArray(
    tokenOut.map(({ token, amount }) =>
      hashStruct({
        primaryType: 'Token',
        types: PERMIT2_TYPES,
        data: { token, amount },
      }),
    ),
  )
}

function hashOpStruct(op: {
  vt: Hex
  ops: readonly { to: Address; value: bigint; data: Hex }[]
}): Hex {
  return hashStruct({
    primaryType: 'Op',
    types: PERMIT2_TYPES,
    data: { vt: op.vt, ops: Array.from(op.ops) },
  })
}

function hashMandateStruct(mandate: Permit2ClaimMessage['mandate']): Hex {
  return hashStruct({
    primaryType: 'Mandate',
    types: PERMIT2_TYPES,
    data: {
      target: {
        recipient: mandate.target.recipient,
        tokenOut: Array.from(mandate.target.tokenOut),
        targetChain: mandate.target.targetChain,
        fillExpiry: mandate.target.fillExpiry,
      },
      minGas: mandate.minGas,
      originOps: {
        vt: mandate.originOps.vt,
        ops: Array.from(mandate.originOps.ops),
      },
      destOps: { vt: mandate.destOps.vt, ops: Array.from(mandate.destOps.ops) },
      q: mandate.q,
    },
  })
}

// --- Token array encoding helpers ---

/** Encodes a token+amount pair as [token_as_uint256:32][amount:32] (64 bytes) */
function encodeTokenEntry(token: Address, amount: bigint): Hex {
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [token, amount],
  )
}

/**
 * Builds the policySpecificData calldata for a Permit2ClaimPolicy EIP-1271 check.
 *
 * Format (derived from Permit2ClaimPolicy.sol calldata layout):
 *   Header:  [spender:20][nonce:32][deadline:32]
 *   TokenIn: expanded [count:1][token:32][amount:32]... OR pre-computed hash [32]
 *   Mandate: if any target check enabled — expanded target + minGas:16 + ops hashes + q
 *            else — pre-computed mandateHash [32]
 *
 */
export function buildPermit2ClaimPolicyCalldata(
  policy: Permit2ClaimPolicy,
  message: Permit2ClaimMessage,
): Hex {
  const tokenInEnabled = !!policy.tokensIn?.length
  const recipientEnabled = !!policy.recipients?.length
  const fillExpiryEnabled = !!policy.fillExpiryBounds?.length
  const tokenOutEnabled = !!policy.tokensOut?.length
  const recipientIsSponsorEnabled = !!policy.recipientIsSponsor

  // hasAnyTargetCheck mirrors the Solidity MASK_TARGET_CHECKS logic for our supported fields
  const hasAnyTargetCheck =
    recipientEnabled ||
    fillExpiryEnabled ||
    tokenOutEnabled ||
    recipientIsSponsorEnabled

  const parts: Hex[] = []

  // Header: [spender:20][nonce:32][deadline:32]  (spender == arbiter in Permit2 context)
  parts.push(
    encodePacked(
      ['address', 'uint256', 'uint256'],
      [message.spender, message.nonce, message.deadline],
    ),
  )

  // TokenIn section
  if (tokenInEnabled) {
    // Expanded: [count:1][token_as_uint256:32][amount:32]...
    if (message.permitted.length > 255)
      throw new Error('permitted array exceeds max length of 255')
    parts.push(toHex(message.permitted.length, { size: 1 }))
    for (const { token, amount } of message.permitted) {
      parts.push(encodeTokenEntry(token, amount))
    }
  } else {
    parts.push(hashTokenPermissionsArray(message.permitted))
  }

  // Mandate section
  if (!hasAnyTargetCheck) {
    // No mandate-level checks enabled — provide pre-computed mandateHash
    parts.push(hashMandateStruct(message.mandate))
  } else {
    // Expanded mandate: target fields + minGas + ops hashes + q
    const target = message.mandate.target

    // Target: [recipient:20][targetChain:32][fillExpiry:32]
    parts.push(
      encodePacked(
        ['address', 'uint256', 'uint256'],
        [target.recipient, target.targetChain, target.fillExpiry],
      ),
    )

    // TokenOut (inside target)
    if (tokenOutEnabled) {
      if (target.tokenOut.length > 255)
        throw new Error('tokenOut array exceeds max length of 255')
      parts.push(toHex(target.tokenOut.length, { size: 1 }))
      for (const { token, amount } of target.tokenOut) {
        parts.push(encodeTokenEntry(token, amount))
      }
    } else {
      parts.push(hashTokenOutArray(target.tokenOut))
    }

    // minGas: uint128 = 16 bytes
    parts.push(toHex(message.mandate.minGas, { size: 16 }))
    // originOpsHash and destOpsHash: always 32-byte hashes (we don't support ops checks)
    parts.push(hashOpStruct(message.mandate.originOps))
    parts.push(hashOpStruct(message.mandate.destOps))
    // qualificationHash: q is already keccak256(qualifier.encodedVal)
    parts.push(message.mandate.q)
  }

  return concat(parts)
}

export const PERMIT2_CLAIM_POLICY_ADDRESS: Address =
  '0x62E3588C6d861C9f986E82EC3757434EDF16ce91'

export function encodePermit2ClaimPolicyInitData(
  policy: Permit2ClaimPolicy,
): Hex {
  let modeConfig = 0

  const setMode = (fieldId: number) => {
    modeConfig |= MODE_CHECK_STORAGE << (fieldId * 2)
  }

  if (policy.arbiters?.length) setMode(FIELD_ARBITER)
  if (policy.expiryBounds) setMode(FIELD_EXPIRY)
  if (policy.tokensIn?.length) setMode(FIELD_TOKEN_IN)
  if (policy.recipients?.length) setMode(FIELD_RECIPIENT)
  if (policy.fillExpiryBounds?.length) setMode(FIELD_FILL_EXPIRY)
  if (policy.tokensOut?.length) setMode(FIELD_TOKEN_OUT)
  if (policy.recipientIsSponsor) setMode(FIELD_RECIPIENT_IS_SPONSOR)

  const parts: Hex[] = [toHex(modeConfig, { size: 4 })]

  // Arbiter: [count: 1][address: 20] each
  if (policy.arbiters?.length) {
    if (policy.arbiters.length > 255)
      throw new Error('arbiters array exceeds max length of 255')
    parts.push(
      encodePacked(
        ['uint8', ...policy.arbiters.map(() => 'address' as const)],
        [policy.arbiters.length, ...policy.arbiters],
      ),
    )
  }

  // Expiry: [maxExpiry: 16][minExpiry: 16] packed into uint256
  if (policy.expiryBounds) {
    const mask128 = (1n << 128n) - 1n
    const min = (policy.expiryBounds.min ?? 0n) & mask128
    const max = (policy.expiryBounds.max ?? maxUint256) & mask128
    parts.push(toHex((min & mask128) | (max << 128n), { size: 32 }))
  }

  // TokenIn: [count: 1][chainId: 32][token: 20] each
  if (policy.tokensIn?.length) {
    if (policy.tokensIn.length > 255)
      throw new Error('tokensIn array exceeds max length of 255')
    parts.push(toHex(policy.tokensIn.length, { size: 1 }))
    for (const { chainId, token } of policy.tokensIn) {
      parts.push(encodePacked(['uint256', 'address'], [BigInt(chainId), token]))
    }
  }

  // Recipient: [count: 1][chainId: 32][recipient: 20] each
  if (policy.recipients?.length) {
    if (policy.recipients.length > 255)
      throw new Error('recipients array exceeds max length of 255')
    parts.push(toHex(policy.recipients.length, { size: 1 }))
    for (const { chainId, recipient } of policy.recipients) {
      parts.push(
        encodePacked(
          ['uint256', 'address'],
          [BigInt(chainId), recipient === 'any' ? ANY_ADDRESS : recipient],
        ),
      )
    }
  }

  // FillExpiry: [count: 1][chainId: 32][max<<128|min packed into uint256] each
  if (policy.fillExpiryBounds?.length) {
    if (policy.fillExpiryBounds.length > 255)
      throw new Error('fillExpiryBounds array exceeds max length of 255')
    const mask128 = (1n << 128n) - 1n
    parts.push(toHex(policy.fillExpiryBounds.length, { size: 1 }))
    for (const { chainId, min: fMin, max: fMax } of policy.fillExpiryBounds) {
      const minVal = (fMin ?? 0n) & mask128
      const maxVal = (fMax ?? maxUint256) & mask128
      const packed = minVal | (maxVal << 128n)
      parts.push(
        encodePacked(['uint256', 'uint256'], [BigInt(chainId), packed]),
      )
    }
  }

  // TokenOut: [count: 1][chainId: 32][token: 20] each
  if (policy.tokensOut?.length) {
    if (policy.tokensOut.length > 255)
      throw new Error('tokensOut array exceeds max length of 255')
    parts.push(toHex(policy.tokensOut.length, { size: 1 }))
    for (const { chainId, token } of policy.tokensOut) {
      parts.push(encodePacked(['uint256', 'address'], [BigInt(chainId), token]))
    }
  }

  // RecipientIsSponsor has no data payload — mode bit alone enables it

  return concat(parts)
}
