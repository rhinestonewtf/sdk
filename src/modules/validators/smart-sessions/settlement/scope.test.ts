import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  toFunctionSelector,
} from 'viem'
import { arbitrum, base, baseSepolia } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../../test/consts'
import { satisfiesRules } from '../../../../../test/utils/policy-rules'
import { resolveCrossChainPermission } from '../cross-chain-permits'
import {
  resolveSessionData,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  toSession,
} from '../resolve'
import type { CrossChainPermissionInput, SessionDefinition } from '../types'
import { DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR } from './cctp'
import { resolveSettlementScope } from './scope'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
const APPROVE = toFunctionSelector('approve(address,uint256)')

function definition(
  permit: Partial<CrossChainPermissionInput> = {},
  extra: Partial<SessionDefinition> = {},
): SessionDefinition {
  return {
    chain: base,
    owners: { type: 'ecdsa', accounts: [accountA] },
    account: ACCOUNT,
    crossChainPermits: [
      {
        from: { chain: base, token: USDC },
        to: { chain: arbitrum, token: USDC_ARB },
        settlementLayers: ['CCTP'],
        ...permit,
      },
    ],
    ...extra,
  } as SessionDefinition
}

const withOnce = {
  oneTimeUse: { id: 7n },
  policyAddresses: { oneTimeUseId: ONE_TIME_USE },
} as const

