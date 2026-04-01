import {
  type Address,
  concat,
  encodeAbiParameters,
  encodePacked,
  type Hex,
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

// Precomputed EIP-712 type hashes for Permit2/Mandate struct encoding
const TYPEHASH_PERMIT2_TOKEN: Hex =
  '0x618358ac3db8dc274f0cd8829da7e234bd48cd73c4a740aede1adec9846d06a1'
const TYPEHASH_TOKENOUT: Hex =
  '0x55550a068ac7a6c7ce02eac46ebe7c7b964dd10d7800455df1c5bc5a6685a42c'
const TYPEHASH_TARGET: Hex =
  '0xf72802bb5695954ab337feb3d113d61f4206cfaef3987552df2b2b47477db74b'
const TYPEHASH_OPS: Hex =
  '0x09b0a32e9842b65559835c235891737e06927d59e48a6f0e0512e136a513a9e4'
const TYPEHASH_OP: Hex =
  '0xdbc520cb50a8aaf3fa06ea43dc3d59d248e52ae638476e3268a1e6e36bffe196'
const TYPEHASH_MANDATE: Hex =
  '0xc988b4da10503879cf4b893fed09620229f5ade301ef5e4af6124b22823627dc'

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

function hashSingleTokenPermission(token: Address, amount: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
      [TYPEHASH_PERMIT2_TOKEN, token, amount],
    ),
  )
}

function hashTokenPermissionsArray(
  permitted: readonly { token: Address; amount: bigint }[],
): Hex {
  return hashArray(
    permitted.map(({ token, amount }) =>
      hashSingleTokenPermission(token, amount),
    ),
  )
}

function hashSingleTokenOut(token: Address, amount: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
      [TYPEHASH_TOKENOUT, token, amount],
    ),
  )
}

function hashTokenOutArray(
  tokenOut: readonly { token: Address; amount: bigint }[],
): Hex {
  return hashArray(
    tokenOut.map(({ token, amount }) => hashSingleTokenOut(token, amount)),
  )
}

function hashSingleExec(exec: { to: Address; value: bigint; data: Hex }): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes32' },
      ],
      [TYPEHASH_OPS, exec.to, exec.value, keccak256(exec.data)],
    ),
  )
}

function hashOpStruct(op: {
  vt: Hex
  ops: readonly { to: Address; value: bigint; data: Hex }[]
}): Hex {
  const opsArrayHash = hashArray(Array.from(op.ops).map(hashSingleExec))
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
      [TYPEHASH_OP, op.vt, opsArrayHash],
    ),
  )
}

function hashTargetStruct(
  recipient: Address,
  tokenOutHash: Hex,
  targetChain: bigint,
  fillExpiry: bigint,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'uint256' },
      ],
      [TYPEHASH_TARGET, recipient, tokenOutHash, targetChain, fillExpiry],
    ),
  )
}

function hashMandateStruct(
  targetHash: Hex,
  minGas: bigint,
  originOpsHash: Hex,
  destOpsHash: Hex,
  q: Hex,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint128' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
      ],
      [TYPEHASH_MANDATE, targetHash, minGas, originOpsHash, destOpsHash, q],
    ),
  )
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
 * All claim policies in a session must share the same mode configuration; this
 * function uses the first policy when multiple are provided.
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
    const tokenOutHash = hashTokenOutArray(message.mandate.target.tokenOut)
    const targetHash = hashTargetStruct(
      message.mandate.target.recipient,
      tokenOutHash,
      message.mandate.target.targetChain,
      message.mandate.target.fillExpiry,
    )
    const originOpsHash = hashOpStruct(message.mandate.originOps)
    const destOpsHash = hashOpStruct(message.mandate.destOps)
    parts.push(
      hashMandateStruct(
        targetHash,
        message.mandate.minGas,
        originOpsHash,
        destOpsHash,
        message.mandate.q,
      ),
    )
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
