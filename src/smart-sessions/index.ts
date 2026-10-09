import type { Abi, Address, Chain } from 'viem'
import { materializeRpcReader } from '../clients/rpc/compatibility'
import type {
  ProviderConfig,
  Session,
  SessionDefinition,
} from '../config/account'
import {
  getSessionDetails as buildSessionDetails,
  SESSION_LOCK_TAG,
} from '../modules/validators/smart-sessions/authorization'
import { toCrossChainPermissionInput } from '../modules/validators/smart-sessions/cross-chain-permits'
import {
  getPermissionId,
  getSessionData,
} from '../modules/validators/smart-sessions/digest'
import {
  SMART_SESSION_EMISSARY_ADDRESS,
  SMART_SESSION_EMISSARY_ADDRESS_DEV,
} from '../modules/validators/smart-sessions/module'
import type {
  OneTimeUseBurnOp,
  OneTimeUseSettlementRoute,
} from '../modules/validators/smart-sessions/one-time-use'
import {
  buildOneTimeUseBurnOp,
  encodeOneTimeUseIdInitData,
  oneTimeUseIdErc1271Policy,
} from '../modules/validators/smart-sessions/one-time-use'
import {
  ARG_POLICY_ADDRESS,
  INTENT_EXECUTION_POLICY_ADDRESS,
  ONE_TIME_USE_ID_POLICY_ADDRESS,
  ONE_TIME_USE_ID_POLICY_ADDRESS_DEV,
  SPENDING_LIMITS_POLICY_ADDRESS,
  SUDO_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
  UNIVERSAL_ACTION_POLICY_ADDRESS,
  USAGE_LIMIT_POLICY_ADDRESS,
  VALUE_LIMIT_POLICY_ADDRESS,
} from '../modules/validators/smart-sessions/policies/addresses'
import {
  SESSION_REFUSAL_CODES,
  SESSION_WARNING_CODES,
  type SessionRefusal,
  type SessionRefusalCode,
  type SessionValidation,
  type SessionWarning,
  type SessionWarningCode,
} from '../modules/validators/smart-sessions/refusals'
import {
  toSession as resolveSession,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
  validateSessionDefinition,
} from '../modules/validators/smart-sessions/resolve'
import type {
  SettlementAddresses,
  SettlementCatalog,
} from '../modules/validators/smart-sessions/settlement/types'
import {
  readSessionEnabled,
  readSessionNonce,
} from '../modules/validators/smart-sessions/state'
import type { FyndChainId } from '../modules/validators/smart-sessions/swap/fynd'
import {
  FYND_CHAIN_IDS,
  fynd,
} from '../modules/validators/smart-sessions/swap/fynd'
import { rhinestoneSwap } from '../modules/validators/smart-sessions/swap/rhinestone'
import type { SwapVenueFor } from '../modules/validators/smart-sessions/swap/scope'
import type {
  ZeroExAnySettlerOptions,
  ZeroExPinnedOptions,
} from '../modules/validators/smart-sessions/swap/zero-ex'
import {
  resolveZeroExSettler,
  ZEROX_CHAIN_IDS,
  zeroEx,
} from '../modules/validators/smart-sessions/swap/zero-ex'
import type {
  ChainDigest,
  Session as DomainSession,
  SessionDefinition as DomainSessionDefinition,
  FyndVenue,
  RhinestoneSwapVenue,
  SessionDetails,
  SwapVenue,
  ZeroExVenue,
} from '../modules/validators/smart-sessions/types'

function environment(useDevContracts: boolean | undefined) {
  return useDevContracts === true ? 'development' : 'production'
}

function toSession<
  const TAbis extends readonly Abi[],
  const TChain extends Chain,
>(
  definition: SessionDefinition<TAbis, TChain>,
  options: { useDevContracts?: boolean } = {},
): Session {
  return resolveSession(definition as DomainSessionDefinition, {
    environment: environment(options.useDevContracts),
  }) as Session
}

/** Inputs `createSession` takes from `/chains`, for the standalone {@link validateSession}. */
interface SessionValidationOptions {
  /** The orchestrator's settlement addresses by chain id. */
  settlement?: SettlementCatalog
  /** The chain's wrapped-native token, as `createSession` adds it. */
  wrappedNativeToken?: Address
  /** Resolve against the development deployments. */
  useDevContracts?: boolean
}

