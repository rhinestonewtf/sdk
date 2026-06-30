import {
  type Address,
  type Chain,
  concat,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  toHex,
  zeroAddress,
} from 'viem'
import type { IntentExecutorClaimPolicy } from '../../../../types'
import {
  getSettlementLayerInfra,
  RELAY_LAYER_ID,
  type SettlementLayerInfra,
} from '../../../chain-abstraction'

// On-chain policy: smart-sessions-v2 `IntentExecutorPolicy` (ownable variant).
// This module is the IntentExecutor analog of `permit2.ts`: it turns the
// declarative `IntentExecutorClaimPolicy` into the two byte blobs the policy
// consumes — the install-time init blob and the signing-time data blob — while
// resolving all settlement-layer infrastructure (executor address, enabled
// layers, adapter configs) internally so callers never see it.

// TODO(intent-executor): replace with the deployed `IntentExecutorPolicy`
// address(es) before merge. Confirm whether dev and prod differ (the Permit2
// claim policy shares one address across environments).
export const INTENT_EXECUTOR_CLAIM_POLICY_ADDRESS: Address =
  '0x5555555555555555555555555555555555555555'

/** Variant byte: v1 supports SingleChainOps only. */
const VARIANT_SINGLE_CHAIN = 0
/** flags bit0: require a non-empty GasRefund on every signed op. */
const FLAG_REQUIRE_GAS_REFUND = 1 << 0
/** flags bit1: pin the policy to the installing account. */
const FLAG_LOCK_ACCOUNT = 1 << 1

/**
 * Typed representation of the `SingleChainOps` message fields used to build the
 * signing-time data blob. Matches the message produced by
 * `execution/singleChainOps.ts`.
 */
export interface IntentExecutorClaimMessage {
  account: Address
  nonce: bigint
  op: {
    vt: Hex
    ops: readonly { to: Address; value: bigint; data: Hex }[]
  }
  /**
   * Gas refund the relayer signed over. A zero-address token (or absence) means
   * "no gas refund" — the policy substitutes the `NO_GASREFUND` sentinel.
   */
  gasRefund?: {
    token: Address
    exchangeRate: bigint
    overhead: bigint
  }
}

// --- helpers ---

/** Packs a length-prefixed address list: [count:1][addr:20]... */
function encodeAddressList(addresses: readonly Address[]): Hex {
  if (addresses.length > 255) {
    throw new Error('address list exceeds max length of 255')
  }
  return concat([
    toHex(addresses.length, { size: 1 }),
    ...addresses.map((a) => encodePacked(['address'], [a])),
  ])
}

/**
 * Builds the Relay adapter config blob.
 *
 * Layout (matches `RelayAdapter._scan`):
 *   [0:20]  relayRouter
 *   [20:40] intentExecutorAdapter
 *   [40]    recipientCount (uint8) + recipients (20 bytes each)
 *   [..]    tokenCount (uint8) + tokens (20 bytes each)
 */
function encodeRelayAdapterConfig(
  infra: SettlementLayerInfra,
  recipients: readonly Address[],
  tokens: readonly Address[],
): Hex {
  return concat([
    encodePacked(
      ['address', 'address'],
      [infra.relayRouter, infra.intentExecutorAdapter],
    ),
    encodeAddressList(recipients),
    encodeAddressList(tokens),
  ])
}

/** Dispatches to the right adapter-config encoder for an enabled layer. */
function encodeAdapterConfig(
  infra: SettlementLayerInfra,
  recipients: readonly Address[],
  tokens: readonly Address[],
): Hex {
  if (infra.layerId === RELAY_LAYER_ID) {
    return encodeRelayAdapterConfig(infra, recipients, tokens)
  }
  // CCTP / Rhino adapter config layouts differ and are not wired yet — they are
  // not returned by getSettlementLayerInfra in v1, so this is unreachable today.
  throw new Error(`unsupported settlement-layer adapter: ${infra.layerId}`)
}

/**
 * Encodes the init blob for the ownable IntentExecutor claim policy.
 *
 * Layout (base header + ownable layer tail):
 *   [0:20]   intentExecutor
 *   [20]     flags (uint8)
 *   [21:53]  maxExchangeRate (uint256)
 *   [53]     gasTokenCount (uint8) + gasTokens (20 bytes each)
 *   [..]     layerCount (uint8)
 *   per layer: layerId (bytes32) | configLen (uint16) | configBytes
 */
