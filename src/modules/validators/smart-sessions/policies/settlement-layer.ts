import {
  type Address,
  concat,
  type Hex,
  keccak256,
  pad,
  size,
  toBytes,
  toHex,
} from 'viem'

// IntentExecutor settlement-layer policy (smart-sessions-v2 #46 / PR #54): an
// EIP-1271 policy that gates the settlement signature the StandaloneIntentExecutor
// requests, dispatching each inner call to a stateless per-layer adapter ACL
// (CCTP / Relay / Rhino). This module reproduces the on-chain config/initData
// byte layout so a session can install the policy with the right restrictions.
//
// Every blob here is MANUALLY BYTE-PACKED (the contract slices bytes with explicit
// cursors — there is no abi.decode in the config path). All scalars are
// big-endian, unpadded to their exact field width; addresses are raw 20 bytes;
// CCTP mint recipients are raw 32 bytes. Use concat, never the ABI coder.

// Adapter layer ids are the adapters' self-declared keccak256(name).
export const CCTP_LAYER_ID: Hex = keccak256(toBytes('CCTP'))
export const RELAY_LAYER_ID: Hex = keccak256(toBytes('RELAY'))
export const RHINO_LAYER_ID: Hex = keccak256(toBytes('RHINO'))

// Base-header flags.
export const FLAG_REQUIRE_GAS_REFUND = 0x01
export const FLAG_LOCK_ACCOUNT = 0x02

// Left-pads an address into the 32-byte form CCTP uses for `mintRecipient`.
export function addressToBytes32(address: Address): Hex {
  return pad(address, { size: 32 })
}

// The shared header every IntentExecutor policy initData starts with:
//   [0:20] intentExecutor · [20] flags · [21:53] maxExchangeRate ·
//   [53] gasTokenCount · [54:] gasTokens (20 bytes each)
export interface IntentExecutorBaseConfig {
  readonly intentExecutor: Address
  // Bitfield of FLAG_* (require-gas-refund, lock-account).
  readonly flags?: number
  // Cap on the gas-refund exchange rate; 0 = uncapped.
  readonly maxExchangeRate?: bigint
  // Gas tokens permitted for the refund; each must be non-zero.
  readonly gasTokens?: Address[]
}

export function encodeIntentExecutorBaseHeader(
  config: IntentExecutorBaseConfig,
): Hex {
  const gasTokens = config.gasTokens ?? []
  return concat([
    config.intentExecutor,
    toHex(config.flags ?? 0, { size: 1 }),
    toHex(config.maxExchangeRate ?? 0n, { size: 32 }),
    toHex(gasTokens.length, { size: 1 }),
    ...gasTokens,
  ])
}

// CCTP adapter config (LAYER_ID = keccak256("CCTP")):
//   tokenMessenger(20) · maxFeeCap(32) · minFinalityFloor(4) ·
//   mintRecipientCount(1) · mintRecipients(32 each) ·
//   burnTokenCount(1) · burnTokens(20 each) ·
//   destDomainCount(1) · destDomains(4 each; empty = any)
export interface CctpLayerConfig {
  readonly tokenMessenger: Address
  readonly maxFeeCap?: bigint
  readonly minFinalityFloor?: number
  // 32-byte mint recipients (use addressToBytes32 for EVM addresses).
  readonly mintRecipients: Hex[]
  readonly burnTokens: Address[]
  // CCTP destination domain ids; empty = any domain.
  readonly destDomains?: number[]
}

export function encodeCctpAdapterConfig(config: CctpLayerConfig): Hex {
  const destDomains = config.destDomains ?? []
  return concat([
    config.tokenMessenger,
    toHex(config.maxFeeCap ?? 0n, { size: 32 }),
    toHex(config.minFinalityFloor ?? 0, { size: 4 }),
    toHex(config.mintRecipients.length, { size: 1 }),
    ...config.mintRecipients,
    toHex(config.burnTokens.length, { size: 1 }),
    ...config.burnTokens,
    toHex(destDomains.length, { size: 1 }),
    ...destDomains.map((d) => toHex(d, { size: 4 })),
  ])
}

// Relay adapter config (LAYER_ID = keccak256("RELAY")):
//   relayRouter(20) · intentExecutorAdapter(20; zero = adapter calls denied) ·
//   recipientCount(1) · recipients(20 each) · tokenCount(1) · tokens(20 each)
export interface RelayLayerConfig {
  readonly relayRouter: Address
  readonly intentExecutorAdapter?: Address
  readonly recipients: Address[]
  readonly tokens: Address[]
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

export function encodeRelayAdapterConfig(config: RelayLayerConfig): Hex {
  return concat([
    config.relayRouter,
    config.intentExecutorAdapter ?? ZERO_ADDRESS,
    toHex(config.recipients.length, { size: 1 }),
    ...config.recipients,
    toHex(config.tokens.length, { size: 1 }),
    ...config.tokens,
  ])
}

// Rhino adapter config (LAYER_ID = keccak256("RHINO")):
//   bridgeContract(20) · tokenCount(1) · tokens(20 each)
export interface RhinoLayerConfig {
  readonly bridgeContract: Address
  readonly tokens: Address[]
}

export function encodeRhinoAdapterConfig(config: RhinoLayerConfig): Hex {
  return concat([
    config.bridgeContract,
    toHex(config.tokens.length, { size: 1 }),
    ...config.tokens,
  ])
}

// One layer to install: its id plus the adapter config blob (from the encoders
// above). The contract derives the adapter + configHash on-chain.
export interface LayerInstall {
  readonly layerId: Hex
  readonly config: Hex
}

// Ownable IntentExecutorPolicy initData = base header || tail, where the tail is:
//   layerCount(1) · per layer [ layerId(32) · configLen(uint16) · config ]
export function encodeIntentExecutorPolicyInitData(input: {
  readonly base: IntentExecutorBaseConfig
  readonly layers: readonly LayerInstall[]
}): Hex {
  const tail = concat([
    toHex(input.layers.length, { size: 1 }),
    ...input.layers.flatMap((l) => [
      l.layerId,
      toHex(size(l.config), { size: 2 }),
      l.config,
    ]),
  ])
  return concat([encodeIntentExecutorBaseHeader(input.base), tail])
}

// Static (single-layer) policy initData = base header || the adapter config blob
// verbatim (no layer wrapper).
export function encodeStaticIntentExecutorPolicyInitData(input: {
  readonly base: IntentExecutorBaseConfig
  readonly config: Hex
}): Hex {
  return concat([encodeIntentExecutorBaseHeader(input.base), input.config])
}

// The ERC-1271 policy entry to add to a session's erc7739Policies.erc1271Policies
// for the ownable multi-layer IntentExecutor policy.
export function intentExecutorPolicyEntry(params: {
  readonly policy: Address
  readonly base: IntentExecutorBaseConfig
  readonly layers: readonly LayerInstall[]
}): { readonly policy: Address; readonly initData: Hex } {
  if (params.layers.length === 0) {
    throw new Error('intentExecutorPolicyEntry requires at least one layer')
  }
  return {
    policy: params.policy,
    initData: encodeIntentExecutorPolicyInitData({
      base: params.base,
      layers: params.layers,
    }),
  }
}
