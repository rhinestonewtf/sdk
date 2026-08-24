import { pad, toHex } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'

import { accountA } from '../../../../test/consts'
import { PERMIT2_CLAIM_POLICY_ADDRESS } from '../policies/claim/permit2'
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

  test('throws when oneTimeUse is set without policyAddresses.oneTimeUseId', () => {
    expect(() =>
      resolveSessionData({ chain: base, owners, oneTimeUse: { id: 42n } }),
    ).toThrow(/oneTimeUseId/)
  })

  test('toSession also empties claimPolicies (no leak onto the claim surface via getSessionData)', () => {
    const session = toSession({
      chain: base,
      owners,
      claimPolicies: [{ type: 'permit2' }],
      oneTimeUse: { id: 42n },
      policyAddresses: { oneTimeUseId: POLICY },
    })
    expect(session.claimPolicies).toHaveLength(0)
  })
})
