import type { Hex } from 'viem'
import {
  getModuleInstallationCalls,
  getModuleUninstallationCalls,
} from '../accounts'
import {
  getEnableSessionCall,
  getSmartSessionValidator,
} from '../modules/validators/smart-sessions'
import type { LazyCallInput, SessionInput } from '../types'

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
    async resolve({ accountAddress, chain, config }) {
      return getEnableSessionCall(
        accountAddress,
        {
          ...session,
          chain,
        },
        enableSessionSignature,
        hashesAndChainIds,
        sessionToEnableIndex,
        config.useDevContracts,
      )
    },
  }
}

export { experimental_disable, experimental_enable, experimental_enableSession }
