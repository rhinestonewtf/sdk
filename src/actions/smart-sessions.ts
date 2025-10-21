import { getEnableSessionCall } from '../modules/validators/smart-sessions'
import type { Session } from '../types'

/**
 * Enable a smart session
 * @param session session to enable
 * @returns Calls to enable the smart session
 */
function enableSession(session: Session) {
  return {
    async resolve() {
      return getEnableSessionCall(session)
    },
  }
}

export { enableSession }
