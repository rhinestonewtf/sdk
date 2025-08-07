import type { Hex } from 'viem'
import type { SessionDetails } from '../execution/smart-session'
import { encodeSmartSessionSignature as encodeSmartSessionSignatureInternal } from '../modules/validators/smart-sessions'

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

export { encodeSmartSessionSignature }
