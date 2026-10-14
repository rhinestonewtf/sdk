import { encodeAbiParameters, keccak256 } from 'viem'
import type { Session, SessionData } from './types'

export function getPermissionIdFromData(session: SessionData): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address', name: 'sessionValidator' },
        { type: 'bytes', name: 'sessionValidatorInitData' },
        { type: 'bytes32', name: 'salt' },
      ],
      [
        session.sessionValidator,
        session.sessionValidatorInitData,
        session.salt,
      ],
    ),
  )
}

export function getSessionData(session: Session): SessionData {
  return {
    sessionValidator: session.sessionValidator,
    sessionValidatorInitData: session.sessionValidatorInitData,
    salt: session.salt,
    erc7739Policies: session.erc7739Policies,
    actions: session.actions,
    // Declared claim policies are enforced from the erc1271 surface and are
    // already in `erc7739Policies`. Encoding them here too would also place
    // them on the on-chain claim (lockTag) surface, which the manager skips
    // under the zero lock tag the SDK enables with.
    claimPolicies: [],
  }
}

export function getPermissionId(session: Session): `0x${string}` {
  return session.permissionId
}
