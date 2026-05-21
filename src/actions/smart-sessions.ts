import type { Hex } from 'viem'
import {
  getModuleInstallationCalls,
  getModuleUninstallationCalls,
} from '../accounts'
import {
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
    async resolve({ config }) {
      const module = getSmartSessionValidator(config)
      if (!module) {
        return []
      }
      return getModuleUninstallationCalls(config, module)
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

export { experimental_disable, experimental_enable, experimental_enableSession }
