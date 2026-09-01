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
import {
  ARG_POLICY_ADDRESS,
  INTENT_EXECUTION_POLICY_ADDRESS,
  SPENDING_LIMITS_POLICY_ADDRESS,
  SUDO_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
  UNIVERSAL_ACTION_POLICY_ADDRESS,
  USAGE_LIMIT_POLICY_ADDRESS,
  VALUE_LIMIT_POLICY_ADDRESS,
} from '../modules/validators/smart-sessions/policies/addresses'
import {
  toSession as resolveSession,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
} from '../modules/validators/smart-sessions/resolve'
import {
  readSessionEnabled,
  readSessionNonce,
} from '../modules/validators/smart-sessions/state'
import { fynd } from '../modules/validators/smart-sessions/swap/fynd'
import { rhinestoneSwap } from '../modules/validators/smart-sessions/swap/rhinestone'
import type { SwapVenueFor } from '../modules/validators/smart-sessions/swap/scope'
import type {
  ZeroExAnySettlerOptions,
  ZeroExPinnedOptions,
} from '../modules/validators/smart-sessions/swap/zero-ex'
import {
  resolveZeroExSettler,
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
  FyndVenue,
  RhinestoneSwapVenue,
  SessionDetails,
  SwapVenue,
  SwapVenueFor,
  ZeroExAnySettlerOptions,
  ZeroExPinnedOptions,
  ZeroExVenue,
}
export {
  ARG_POLICY_ADDRESS,
  fynd,
  getPermissionId,
  getSessionData,
  getSessionDetails,
  INTENT_EXECUTION_POLICY_ADDRESS,
  isSessionEnabled,
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
  // Venue-scoped swap sessions (RHI-6286)
  zeroEx,
}