/**
 * Dry-run the resolution `createSession` runs, without network calls: return
 * every refusal it would throw for a session definition instead of throwing
 * the first. Given the same `settlement` and `wrappedNativeToken` as
 * `createSession` gets from `/chains`, the first refusal is the error that
 * resolution throws and `refusals` is empty exactly when it succeeds. When
 * nothing is refused, the result also has the session's `access` and, for a
 * settlement-scoped permit, its `settlementCoverage`.
 *
 * Unlike `RhinestoneSDK.validateSession`, it does not read the
 * UniversalActionPolicy copies' code or check that `/chains` serves a
 * wrapped-native token; `createSession` does both. Problems that do not depend
 * on each other are all reported. Within one settlement layer only its first
 * refusal is, as are refusals that leave nothing to check after them (e.g. a
 * missing `to`).
 * @param definition The session definition
 * @param options What `createSession` would take from `/chains`
 * @returns The refusals, each with its stable `code`, and, when there are none, the session's `access` and `settlementCoverage`
 */
function validateSession<
  const TAbis extends readonly Abi[],
  const TChain extends Chain,
>(
  definition: SessionDefinition<TAbis, TChain>,
  options: SessionValidationOptions = {},
): SessionValidation {
  return validateSessionDefinition(definition as DomainSessionDefinition, {
    environment: environment(options.useDevContracts),
    ...(options.wrappedNativeToken
      ? { wrappedNativeToken: options.wrappedNativeToken }
      : {}),
    ...(options.settlement ? { settlement: options.settlement } : {}),
  })
}

async function getSessionDetails(
  account: Address,
  sessions: Session[],
  provider: ProviderConfig | undefined,
  useDevContracts?: boolean,
): Promise<SessionDetails> {
  const runtimeEnvironment = environment(useDevContracts)
  return buildSessionDetails({
    account,
    sessions: sessions as DomainSession[],
    environment: runtimeEnvironment,
    readNonce: async (session) => {
      const reader = materializeRpcReader({ chain: session.chain, provider })
      return readSessionNonce({
        rpc: reader.rpc,
        chain: reader.chain,
        account,
        lockTag: SESSION_LOCK_TAG,
        environment: runtimeEnvironment,
      })
    },
  })
}

async function isSessionEnabled(
  account: Address,
  provider: ProviderConfig | undefined,
  session: Session,
  useDevContracts?: boolean,
): Promise<boolean> {
  const reader = materializeRpcReader({ chain: session.chain, provider })
  return readSessionEnabled({
    rpc: reader.rpc,
    chain: reader.chain,
    account,
    session: session as DomainSession,
    environment: environment(useDevContracts),
  })
}

export type {
  ChainDigest,
  SessionRefusal,
  SessionRefusalCode,
  SessionValidation,
  SessionValidationOptions,
  SessionWarning,
  SessionWarningCode,
  FyndChainId,
  FyndVenue,
  RhinestoneSwapVenue,
  SessionDetails,
  SettlementAddresses,
  SettlementCatalog,
  SwapVenue,
  SwapVenueFor,
  ZeroExAnySettlerOptions,
  ZeroExPinnedOptions,
  ZeroExVenue,
}
export {
  ARG_POLICY_ADDRESS,
  SESSION_REFUSAL_CODES,
  SESSION_WARNING_CODES,
  FYND_CHAIN_IDS,
  fynd,
  getPermissionId,
  getSessionData,
  getSessionDetails,
  INTENT_EXECUTION_POLICY_ADDRESS,
  isSessionEnabled,
  ONE_TIME_USE_ID_POLICY_ADDRESS,
  ONE_TIME_USE_ID_POLICY_ADDRESS_DEV,
  resolveZeroExSettler,
  rhinestoneSwap,
  SMART_SESSION_EMISSARY_ADDRESS,
  SMART_SESSION_EMISSARY_ADDRESS_DEV,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
  SPENDING_LIMITS_POLICY_ADDRESS,
  SUDO_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
  toCrossChainPermissionInput,
  toSession,
  UNIVERSAL_ACTION_POLICY_ADDRESS,
  USAGE_LIMIT_POLICY_ADDRESS,
  VALUE_LIMIT_POLICY_ADDRESS,
  validateSession,
  // Venue-scoped swap sessions (RHI-6286)
  ZEROX_CHAIN_IDS,
  zeroEx,
  // One-time-use sessions (RHI-5798)
  buildOneTimeUseBurnOp,
  encodeOneTimeUseIdInitData,
  oneTimeUseIdErc1271Policy,
}
export type { OneTimeUseSettlementRoute, OneTimeUseBurnOp }
