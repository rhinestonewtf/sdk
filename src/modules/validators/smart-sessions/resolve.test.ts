import fc from 'fast-check'
import { size, zeroHash } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../test/consts'
import { encodeDisableSessionCall, encodeEnableSessionCall } from './calls'
import {
  resolveCrossChainPermission,
  toCrossChainPermissionInput,
} from './cross-chain-permits'
import { buildSmartSessionMockSignature } from './mock-signature'
import { SMART_SESSIONS_FALLBACK_TARGET_FLAG, toSession } from './resolve'
import type { SessionPolicy } from './types'

describe('Smart Sessions core', () => {
  test('matches the exact sudo session vector', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
    })
    expect(session).toMatchObject({
      permissionId:
        '0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4',
      sessionValidator: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
      sessionValidatorInitData:
        '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936',
      actions: [
        {
          actionTargetSelector: '0x00000001',
          actionTarget: '0x0000000000000000000000000000000000000001',
          actionPolicies: [
            {
              policy: '0x0000000000FEEc8D74e3143fBaBbca515358d869',
              initData: '0x',
            },
          ],
        },
      ],
    })
  })

  test('encodes all three mock signature paths consistently', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
    })
    const enable = buildSmartSessionMockSignature({
      session,
      environment: 'production',
      shape: 'enable',
    })
    const use = buildSmartSessionMockSignature({
      session,
      environment: 'production',
      shape: 'use',
    })
    const erc1271 = buildSmartSessionMockSignature({
      session,
      environment: 'production',
      shape: 'erc1271',
    })
    expect(enable.slice(42, 44)).toBe('01')
    expect(use.slice(42, 44)).toBe('00')
    expect(erc1271.slice(42, 44)).toBe('00')
    expect(size(enable)).toBeGreaterThan(size(use))
    expect(size(erc1271)).toBeGreaterThan(size(use))
  })

  test('encodes the no-allocator disable call vector deterministically', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
    })
    const first = encodeDisableSessionCall({
      account: accountA.address,
      session,
      expires: 123n,
      nonce: 4n,
      environment: 'production',
    })
    const second = encodeDisableSessionCall({
      account: accountA.address,
      session,
      expires: 123n,
      nonce: 4n,
      environment: 'production',
    })
    expect(first).toEqual(second)
    expect(first.target).toBe('0xad568b3f825a8d5ffc06dd3253526b64d810ae89')
    expect(first.data.slice(0, 10)).toBe('0x60e637cc')
  })

  test('encodes session enable calls and default mock inputs', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
    })
    const call = encodeEnableSessionCall({
      account: accountA.address,
      session,
      userSignature: '0x1234',
      hashesAndChainIds: [
        { chainId: BigInt(base.id), sessionDigest: session.permissionId },
      ],
      sessionToEnableIndex: 0,
      environment: 'development',
    })
    expect(call.data.slice(0, 10)).toBe('0xa45edb84')
    expect(
      buildSmartSessionMockSignature({
        session,
        environment: 'development',
      }),
    ).toMatch(/^0x[\da-f]+$/i)
  })

  test('cross-chain input round-trips at whole-second precision', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_700_000_000, max: 2_000_000_000 }),
        (timestamp) => {
          const input = {
            from: {
              chain: base,
              token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
              maxAmount: 1n,
            },
            validUntil: new Date(timestamp * 1000),
          }
          const resolved = resolveCrossChainPermission(input)
          const roundTrip = toCrossChainPermissionInput(resolved)
          expect(roundTrip.validUntil).toEqual(input.validUntil)
          expect(roundTrip.allowRecipientNotAccount).toBe(false)
        },
      ),
    )
  })
})

