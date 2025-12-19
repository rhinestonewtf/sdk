import type { Hex } from 'viem'
import { getEnableSessionCall } from '../modules/validators/smart-sessions'
import type { LazyCallInput, SessionInput } from '../types'

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
      )
    },
  }
}

export { experimental_enableSession }
