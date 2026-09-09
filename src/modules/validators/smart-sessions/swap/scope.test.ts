import { zeroHash } from 'viem'
import { base, optimism } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { accountA } from '../../../../../test/consts'
import type { Session } from '../../../../types'
import {
  ARG_POLICY_ADDRESS,
  DUMMY_PRECLAIMOP_SELECTOR,
  getPermissionId,
  getRestrictedSessionSalt,
  getSessionData,
  getStrictSessionSalt,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SUDO_POLICY_ADDRESS,
  VALUE_LIMIT_POLICY_ADDRESS,
} from '../../smart-sessions'
import { fynd } from './fynd'
import { SWAP_EXACT_IN_SELECTOR, SWAP_EXACT_OUT_SELECTOR } from './rhinestone'
import { resolveSwapScope } from './scope'
import {
  ALLOWANCE_HOLDER_EXEC_SELECTOR,
  resolveZeroExSettler,
  ZEROX_SETTLER_FEATURE_ID,
  zeroEx,
} from './zero-ex'

const SELL = '0x1111111111111111111111111111111111111111'
const BUY = '0x2222222222222222222222222222222222222222'
const RECIPIENT = '0x3333333333333333333333333333333333333333'
const SETTLER = '0x4444444444444444444444444444444444444444'

const swap = (
  via?: ReturnType<typeof zeroEx>[] | ReturnType<typeof fynd>[],
) => ({
  sell: { token: SELL, maxTotal: 1_000n },
  buy: { token: BUY },
  to: RECIPIENT,
  ...(via ? { via } : {}),
})

describe('swap scope resolution', () => {
  test('defaults to the Rhinestone Swapper', () => {
    const resolved = resolveSwapScope(swap(), base.id)
    expect(resolved.actions).toHaveLength(3)
    expect(resolved.actions.map((action) => action.selector)).toEqual(
      expect.arrayContaining([
        '0x095ea7b3',
        SWAP_EXACT_IN_SELECTOR,
        SWAP_EXACT_OUT_SELECTOR,
      ]),
    )
  })

  test('a named 0x venue covers direct and wrapped call shapes', () => {
    const resolved = resolveSwapScope(
      swap([zeroEx({ settler: SETTLER })]),
      base.id,
    )
    expect(resolved.actions).toHaveLength(4)
    expect(resolved.actions.map((action) => action.selector)).toEqual(
      expect.arrayContaining([
        '0x095ea7b3',
        ALLOWANCE_HOLDER_EXEC_SELECTOR,
        SWAP_EXACT_IN_SELECTOR,
        SWAP_EXACT_OUT_SELECTOR,
      ]),
    )
    expect(
      resolved.actions.some((action) =>
        action.policies?.some((policy) => policy.type === 'arg-policy'),
      ),
    ).toBe(true)
  })

  // The AllowanceHolder `exec` amount sits at calldata offset 64. A venue cap
  // lands there as a cumulative limit and OVERRIDES the scope-level
  // `sell.maxTotal`, which is the whole point of allowing one beside a pin.
  const execAmountLimit = (via: ReturnType<typeof zeroEx>) => {
    const resolved = resolveSwapScope(swap([via]), base.id)
    const exec = resolved.actions.find(
      (action) => action.selector === ALLOWANCE_HOLDER_EXEC_SELECTOR,
    )
    const rules = (exec?.policies ?? []).flatMap(
      (policy) => (policy as { rules?: unknown[] }).rules ?? [],
    ) as { calldataOffset: bigint; usageLimit?: bigint }[]
    return rules.find((rule) => rule.calldataOffset === 64n)?.usageLimit
  }

  // A pin already bounds a compromised session key, so a cap is not required
  // here — but it stays available for callers who want a ceiling of their own.
  // The type used to forbid the combination outright.
  test('a pinned Settler accepts a cap, which wins over sell.maxTotal', () => {
    expect(execAmountLimit(zeroEx({ settler: SETTLER, maxSpend: 750n }))).toBe(
      750n,
    )
  })

  test('a pinned Settler with no cap falls back to sell.maxTotal', () => {
    expect(execAmountLimit(zeroEx({ settler: SETTLER }))).toBe(1_000n)
  })

  test('multiple venues keep shared wrapped routes pinned with ArgPolicy', () => {
    const resolved = resolveSwapScope(
      {
        ...swap(),
        via: [zeroEx({ settler: SETTLER }), fynd()],
      },
      base.id,
    )
    const wrapped = resolved.actions.filter(
      (action) =>
        action.selector === SWAP_EXACT_IN_SELECTOR ||
        action.selector === SWAP_EXACT_OUT_SELECTOR,
    )
    expect(wrapped).toHaveLength(2)
    expect(
      wrapped.every((action) => action.policies?.[0]?.type === 'arg-policy'),
    ).toBe(true)
  })

  test('resolves the current 0x Settler from registry feature 2', async () => {
    const readContract = vi.fn().mockResolvedValue(SETTLER)
    await expect(resolveZeroExSettler({ readContract })).resolves.toBe(SETTLER)
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ args: [ZEROX_SETTLER_FEATURE_ID] }),
    )
  })

  test('rejects empty, same-token, unsupported and unbounded 0x scopes', () => {
    expect(() => resolveSwapScope({ ...swap(), via: [] }, base.id)).toThrow(
      'must list at least one venue',
    )
    expect(() =>
      resolveSwapScope({ ...swap(), buy: { token: SELL } }, base.id),
    ).toThrow('are the same address')
    expect(() =>
      resolveSwapScope({ ...swap(), via: [fynd()] }, optimism.id),
    ).toThrow('fynd is not available')
    expect(() =>
      resolveSwapScope(
        {
          sell: { token: SELL },
          buy: { token: BUY },
          to: RECIPIENT,
          via: [{ id: '0x', anySettler: true }],
        },
        base.id,
      ),
    ).toThrow('requires maxSpend')
  })
})