// A restricted session's guardrails: each one exists to stop the wildcard
// fallback being reintroduced, or to stop two entries silently colliding on one
// on-chain action id.
describe('restricted session guards', () => {
  const owners = { type: 'ecdsa' as const, accounts: [accountA] }
  const TOKEN = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb' as const

  test('rejects a raw action with no target/selector — it maps to the fallback', () => {
    expect(() =>
      toSession({
        chain: base,
        owners,
        // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
        actions: [{ policies: [{ type: 'sudo' }] } as any],
        restrictToActions: true,
      }),
    ).toThrow(/must be scoped \(target \+ selector\)/)
  })

  test('rejects a raw action aimed at the fallback sentinel', () => {
    expect(() =>
      toSession({
        chain: base,
        owners,
        actions: [
          {
            target: SMART_SESSIONS_FALLBACK_TARGET_FLAG,
            selector: '0x12345678',
            policies: [{ type: 'sudo' }],
          },
        ],
        restrictToActions: true,
      }),
    ).toThrow(/must not target the fallback sentinel/)
  })

  test('rejects a restricted session with nothing to authorise', () => {
    // Without this guard the session would silently fall back to sudo.
    expect(() =>
      toSession({ chain: base, owners, restrictToActions: true }),
    ).toThrow(/at least one permission or action/)
  })

  // The whole point of the option: leaving it off must reproduce what stored
  // signatures already cover, or every restricted session ever registered breaks.
  test('leaves the salt alone unless a mode is asked for', () => {
    const built = (saltMode?: 'none' | 'v1' | 'strict') =>
      toSession({
        chain: base,
        owners,
        actions: [
          {
            target: TOKEN,
            selector: '0x095ea7b3',
            policies: [{ type: 'sudo' }],
          },
        ],
        restrictToActions: true,
        ...(saltMode ? { saltMode } : {}),
      }).salt

    expect(built()).toBe(zeroHash)
    expect(built('none')).toBe(zeroHash)
    expect(built('strict')).not.toBe(zeroHash)
  })

  // Reproducing 1.x is not only about the salt. 1.x builds an approve action as
  // [arg policy, spending limits]; the `spendingLimit` sugar expands before
  // `params` here, so without this the pair comes out reversed and the digest
  // diverges — but ONLY once a cap exists, which is why an uncapped fixture
  // cannot catch it. Measured against a session built by a real 1.18.0.
  test("'v1' emits an action's policies in the order 1.x does", () => {
    const built = (saltMode?: 'v1') =>
      toSession({
        chain: base,
        owners,
        permissions: [
          {
            abi: [
              {
                type: 'function',
                name: 'approve',
                stateMutability: 'nonpayable',
                inputs: [
                  { name: 'spender', type: 'address' },
                  { name: 'amount', type: 'uint256' },
                ],
                outputs: [{ type: 'bool' }],
              },
            ],
            address: TOKEN,
            functions: {
              approve: {
                spendingLimit: { token: TOKEN, amount: 5_000_000n },
                params: { spender: { condition: 'equal', value: TOKEN } },
              },
            },
          },
        ],
        restrictToActions: true,
        ...(saltMode ? { saltMode } : {}),
      }).actions[0].actionPolicies.map((entry) => entry.policy)

    const [firstDefault, secondDefault] = built()
    const [firstV1, secondV1] = built('v1')

    // Same two policies, opposite order — and the default is untouched, so no
    // existing digest moves.
    expect([firstV1, secondV1]).toEqual([secondDefault, firstDefault])
  })

  // 1.x passes a raw action's policies through in the order given, so the
  // reordering must not reach them: it exists to undo this SDK's own sugar
  // expansion, and applying it to a hand-written action would invent a
  // difference rather than remove one.
  test("'v1' leaves a raw action's policy order alone", () => {
    const policies = [
      { type: 'spending-limits', limits: [{ token: TOKEN, amount: 1n }] },
      { type: 'usage-limit', limit: 2n },
      {
        type: 'universal-action',
        valueLimitPerUse: 0n,
        rules: [
          { condition: 'equal', calldataOffset: 0n, referenceValue: TOKEN },
        ],
      },
    ] satisfies SessionPolicy[]

    const built = (saltMode?: 'v1') =>
      toSession({
        chain: base,
        owners,
        actions: [{ target: TOKEN, selector: '0x095ea7b3', policies }],
        restrictToActions: true,
        ...(saltMode ? { saltMode } : {}),
      })

    expect(built('v1').actions[0].actionPolicies).toEqual(
      built().actions[0].actionPolicies,
    )
  })

  // `'v1'` reproduces the 1.x derivation so a session built there can be rebuilt
  // here. It hashes the actions alone, in build order — deliberately NOT the
  // canonical ordering `'strict'` uses, because matching is the point.
  test("'v1' and 'strict' are different derivations", () => {
    const built = (saltMode: 'v1' | 'strict') =>
      toSession({
        chain: base,
        owners,
        actions: [
          {
            target: TOKEN,
            selector: '0x095ea7b3',
            policies: [{ type: 'sudo' }],
          },
        ],
        restrictToActions: true,
        saltMode,
      }).salt

    expect(built('v1')).not.toBe(built('strict'))
    expect(built('v1')).not.toBe(zeroHash)
  })

  // The permissionId comes from the validator, its init data and the salt — not
  // from the actions. On-chain `enable` ADDS to the policy list rather than
  // replacing it, so two restricted sessions sharing a permissionId would union:
  // the first session's actions stay authorised and the second's restriction
  // buys nothing. Salting by the action set keeps them apart.
  const restricted = (selector: `0x${string}`) =>
    toSession({
      chain: base,
      owners,
      actions: [{ target: TOKEN, selector, policies: [{ type: 'sudo' }] }],
      restrictToActions: true,
      saltMode: 'strict',
    })

  test('gives restricted sessions with different actions different permissionIds', () => {
    expect(restricted('0x095ea7b3').permissionId).not.toBe(
      restricted('0xa9059cbb').permissionId,
    )
  })

  // Every field `_enablePolicies` writes under the permissionId has to be in the
  // salt, or that field alone still collides. Signing config lands in
  // `erc7739Policies`, enabled under the same permissionId as the actions.
  test('separates restricted sessions that differ only by signing', () => {
    const withSigning = (mode: 'disabled' | 'unrestricted') =>
      toSession({
        chain: base,
        owners,
        actions: [
          {
            target: TOKEN,
            selector: '0x095ea7b3',
            policies: [{ type: 'sudo' }],
          },
        ],
        restrictToActions: true,
        saltMode: 'strict',
        signing: { mode },
      }).permissionId

    expect(withSigning('disabled')).not.toBe(withSigning('unrestricted'))
  })

  // On-chain, actions are keyed by action id, so the same set listed in a
  // different order is the same authorisation and must not move the id.
  test('is independent of the order actions are listed in', () => {
    const ordered = (selectors: `0x${string}`[]) =>
      toSession({
        chain: base,
        owners,
        actions: selectors.map((selector) => ({
          target: TOKEN,
          selector,
          policies: [{ type: 'sudo' as const }],
        })),
        restrictToActions: true,
        saltMode: 'strict',
      }).permissionId

    expect(ordered(['0x095ea7b3', '0xa9059cbb'])).toBe(
      ordered(['0xa9059cbb', '0x095ea7b3']),
    )
  })

  test('salts a restricted session by its actions', () => {
    expect(restricted('0x095ea7b3').salt).not.toBe(zeroHash)
  })

  // Unrestricted sessions keep the zero salt their stored signatures cover —
  // the pinned sudo vector above is the other half of this guarantee.
  test('leaves an unrestricted session on the zero salt', () => {
    expect(toSession({ chain: base, owners }).salt).toBe(zeroHash)
    expect(toSession({ chain: base, owners, saltMode: 'strict' }).salt).toBe(
      zeroHash,
    )
  })

  test('rejects two actions colliding on one (target, selector)', () => {
    // Both map to the same on-chain action id, so one would overwrite the
    // other's policies without warning.
    expect(() =>
      toSession({
        chain: base,
        owners,
        actions: [
          {
            target: TOKEN,
            selector: '0x095ea7b3',
            policies: [{ type: 'sudo' }],
          },
          {
            target: TOKEN,
            selector: '0x095ea7b3',
            policies: [{ type: 'value-limit', limit: 1n }],
          },
        ],
        restrictToActions: true,
      }),
    ).toThrow(/Duplicate scoped action/)
  })
})