export function encodeIntentExecutorClaimPolicyInitData(
  policy: IntentExecutorClaimPolicy,
  chain: Chain,
  intentExecutor: Address,
  useDevContracts?: boolean,
): Hex {
  let flags = 0
  if (policy.requireGasRefund) flags |= FLAG_REQUIRE_GAS_REFUND
  if (policy.lockAccount) flags |= FLAG_LOCK_ACCOUNT

  // Constraints are declared per-chain; the policy is installed per-chain, so we
  // emit only the entries that apply to this session's chain.
  const gasTokens = (policy.gasTokens ?? [])
    .filter((g) => g.chainId === chain.id)
    .map((g) => g.token)
  const tokensOut = (policy.tokensOut ?? [])
    .filter((t) => t.chainId === chain.id)
    .map((t) => t.token)
  const recipients = (policy.recipients ?? [])
    .filter((r) => r.chainId === chain.id)
    .map((r) => r.recipient)

  const layers = getSettlementLayerInfra(chain.id, useDevContracts)
  if (layers.length > 255) {
    throw new Error('settlement layer count exceeds max length of 255')
  }

  const layerTail: Hex[] = [toHex(layers.length, { size: 1 })]
  for (const infra of layers) {
    const config = encodeAdapterConfig(infra, recipients, tokensOut)
    layerTail.push(
      // configLen is a uint16; (size - 2) drops the leading "0x".
      encodePacked(
        ['bytes32', 'uint16'],
        [infra.layerId, (config.length - 2) / 2],
      ),
      config,
    )
  }

  return concat([
    encodePacked(['address', 'uint8'], [intentExecutor, flags]),
    toHex(policy.maxExchangeRate ?? 0n, { size: 32 }),
    encodeAddressList(gasTokens),
    ...layerTail,
  ])
}

/**
 * ABI-encodes a `Types.Operation { bytes32 vt; Ops[] ops }` so its first byte is
 * the head of the struct (vt), matching the policy's `_decodeOperation`, which
 * casts `data[cursor:].offset` directly to an `Operation calldata` pointer.
 *
 * We encode `vt` and `ops` as two separate parameters (not a wrapping tuple) on
 * purpose: a single dynamic tuple would prepend an outer offset word, but the
 * policy expects the struct head with no leading offset.
 */
function encodeOperation(op: IntentExecutorClaimMessage['op']): Hex {
  return encodeAbiParameters(
    [
      { name: 'vt', type: 'bytes32' },
      {
        name: 'ops',
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    [op.vt, op.ops.map((o) => ({ to: o.to, value: o.value, data: o.data }))],
  )
}

/**
 * Derives the per-call layer-hint vector. Each hint is a uint8 index into the
 * session's installed layers (install order from getSettlementLayerInfra).
 *
 * v1 enables a single layer (Relay), so every hint is 0. Multi-layer hint
 * inference (matching each call's target to the owning adapter) is deferred
 * until additional adapters ship; we refuse to guess rather than emit hints the
 * policy would reject.
 */
function deriveLayerHints(
  callCount: number,
  layers: SettlementLayerInfra[],
): number[] {
  if (layers.length <= 1) {
    return new Array(callCount).fill(0)
  }
  // TODO(intent-executor): infer per-call layer hints once CCTP/Rhino adapters
  // are enabled and the orchestrator surfaces a fill's settlement sub-layer.
  throw new Error(
    'multi-layer IntentExecutor hint inference is not yet supported',
  )
}

/**
 * Builds the signing-time data blob (policySpecificData) the policy validates
 * against the EIP-1271 digest.
 *
 * Layout (base header + ABI(Operation) + ownable hint tail):
 *   [0]       variant (0 = SingleChainOps)
 *   [1]       hasGasRefund (0/1)
 *   [2:22]    account
 *   [22:54]   nonce
 *   -- iff hasGasRefund == 1 --
 *   [54:74]   gasRefund.token
 *   [74:106]  gasRefund.exchangeRate
 *   [106:138] gasRefund.overhead
 *   --
 *   [...]     ABI-encoded Operation
 *   callCount (uint8) + layerHints (uint8 each)
 */
export function buildIntentExecutorClaimPolicyCalldata(
  _policy: IntentExecutorClaimPolicy,
  message: IntentExecutorClaimMessage,
  chain: Chain,
  useDevContracts?: boolean,
): Hex {
  // A zero-address gas-refund token is the executor's "no gas refund" signal;
  // the policy then expects the NO_GASREFUND sentinel rather than a hashed
  // GasRefund. NOTE: this assumes the deployed contract carries the 32-byte
  // `overhead` field in the gas-refund section (cursor 106 -> 138) — see the
  // overhead divergence flagged for the contracts team.
  const gasRefund = message.gasRefund
  const hasGasRefund = gasRefund != null && gasRefund.token !== zeroAddress

  const header = encodePacked(
    ['uint8', 'uint8', 'address', 'uint256'],
    [
      VARIANT_SINGLE_CHAIN,
      hasGasRefund ? 1 : 0,
      message.account,
      message.nonce,
    ],
  )

  const gasRefundSection: Hex =
    hasGasRefund && gasRefund
      ? encodePacked(
          ['address', 'uint256', 'uint256'],
          [gasRefund.token, gasRefund.exchangeRate, gasRefund.overhead],
        )
      : '0x'

  const operation = encodeOperation(message.op)

  const layers = getSettlementLayerInfra(chain.id, useDevContracts)
  const callCount = message.op.ops.length
  if (callCount > 255) {
    throw new Error('ops count exceeds max length of 255')
  }
  const hints = deriveLayerHints(callCount, layers)
  const hintTail = concat([
    toHex(callCount, { size: 1 }),
    ...hints.map((h) => toHex(h, { size: 1 })),
  ])

  return concat([header, gasRefundSection, operation, hintTail])
}
