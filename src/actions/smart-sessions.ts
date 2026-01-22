import type { Hex } from 'viem'
import {
  getModuleInstallationCalls,
  getModuleUninstallationCalls,
} from '../accounts'
import { getSmartSessionValidator } from '../modules/validators/core'
import { getEnableSessionCall } from '../modules/validators/smart-sessions'
import type { LazyCallInput, SessionInput } from '../types'

/**
 * Enable smart sessions
 * @returns Calls to enable smart sessions
 */
function experimental_enable(): LazyCallInput {
  return {
    async resolve({ config }) {
      return getModuleInstallationCalls(config, getSmartSessionValidator())
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
      return getModuleUninstallationCalls(config, getSmartSessionValidator())
    },
  }
}

/**
 * Enable a smart session
 * @param session session to enable
 * @returns Calls to enable the smart session
 */
function experimental_enableSession(
  session: SessionInput,
  enableSessionSignature: Hex,
  hashesAndChainIds: {
    chainId: bigint
    sessionDigest: Hex
  }[],
  sessionToEnableIndex: number,
): LazyCallInput {
  return {
    async resolve({ accountAddress, chain }) {
      return getEnableSessionCall(
        accountAddress,
        {
          ...session,
          chain,
        },
        enableSessionSignature,
        hashesAndChainIds,
        sessionToEnableIndex,
      )
    },
  }
}

export { experimental_disable, experimental_enable, experimental_enableSession }