describe('settlement-scoped crossChainPermits', () => {
  test('restricts the session to the approve and the burn', () => {
    const data = resolveSessionData(definition())
    expect(
      data.actions.map((a) => [a.actionTarget, a.actionTargetSelector]),
    ).toEqual([
      [
        '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
        DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR,
      ],
      [USDC, APPROVE],
      // The dummy pre-claim op every session carries, value-capped when restricted.
      [expect.any(String), expect.any(String)],
    ])
    expect(
      data.actions.some(
        (a) => a.actionTarget === SMART_SESSIONS_FALLBACK_TARGET_FLAG,
      ),
    ).toBe(false)
    expect(data.claimPolicies).toEqual([])
  })

  test('uses the testnet TokenMessenger on a testnet chain', () => {
    const data = resolveSessionData(
      definition(
        { from: { chain: baseSepolia, token: USDC } },
        { chain: baseSepolia },
      ),
    )
    expect(data.actions[0].actionTarget).toBe(
      '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    )
  })

  test('the session is action-checked and limits intents to its layers', () => {
    const session = toSession(definition())
    expect(session.hasExplicitPermissions).toBe(true)
    expect(session.settlementLayers).toEqual(['CCTP'])
    expect(session.claimPolicies).toEqual([])
  })

  test('the burn action is bounded by the once-policy too', () => {
    const data = resolveSessionData(
      definition(
        { from: { chain: base, token: USDC, maxAmount: 100n } },
        withOnce,
      ),
    )
    const burn = data.actions.find(
      (a) => a.actionTargetSelector === DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR,
    )
    expect(burn?.actionPolicies.map((p) => p.policy)).toContain(ONE_TIME_USE)
  })

  test('a Permit2-only permit keeps its current shape', () => {
    const permit = definition({ settlementLayers: ['ACROSS'] })
    const data = resolveSessionData(permit)
    expect(data.claimPolicies).toHaveLength(1)
    expect(
      data.actions.some(
        (a) => a.actionTarget === SMART_SESSIONS_FALLBACK_TARGET_FLAG,
      ),
    ).toBe(true)
    expect(toSession(permit).settlementLayers).toBeUndefined()
  })

  describe('refuses', () => {
    test.each([
      [
        'a permit mixing CCTP with a Permit2 layer',
        definition({ settlementLayers: ['CCTP', 'ACROSS'] }),
        'ACROSS cannot share a permit with IntentExecutor layers',
      ],
      [
        'maxAmount without oneTimeUse',
        definition({ from: { chain: base, token: USDC, maxAmount: 100n } }),
        'maxAmount on an IntentExecutor-layer permit requires oneTimeUse',
      ],
      [
        'the account recipient without `account`',
        definition({}, { account: undefined }),
        'needs `account` on the session definition',
      ],
      [
        'a permit with no `to` chains',
        definition({ to: undefined }),
        'must name its `to` chains',
      ],
      [
        'a fillDeadline',
        definition({
          fillDeadline: [{ chain: arbitrum, max: new Date(2e12) }],
        }),
        'fillDeadline applies only to Permit2 layers',
      ],
      [
        'a signing surface',
        definition({}, { signing: { mode: 'unrestricted' } }),
        'cannot enable `signing`',
      ],
      [
        "recipient 'any' without allowRecipientNotAccount",
        definition({
          to: { chain: arbitrum, token: USDC_ARB, recipient: 'any' },
        }),
        "recipient 'any' requires allowRecipientNotAccount",
      ],
      [
        'another recipient without allowRecipientNotAccount',
        definition({
          to: { chain: arbitrum, token: USDC_ARB, recipient: OTHER },
        }),
        'a recipient other than the account requires allowRecipientNotAccount',
      ],
      [
        'a permit with no `from` token on the session chain',
        definition({ from: { chain: arbitrum, token: USDC_ARB } }),
        'no `from` token on chain 8453',
      ],
    ])('%s', (_, def, message) => {
      expect(() => resolveSessionData(def)).toThrow(message)
    })

    test('a settlement-scoped permit next to a Permit2 permit', () => {
      const def = definition()
      const mixed = {
        ...def,
        crossChainPermits: [
          ...(def.crossChainPermits ?? []),
          { from: { chain: base, token: USDC }, settlementLayers: ['ACROSS'] },
        ],
      } as SessionDefinition
      expect(() => resolveSessionData(mixed)).toThrow(
        'cannot mix IntentExecutor-layer permits with Permit2-layer permits',
      )
    })

    test('claimPolicies alongside a settlement-scoped permit', () => {
      expect(() =>
        resolveSessionData(
          definition(
            {},
            { claimPolicies: [{ type: 'permit2', spenders: [OTHER] }] },
          ),
        ),
      ).toThrow(
        'restrictToActions is incompatible with crossChainPermits/claimPolicies',
      )
    })
  })

  test('another recipient is pinned when allowRecipientNotAccount is set', () => {
    expect(() =>
      resolveSessionData(
        definition({
          to: { chain: arbitrum, token: USDC_ARB, recipient: OTHER },
          allowRecipientNotAccount: true,
        }),
      ),
    ).not.toThrow()
  })
})

describe('resolveSettlementScope', () => {
  const scope = (permit: Partial<CrossChainPermissionInput> = {}) => {
    const resolved = resolveSettlementScope(
      [
        resolveCrossChainPermission({
          from: { chain: base, token: USDC },
          to: { chain: arbitrum, token: USDC_ARB },
          settlementLayers: ['CCTP'],
          ...permit,
        }),
      ],
      { chainId: base.id, account: ACCOUNT, oneTimeUse: false },
    )
    if (!resolved) throw new Error('expected a settlement scope')
    return resolved.actions
  }
  const approve = (spender: Address) =>
    encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, 100n],
    })

  test('the approve may only name the TokenMessenger', () => {
    const action = scope().find((a) => a.selector === APPROVE)
    if (!action) throw new Error('no approve action')
    expect(action.target).toBe(USDC)
    expect(
      satisfiesRules(
        action,
        approve('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'),
      ),
    ).toBe(true)
    expect(satisfiesRules(action, approve(OTHER))).toBe(false)
  })

  test('the validity window bounds every action', () => {
    const validAfter = new Date(1_900_000_000_000)
    const validUntil = new Date(2_000_000_000_000)
    const actions = scope({ validAfter, validUntil })
    expect(actions).toHaveLength(2)
    for (const action of actions) {
      expect(action.policies).toContainEqual({
        type: 'time-frame',
        validAfter: validAfter.getTime(),
        validUntil: validUntil.getTime(),
      })
    }
  })
})
