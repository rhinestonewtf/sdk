import { keccak256, toHex } from 'viem'
import { getSessionData } from '../../src/modules/validators/smart-sessions/digest'
import type { Session } from '../../src/modules/validators/smart-sessions/types'

/** A hash of everything a session enables and signs with, minus intent metadata. */
export function sessionFingerprint(session: Session): string {
  return keccak256(
    toHex(
      JSON.stringify(
        {
          permissionId: session.permissionId,
          data: getSessionData(session),
          claimPolicies: session.claimPolicies,
          hasExplicitPermissions: session.hasExplicitPermissions,
        },
        (_, value) =>
          typeof value === 'bigint'
            ? value.toString()
            : value && typeof value === 'object' && 'rpcUrls' in value
              ? value.id
              : value,
      ),
    ),
  )
}
