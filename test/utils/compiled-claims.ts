import {
  encodePermit2ClaimPolicyInitData,
  PERMIT2_CLAIM_POLICY_ADDRESS,
} from '../../src/modules/validators/policies/claim/permit2'
import {
  getPermissionIdFromData,
  getSessionData,
} from '../../src/modules/validators/smart-sessions/digest'
import { resolvePermit2ClaimPolicy } from '../../src/modules/validators/smart-sessions/policies/claim'
import type {
  Permit2ClaimPolicy,
  Session,
} from '../../src/modules/validators/smart-sessions/types'

/** Historical resolved artifacts for low-level encoding tests, never definition inputs. */
export function withCompiledClaims(
  session: Session,
  claims: readonly Permit2ClaimPolicy[],
): Session {
  const restored: Session = {
    ...session,
    claimPolicies: claims,
    erc7739Policies: {
      ...session.erc7739Policies,
      erc1271Policies: claims.map((claim) => ({
        policy: PERMIT2_CLAIM_POLICY_ADDRESS,
        initData: encodePermit2ClaimPolicyInitData(
          resolvePermit2ClaimPolicy(claim),
        ),
      })),
    },
  }
  return {
    ...restored,
    permissionId: getPermissionIdFromData(getSessionData(restored)),
  }
}
