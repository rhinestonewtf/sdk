import { decodeAbiParameters, zeroHash } from 'viem'
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
  // source: OneTimeUseIdPolicy init layout (smart-sessions-v2#56 @ 493fd86) —
  // word 0 is the id (42 = 0x2a), word 1 the deadline; none given, so zero.
  const onceEntry = {
    policy: POLICY,
    initData:
      '0x000000000000000000000000000000000000000000000000000000000000002a0000000000000000000000000000000000000000000000000000000000000000' as const,
  }

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

  test('carries a caller-set validUntil into the once-policy on every surface, in seconds', () => {
    const data = resolveSessionData({
      chain: base,
      owners,
      claimPolicies: [{ type: 'permit2' }],
      // source: 1_900_000_000 s = 2030-03-17T17:46:40Z (date -u -r 1900000000)
      oneTimeUse: { id: 42n, validUntil: new Date('2030-03-17T17:46:40.999Z') },
      policyAddresses: { oneTimeUseId: POLICY },
    })
    const onceEntries = [
      ...data.erc7739Policies.erc1271Policies,
      ...data.actions.flatMap((action) => action.actionPolicies),
    ].filter((entry) => entry.policy === POLICY)
    expect(onceEntries.length).toBe(data.actions.length + 1)
    for (const entry of onceEntries) {
      expect(
        decodeAbiParameters(
          [{ type: 'uint256' }, { type: 'uint256' }],
          entry.initData,
        ),
      ).toEqual([42n, 1_900_000_000n])
    }
  })

  test('leaves a normal session untouched (sudo-only 1271 list, no once-policy on actions)', () => {
    const data = resolveSessionData({ chain: base, owners })
    expect(data.erc7739Policies.erc1271Policies).toHaveLength(1)
    for (const action of data.actions) {
      expect(action.actionPolicies).not.toContainEqual(onceEntry)
    }
  })

  test.each([
    undefined,
    { mode: 'disabled' },
    { mode: 'unrestricted', validUntil: new Date('2030-01-01') },
  ] as const)(
    'an executor-only one-time-use session keeps the signing list it asked for (%o)',
    (signing) => {
      const resolve = (oneTimeUse?: { id: bigint }) =>
        resolveSessionData({
          chain: base,
          owners,
          ...(signing && { signing }),
          ...(oneTimeUse && { oneTimeUse }),
          policyAddresses: { oneTimeUseId: POLICY },
        })
      const data = resolve({ id: 42n })
      expect(data.erc7739Policies.erc1271Policies).toEqual(
        resolve().erc7739Policies.erc1271Policies,
      )
      expect(data.erc7739Policies.erc1271Policies).not.toContainEqual(onceEntry)
      // The burn still bounds the executor route: once-policy on every action.
      expect(data.actions.length).toBeGreaterThan(0)
      for (const action of data.actions) {
        expect(action.actionPolicies).toContainEqual(onceEntry)
      }
    },
  )

  const sessionWith = (
    oneTimeUse: { id: bigint } | undefined,
    extra: {
      spenders?: `0x${string}`[]
      saltMode?: 'none' | 'strict'
    } = {},
  ) =>
    toSession({
      chain: base,
      owners,
      claimPolicies: [
        {
          type: 'permit2',
          ...(extra.spenders && { spenders: extra.spenders }),
        },
      ],
      ...(oneTimeUse && { oneTimeUse }),
      ...(extra.saltMode && { saltMode: extra.saltMode }),
      policyAddresses: { oneTimeUseId: POLICY },
    })

  test('two one-time-use sessions that differ only by id get different permissionIds', () => {
    expect(sessionWith({ id: 42n }).permissionId).toBe(
      sessionWith({ id: 42n }).permissionId,
    )
    expect(sessionWith({ id: 42n }).permissionId).not.toBe(
      sessionWith({ id: 43n }).permissionId,
    )
  })

  test('a one-time-use session never shares a permissionId with a plain session of the same owner', () => {
    expect(sessionWith({ id: 42n }).permissionId).not.toBe(
      sessionWith(undefined).permissionId,
    )
  })

  test.each([undefined, 'none', 'strict'] as const)(
    'is salted as in strict whatever saltMode says (%s)',
    (saltMode) => {
      const salt = sessionWith({ id: 42n }, { saltMode }).salt
      expect(salt).not.toBe(zeroHash)
      expect(salt).toBe(sessionWith({ id: 42n }, { saltMode: 'strict' }).salt)
    },
  )

  test('the claim policy moved onto the 1271 list is part of the permissionId', () => {
    const a = '0x00000000000000000000000000000000000000b1' as const
    const b = '0x00000000000000000000000000000000000000b2' as const
    expect(sessionWith({ id: 42n }, { spenders: [a] }).permissionId).not.toBe(
      sessionWith({ id: 42n }, { spenders: [b] }).permissionId,
    )
  })

  test('a null oneTimeUse leaves a plain session unsalted', () => {
    const plain = resolveSessionData({
      chain: base,
      owners,
      saltMode: 'strict',
      oneTimeUse: null as any,
    })
    expect(plain.salt).toBe(zeroHash)
  })

  test.each([
    { mode: 'unrestricted', validUntil: new Date('2030-01-01') },
    { mode: 'unrestricted', validAfter: new Date('2020-01-01') },
    {
      mode: 'scoped',
      allowedContents: [
        {
          domain: { name: 'x' },
          types: { M: [{ name: 'a', type: 'uint256' }] },
          primaryType: 'M',
        },
      ],
      validUntil: new Date('2030-01-01'),
    },
  ] as const)(
    'rejects a signing validity window with claim policies, whose replaced 1271 list would drop it',
    (signing) => {
      expect(() =>
        resolveSessionData({
          chain: base,
          owners,
          claimPolicies: [{ type: 'permit2' }],
          oneTimeUse: { id: 42n },
          signing,
          policyAddresses: { oneTimeUseId: POLICY },
        }),
      ).toThrow(/signing validity window/)
    },
  )

  test.each([
    { mode: 'unrestricted' },
    { mode: 'unrestricted', validUntil: undefined },
  ] as const)(
    'accepts a signing mode without a validity window, with claim policies (%o)',
    (signing) => {
      expect(() =>
        resolveSessionData({
          chain: base,
          owners,
          claimPolicies: [{ type: 'permit2' }],
          oneTimeUse: { id: 42n },
          signing,
          policyAddresses: { oneTimeUseId: POLICY },
        }),
      ).not.toThrow()
    },
  )

  test("rejects saltMode 'v1'", () => {
    expect(() =>
      resolveSessionData({
        chain: base,
        owners,
        oneTimeUse: { id: 42n },
        saltMode: 'v1',
        policyAddresses: { oneTimeUseId: POLICY },
      }),
    ).toThrow(/saltMode 'v1'/)
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
    // Drives prepareIntentSessions to keep the session in verify-execution mode.
    expect(session.oneTimeUse).toBe(true)
    // ...but the on-chain claim (lockTag) surface stays empty — the policy is
    // enforced via the erc1271 list, so getSessionData must not re-encode it.
    expect(getSessionData(session).claimPolicies).toHaveLength(0)
    expect(
      getSessionData(session).erc7739Policies.erc1271Policies.length,
    ).toBeGreaterThan(1)
  })
})
