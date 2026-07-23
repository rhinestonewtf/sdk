import type { Abi, Address } from 'viem'
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
import type {
  ChainDigest,
  Session as DomainSession,
  SessionDefinition as DomainSessionDefinition,
  SessionDetails,
} from '../modules/validators/smart-sessions/types'

function environment(useDevContracts: boolean | undefined) {
  return useDevContracts === true ? 'development' : 'production'
}

function toSession<const TAbis extends readonly Abi[]>(
  definition: SessionDefinition<TAbis>,
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

export {
  toSession,
  SMART_SESSION_EMISSARY_ADDRESS,
  SMART_SESSION_EMISSARY_ADDRESS_DEV,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
  getPermissionId,
  getSessionData,
  getSessionDetails,
  isSessionEnabled,
  toCrossChainPermissionInput,
  SPENDING_LIMITS_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
  SUDO_POLICY_ADDRESS,
  UNIVERSAL_ACTION_POLICY_ADDRESS,
  ARG_POLICY_ADDRESS,
  USAGE_LIMIT_POLICY_ADDRESS,
  VALUE_LIMIT_POLICY_ADDRESS,
  INTENT_EXECUTION_POLICY_ADDRESS,
}
export type { ChainDigest, SessionDetails }
