import type { Hex } from 'viem'
import { encodeEnableSessionCall } from '../modules/validators/smart-sessions/calls'
import { resolveSmartSessionModule } from '../modules/validators/smart-sessions/module'
import type { Session as ResolvedSession } from '../modules/validators/smart-sessions/types'
import type { LazyCallInput, Session } from '../types'
import {
  resolveModuleInstallation,
  resolveModuleUninstallation,
  resolveSessionDisable,
} from './runtime'

function environment(useDevContracts: boolean | undefined) {
  return useDevContracts === true ? 'development' : 'production'
}

function sessionModule(
  config: Parameters<LazyCallInput['resolve']>[0]['config'],
) {
  return resolveSmartSessionModule({
    enabled: config.experimental_sessions?.enabled ?? false,
    address: config.experimental_sessions?.module,
    environment: environment(config.useDevContracts),
  })
}

/**
 * Enable smart sessions
 * @returns Calls to enable smart sessions
 */
function experimental_enable(): LazyCallInput {
  return {
    async resolve(context) {
      const module = sessionModule(context.config)
      if (!module) {
        return []
      }
      return resolveModuleInstallation(context, module)
    },
  }
}

/**
 * Disable smart sessions
 * @returns Calls to disable smart sessions
 */
function experimental_disable(): LazyCallInput {
  return {
    async resolve(context) {
      const module = sessionModule(context.config)
      if (!module) {
        return []
      }
      return resolveModuleUninstallation(context, module)
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
      const call = encodeEnableSessionCall({
        account: accountAddress,
        session: session as ResolvedSession,
        userSignature: enableSessionSignature,
        hashesAndChainIds,
        sessionToEnableIndex,
        environment: environment(config.useDevContracts),
      })
      return { to: call.target, value: call.value, data: call.data }
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
    async resolve(context) {
      return resolveSessionDisable({
        context,
        account: context.accountAddress,
        session,
        ...(expires ? { expires } : {}),
      })
    },
  }
}

export {
  experimental_disable,
  experimental_disableSession,
  experimental_enable,
  experimental_enableSession,
}
