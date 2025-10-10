import { type Hex } from 'viem'
import type { SessionDetails } from '../execution/smart-session'
import {
  encodeSmartSessionSignature as encodeSmartSessionSignatureInternal,
  getEnableSessionCall,
} from '../modules/validators/smart-sessions'
import { Session } from '../types'

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

/**
 * Encode a smart session signature
 * @param sessionDetails Session details
 * @param sessionSignature Session signature
 * @returns Encoded smart session signature
 */
function encodeSmartSessionSignature(
  sessionDetails: SessionDetails,
  sessionSignature: Hex,
) {
  return encodeSmartSessionSignatureInternal(
    sessionDetails.mode,
    sessionDetails.enableSessionData.permissionId,
    sessionSignature,
    sessionDetails.enableSessionData,
  )
}

export { enableSession, encodeSmartSessionSignature }
