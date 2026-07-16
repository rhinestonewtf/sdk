import { encodeAbiParameters, keccak256 } from 'viem'
import {
  encodePermit2ClaimPolicyInitData,
  PERMIT2_CLAIM_POLICY_ADDRESS,
} from '../policies/claim/permit2'
import { resolvePermit2ClaimPolicy } from './policies/claim'
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
    claimPolicies: session.claimPolicies.map((policy) => ({
      policy: PERMIT2_CLAIM_POLICY_ADDRESS,
      initData: encodePermit2ClaimPolicyInitData(
        resolvePermit2ClaimPolicy(policy),
      ),
    })),
  }
}

export function getPermissionId(session: Session): `0x${string}` {
  return session.permissionId
}