describe('restricted v1 sessions', () => {
  const restrictedSession: Session = {
    chain: base,
    owners: { type: 'ecdsa', accounts: [accountA] },
    swap: swap([zeroEx({ settler: SETTLER })]),
  }

  test('removes fallback and ERC-1271 sudo while keeping enable possible', () => {
    const data = getSessionData(restrictedSession)
    expect(data.erc7739Policies).toEqual({
      allowedERC7739Content: [],
      erc1271Policies: [],
    })
    expect(
      data.actions.some(
        (action) => action.actionTarget === SMART_SESSIONS_FALLBACK_TARGET_FLAG,
      ),
    ).toBe(false)

    const dummy = data.actions.find(
      (action) => action.actionTargetSelector === DUMMY_PRECLAIMOP_SELECTOR,
    )
    expect(dummy?.actionPolicies[0].policy).toBe(VALUE_LIMIT_POLICY_ADDRESS)
    expect(
      data.actions.some((action) =>
        action.actionPolicies.some(
          (policy) => policy.policy === ARG_POLICY_ADDRESS,
        ),
      ),
    ).toBe(true)
  })

  test('binds the permission id to the restricted action configuration', () => {
    const changedRecipient: Session = {
      ...restrictedSession,
      swap: {
        ...restrictedSession.swap!,
        to: '0x5555555555555555555555555555555555555555',
      },
    }
    expect(getSessionData(restrictedSession).salt).not.toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    )
    expect(getSessionData(restrictedSession, true).salt).toBe(
      getSessionData(restrictedSession).salt,
    )
    expect(getPermissionId(restrictedSession)).not.toBe(
      getPermissionId(changedRecipient),
    )
  })

  test('rejects fallback actions, duplicate actions and claim policies', () => {
    expect(() =>
      getSessionData({
        ...restrictedSession,
        swap: undefined,
        restrictToActions: true,
        actions: [{}],
      }),
    ).toThrow('do not allow fallback actions')

    const action = {
      target: SELL,
      selector: '0x12345678' as const,
    }
    expect(() =>
      getSessionData({
        ...restrictedSession,
        swap: undefined,
        restrictToActions: true,
        actions: [action, action],
      }),
    ).toThrow('Duplicate scoped action')

    expect(() =>
      getSessionData({
        ...restrictedSession,
        claimPolicies: [
          {
            type: 'permit2-claim',
          },
        ],
      }),
    ).toThrow('cannot use claimPolicies')
  })
})

