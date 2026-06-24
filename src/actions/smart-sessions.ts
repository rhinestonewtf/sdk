import { type Hex, maxUint256 } from 'viem'
import {
  getModuleInstallationCalls,
  getModuleUninstallationCalls,
} from '../accounts'
import {
  getDisableSessionCall,
  getEnableSessionCall,
  getSmartSessionValidator,
} from '../modules/validators/smart-sessions'
import type { LazyCallInput, Session } from '../types'

/**
 * Enable smart sessions
 * @returns Calls to enable smart sessions
 */
function experimental_enable(): LazyCallInput {
  return {
    async resolve({ config }) {
      const module = getSmartSessionValidator(config)
      if (!module) {
        return []
      }
      return getModuleInstallationCalls(config, module)
    },
  }
}

/**
 * Disable smart sessions
 * @returns Calls to disable smart sessions
 */
function experimental_disable(): LazyCallInput {
  return {
    async resolve({ chain, config }) {
      const module = getSmartSessionValidator(config)
      if (!module) {
        return []
      }
      return getModuleUninstallationCalls(config, chain, module)
    },
  }
}

/**
 * Enable a smart session
 *
 * The `session` must be a resolved `Session` (the return value of
 * `toSession(...)`). Re-resolving it here would drop the explicit
 * `permissions` — a `Session` only carries the derived `actions`, not the
 * original `SessionDefinition.permissions` — which makes the on-chain digest
 * computed by `SmartSessionLens.getAndVerifyDigest` diverge from the one
 * signed in `getSessionDetails`, causing the emissary to reject the enable.
 *
 * @param session resolved session to enable
 * @returns Calls to enable the smart session
 */
function experimental_enableSession(
  session: Session,
  enableSessionSignature: Hex,
  hashesAndChainIds: {
    chainId: bigint
    sessionDigest: Hex
  }[],
  sessionToEnableIndex: number,
): LazyCallInput {
  return {
    async resolve({ accountAddress, config }) {
      return getEnableSessionCall(
        accountAddress,
        session,
        enableSessionSignature,
        hashesAndChainIds,
        sessionToEnableIndex,
        config.useDevContracts,
      )
    },
  }
}

/**
 * Disable a smart session
 *
 * Removes a single session from the smart-session emissary via `removeConfig`.
 * The account executes the call itself, so the emissary skips the disable
 * user-signature — the user authorizes it by signing the outer transaction as
 * usual (no separate, blind session-digest signature). The `session` must be a
 * resolved `Session` (the return value of `toSession(...)`) on the chain where
 * the session is being disabled.
 *
 * @param session resolved session to disable
 * @param expires optional deadline after which this disable call is no longer
 *   valid; must be in the future. Omit for no expiry.
 * @returns Calls to disable the smart session
 */
function experimental_disableSession(
  session: Session,
  expires?: Date,
): LazyCallInput {
  return {
    async resolve({ accountAddress, config }) {
      return getDisableSessionCall(
        accountAddress,
        session,
        expires ? BigInt(Math.floor(expires.getTime() / 1000)) : maxUint256,
        config.provider,
        config.useDevContracts,
      )
    },
  }
}

export {
  experimental_disable,
  experimental_disableSession,
  experimental_enable,
  experimental_enableSession,
}
