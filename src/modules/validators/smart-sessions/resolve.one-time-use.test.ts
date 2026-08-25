import { pad, toHex } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'

import { accountA } from '../../../../test/consts'
import { PERMIT2_CLAIM_POLICY_ADDRESS } from '../policies/claim/permit2'
import { getSessionData } from './digest'
import { resolveSessionData, toSession } from './resolve'

// Kept out of resolve.test.ts because that file imports fast-check (declared in
// package.json but not installed in every working copy); these are plain
// example-based tests for the OneTimeUseId wiring (RHI-5798).
describe('resolveSessionData — one-time-use session', () => {
  const POLICY = '0x00000000000000000000000000000000000000aa' as const
  const owners = { type: 'ecdsa' as const, accounts: [accountA] }
  const onceEntry = { policy: POLICY, initData: pad(toHex(42n), { size: 32 }) }

  function oneTimeUseSession() {
    return resolveSessionData({
      chain: base,
      owners,
      claimPolicies: [{ type: 'permit2' }],
      oneTimeUse: { id: 42n },
      policyAddresses: { oneTimeUseId: POLICY },
    })
  }

  test('installs the once-policy on EVERY action (executor route enforces via checkAction)', () => {
    const data = oneTimeUseSession()
    expect(data.actions.length).toBeGreaterThan(0)
    for (const action of data.actions) {
      expect(action.actionPolicies).toContainEqual(onceEntry)
    }
  })

  test('co-locates the Permit2 claim policy with the once-policy on the 1271 list, and empties claimPolicies', () => {
    const data = oneTimeUseSession()
    const list = data.erc7739Policies.erc1271Policies
    // [ Permit2ClaimPolicy (digest-binding partner), once-policy ] — no sudo
    expect(list).toHaveLength(2)
    expect(list[0].policy).toBe(PERMIT2_CLAIM_POLICY_ADDRESS)
    expect(list[1]).toEqual(onceEntry)
    // the claim policy moved OFF the claim surface onto the 1271 surface
    expect(data.claimPolicies).toHaveLength(0)
  })

  test('leaves a normal session untouched (sudo-only 1271 list, no once-policy on actions)', () => {
    const data = resolveSessionData({ chain: base, owners })
    expect(data.erc7739Policies.erc1271Policies).toHaveLength(1)
    for (const action of data.actions) {
      expect(action.actionPolicies).not.toContainEqual(onceEntry)
    }
  })

  test('executor-only one-time-use drops sudo from the 1271 list, leaving only the once-policy', () => {
    const data = resolveSessionData({
      chain: base,
      owners,
      oneTimeUse: { id: 42n },
      policyAddresses: { oneTimeUseId: POLICY },
    })
    // No claim policy → the 1271 list is exactly [once]; the permissive sudo
    // entry is intentionally replaced so the arbiter route can't fall through it.
    expect(data.erc7739Policies.erc1271Policies).toEqual([onceEntry])
    expect(data.claimPolicies).toHaveLength(0)
    // ...and the burn still bounds the executor route: once-policy on every action.
    expect(data.actions.length).toBeGreaterThan(0)
    for (const action of data.actions) {
      expect(action.actionPolicies).toContainEqual(onceEntry)
    }
  })

  test('permissionId is derived from validator+salt, not the pinned id (id is bound via the enable-signed config)', () => {
    const session = (id: bigint) =>
      toSession({
        chain: base,
        owners,
        claimPolicies: [{ type: 'permit2' }],
        oneTimeUse: { id },
        policyAddresses: { oneTimeUseId: POLICY },
      })
    // Smart-sessions derives the permissionId from (sessionValidator, initData,
    // salt) only — the pinned id lives in the once-policy initData, which the
    // enable signature authorizes over the full session config, not the
    // permissionId. So two one-time-use sessions differing ONLY by id share a
    // permissionId (as any two same-owner sessions do, since salt is fixed to
    // zeroHash) and can't be installed concurrently on the same account.
    expect(session(42n).permissionId).toBe(session(43n).permissionId)
  })

  test('throws when oneTimeUse is set without policyAddresses.oneTimeUseId', () => {
    expect(() =>
      resolveSessionData({ chain: base, owners, oneTimeUse: { id: 42n } }),
    ).toThrow(/oneTimeUseId/)
  })

  test('toSession keeps claim policies on the high-level session (permit2 signature calldata) but off the on-chain claim surface', () => {
    const session = toSession({
      chain: base,
      owners,
      claimPolicies: [{ type: 'permit2' }],
      oneTimeUse: { id: 42n },
      policyAddresses: { oneTimeUseId: POLICY },
    })
    // Populated so claimPolicyData() can build the permit2 settlement calldata
    // that the erc1271-resident Permit2ClaimPolicy reads (RHI-5798).
    expect(session.claimPolicies).toHaveLength(1)
    expect(session.claimPoliciesEnforcedVia1271).toBe(true)
    // ...but the on-chain claim (lockTag) surface stays empty — the policy is
    // enforced via the erc1271 list, so getSessionData must not re-encode it.
    expect(getSessionData(session).claimPolicies).toHaveLength(0)
    expect(
      getSessionData(session).erc7739Policies.erc1271Policies.length,
    ).toBeGreaterThan(1)
  })
})