describe('saltMode', () => {
  const scoped = (extra?: Partial<Session>): Session => ({
    chain: base,
    owners: { type: 'ecdsa', accounts: [accountA] },
    restrictToActions: true,
    actions: [
      { target: SELL, selector: '0xa9059cbb', policies: [{ type: 'sudo' }] },
      {
        target: BUY,
        selector: '0x12345678',
        policies: [{ type: 'value-limit', limit: 5n }],
      },
    ],
    ...extra,
  })

  // Frozen derivations: a change here strands every already-signed session.
  const V1_SALT =
    '0x08060e7ab6e41dfa09c11798c60d867716c8a5fa1308f6ac6c55d8bff0a70cab'
  const STRICT_SALT =
    '0xd30be60c8217a07e1dd8b97153810e0b637940b8db29162f63d1bc644675f146'

  test("default and explicit 'v1' keep the actions-only salt byte-for-byte", () => {
    expect(getSessionData(scoped()).salt).toBe(V1_SALT)
    expect(getSessionData(scoped({ saltMode: 'v1' })).salt).toBe(V1_SALT)
  })

  test("'strict' lands on a different salt and permissionId", () => {
    expect(getSessionData(scoped({ saltMode: 'strict' })).salt).toBe(
      STRICT_SALT,
    )
    expect(getPermissionId(scoped({ saltMode: 'strict' }))).not.toBe(
      getPermissionId(scoped()),
    )
  })

  test("'strict' covers signing and claim config the v1 salt cannot see", () => {
    const { actions } = getSessionData(scoped())
    // the v1 salt is a function of the actions alone — any two sessions that
    // agree on actions collide on the same permissionId and union on enable
    expect(getRestrictedSessionSalt(actions)).toBe(V1_SALT)

    const noSigning = { allowedERC7739Content: [], erc1271Policies: [] }
    const baseline = getStrictSessionSalt(actions, noSigning, [])
    expect(
      getStrictSessionSalt(
        actions,
        {
          allowedERC7739Content: [],
          erc1271Policies: [{ policy: SUDO_POLICY_ADDRESS, initData: '0x' }],
        },
        [],
      ),
    ).not.toBe(baseline)
    expect(
      getStrictSessionSalt(
        actions,
        {
          allowedERC7739Content: [
            { appDomainSeparator: zeroHash, contentNames: [''] },
          ],
          erc1271Policies: [],
        },
        [],
      ),
    ).not.toBe(baseline)
    expect(
      getStrictSessionSalt(actions, noSigning, [
        { policy: SUDO_POLICY_ADDRESS, initData: '0x' },
      ]),
    ).not.toBe(baseline)
  })

  test("'strict' is independent of action listing order; 'v1' is not", () => {
    const reversed = scoped({ actions: [...scoped().actions!].reverse() })
    expect(getSessionData({ ...reversed, saltMode: 'strict' }).salt).toBe(
      STRICT_SALT,
    )
    expect(getSessionData(reversed).salt).not.toBe(V1_SALT)
  })

  test('unrestricted sessions stay on zeroHash in both modes', () => {
    const open = scoped({ restrictToActions: false })
    expect(getSessionData({ ...open, saltMode: 'strict' }).salt).toBe(zeroHash)
    expect(getSessionData({ ...open, saltMode: 'v1' }).salt).toBe(zeroHash)
  })
})
