import { type Address, type Hex, keccak256, stringToHex } from 'viem'

const INTENT_EXECUTOR_ADDRESS: Address =
  '0x00000000005aD9ce1f5035FD62CA96CEf16AdAAF'
const INTENT_EXECUTOR_ADDRESS_DEV: Address =
  '0xbf9b5b917a83f8adac17b0752846d41d8d7b7e17'

// --- IntentExecutor settlement-layer adapter registry ---
//
// The ownable IntentExecutor session-permit policy (smart-sessions-v2) gates the
// inner `(to, value, data)` calls of a signed op through a per-settlement-layer
// adapter (Relay/CCTP/Rhino). Each adapter is keyed by a `layerId` and needs the
// layer's on-chain infrastructure addresses (router + IntentExecutor adapter) to
// build its ACL config. We keep that knowledge here — never exposed to callers —
// so the public `IntentExecutorClaimPolicy` stays as declarative as the Permit2
// one.

/** `layerId` constants matching each on-chain adapter's `LAYER_ID()`. */
const RELAY_LAYER_ID: Hex = keccak256(stringToHex('RELAY'))
const CCTP_LAYER_ID: Hex = keccak256(stringToHex('CCTP'))
const RHINO_LAYER_ID: Hex = keccak256(stringToHex('RHINO'))

/** Resolved infra for one enabled settlement layer on a given chain. */
interface SettlementLayerInfra {
  layerId: Hex
  /** Relay `ERC20Router` / multicaller the adapter whitelists. */
  relayRouter: Address
  /** Rhinestone `IntentExecutorAdapter` (zero = adapter calls denied). */
  intentExecutorAdapter: Address
}

// TODO(intent-executor): replace these mock addresses with the deployed Relay
// router + IntentExecutorAdapter addresses (per chain, dev vs prod) before merge.
// Source of truth is the contracts/orchestrator team; if these land in
// `@rhinestone/shared-configs`, pull them from there instead of hardcoding.
const MOCK_RELAY_ROUTER: Address = '0x1111111111111111111111111111111111111111'
const MOCK_INTENT_EXECUTOR_ADAPTER: Address =
  '0x2222222222222222222222222222222222222222'
const MOCK_RELAY_ROUTER_DEV: Address =
  '0x3333333333333333333333333333333333333333'
const MOCK_INTENT_EXECUTOR_ADAPTER_DEV: Address =
  '0x4444444444444444444444444444444444444444'

/**
 * Returns the settlement-layer adapters enabled for `chainId`, in install order.
 *
 * The returned order defines the layer-hint index the policy expects in the
 * signed-op data blob, so callers must preserve it. v1 enables Relay only; CCTP
 * and Rhino slot in here once their adapters ship.
 *
 * @param _chainId Destination chain (reserved for future per-chain address maps;
 *                 today the mock addresses are chain-agnostic).
 */
function getSettlementLayerInfra(
  _chainId: number,
  useDevContracts?: boolean,
): SettlementLayerInfra[] {
  const relayRouter = useDevContracts
    ? MOCK_RELAY_ROUTER_DEV
    : MOCK_RELAY_ROUTER
  const intentExecutorAdapter = useDevContracts
    ? MOCK_INTENT_EXECUTOR_ADAPTER_DEV
    : MOCK_INTENT_EXECUTOR_ADAPTER
  return [
    {
      layerId: RELAY_LAYER_ID,
      relayRouter,
      intentExecutorAdapter,
    },
  ]
}

export {
  INTENT_EXECUTOR_ADDRESS,
  INTENT_EXECUTOR_ADDRESS_DEV,
  RELAY_LAYER_ID,
  CCTP_LAYER_ID,
  RHINO_LAYER_ID,
  getSettlementLayerInfra,
  type SettlementLayerInfra,
}
