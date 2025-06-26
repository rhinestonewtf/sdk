import { Hex } from 'viem'
import { SessionDetails } from '../execution/smart-session'
import { encodeSmartSessionSignature as encodeSmartSessionSignatureInternal } from '../modules/validators/smart-sessions'

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
