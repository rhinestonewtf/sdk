import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  pad,
  toFunctionSelector,
  zeroHash,
} from 'viem'
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  optimism,
  plasma,
} from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../../test/consts'
import {
  type RuleUsage,
  satisfiesRules,
} from '../../../../../test/utils/policy-rules'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { resolveCrossChainPermission } from '../cross-chain-permits'
import {
  type ResolveSessionOptions,
  resolveSessionData as resolveBare,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  toSession as toSessionBare,
} from '../resolve'
import { swapperAddresses } from '../swap/rhinestone'
import type { CrossChainPermissionInput, SessionDefinition } from '../types'
import { DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR } from './cctp'
import { PUBLISH_AND_FUND_SELECTOR } from './eco'
import { LZ_EXECUTE_SELECTOR } from './lz'
import { OFT_SEND_SELECTOR, oftAbi } from './oft'
import { resolveSettlementScope } from './scope'
import type { SettlementAddresses, SettlementCatalog } from './types'

const withSettlement = (options: ResolveSessionOptions = {}) => ({
  settlement: SETTLEMENT_CATALOG,
  ...options,
})
const resolveSessionData = (
  definition: SessionDefinition,
  options?: ResolveSessionOptions,
) => resolveBare(definition, withSettlement(options))
const toSession = (
  definition: SessionDefinition,
  options?: ResolveSessionOptions,
) => toSessionBare(definition, withSettlement(options))

const OFT_ARB = SETTLEMENT_CATALOG[42161].oft!
const OFT_PLASMA = SETTLEMENT_CATALOG[9745].oft!
const LZ_BASE = SETTLEMENT_CATALOG[base.id].lz!
const ECO_PORTAL = SETTLEMENT_CATALOG[base.id].eco!.portal

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
        '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
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
    expect(data.erc7739Policies.erc1271Policies).toEqual([])
  })

  test('uses the testnet TokenMessenger on a testnet chain', () => {
    const data = resolveSessionData(
      definition(
        {
          from: {
            chain: baseSepolia,
            token: SETTLEMENT_CATALOG[84532].cctp!.usdc,
          },
          to: {
            chain: arbitrumSepolia,
            token: SETTLEMENT_CATALOG[421614].cctp!.usdc,
          },
        },
        { chain: baseSepolia },
      ),
    )
    expect(data.actions[0].actionTarget).toBe(
      '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
    )
  })

  test('refuses an IntentExecutor-layer permit without served settlement addresses', () => {
    const message =
      "IntentExecutor-layer permits need the orchestrator's settlement addresses"
    expect(() => resolveBare(definition())).toThrow(message)
    expect(() => toSessionBare(definition())).toThrow(message)
    expect(() =>
      resolveBare(definition({ settlementLayers: ['LZ'] }, withOnce)),
    ).toThrow(message)
  })

  test('a SAME_CHAIN_IE transfer pins no served address, so needs none', () => {
    const data = resolveBare(
      definition({
        to: { chain: base, token: USDC, recipient: OTHER },
        settlementLayers: ['SAME_CHAIN_IE'],
        allowRecipientNotAccount: true,
      }),
    )
    expect(data.actions[0].actionTarget).toBe(USDC)
  })

  test('refuses a layer the orchestrator serves no block for on a chain', () => {
    const { cctp: _, ...arbitrumServed } = SETTLEMENT_CATALOG[arbitrum.id]
    const settlement = { ...SETTLEMENT_CATALOG, [arbitrum.id]: arbitrumServed }
    expect(() => resolveSessionData(definition(), { settlement })).toThrow(
      'CCTP does not route to chain 42161',
    )
    const { cctp: __, ...baseServed } = SETTLEMENT_CATALOG[base.id]
    expect(() =>
      resolveSessionData(definition(), {
        settlement: { ...SETTLEMENT_CATALOG, [base.id]: baseServed },
      }),
    ).toThrow('CCTP does not route to chain 8453')
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

  test('an OFT permit restricts the session to the adapter send and approve', () => {
    const oft = definition(
      {
        from: { chain: arbitrum, token: OFT_ARB.token },
        to: { chain: plasma, token: OFT_PLASMA.token },
        settlementLayers: ['OFT'],
      },
      { chain: arbitrum, ...withOnce },
    )
    const data = resolveSessionData(oft)
    expect(
      data.actions
        .slice(0, 2)
        .map((a) => [a.actionTarget, a.actionTargetSelector]),
    ).toEqual([
      [OFT_ARB.adapter, OFT_SEND_SELECTOR],
      [OFT_ARB.token, APPROVE],
    ])
    expect(toSession(oft).settlementLayers).toEqual(['OFT'])
    // Without oneTimeUse, repeated dust sends would each burn a LayerZero fee.
    expect(() => resolveSessionData({ ...oft, oneTimeUse: undefined })).toThrow(
      'an OFT permit requires oneTimeUse',
    )
  })

  test('the OFT approve may only name the adapter', () => {
    const resolved = resolveSettlementScope(
      [
        resolveCrossChainPermission({
          from: { chain: arbitrum, token: OFT_ARB.token },
          to: { chain: plasma, token: OFT_PLASMA.token },
          settlementLayers: ['OFT'],
        }),
      ],
      {
        chainId: arbitrum.id,
        environment: 'production',
        account: ACCOUNT,
        oneTimeUse: true,
        settlement: SETTLEMENT_CATALOG,
      },
    )
    const action = resolved?.actions.find((a) => a.selector === APPROVE)
    if (!action) throw new Error('no approve action')
    const approve = (spender: Address) =>
      encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, 100n],
      })
    expect(satisfiesRules(action, approve(OFT_ARB.adapter))).toBe(true)
    expect(satisfiesRules(action, approve(OTHER))).toBe(false)
  })

  describe('OFT to.minAmount', () => {
    const permit = (
      settlementLayers: CrossChainPermissionInput['settlementLayers'],
      extra: Partial<CrossChainPermissionInput> = {},
    ) =>
      resolveCrossChainPermission({
        from: { chain: arbitrum, token: OFT_ARB.token, maxAmount: 100n },
        to: { chain: plasma, token: OFT_PLASMA.token, minAmount: 95n },
        settlementLayers,
        ...extra,
      })
    // ECO_IE settles only with a validUntil at least 7 days ahead.
    const withEco = { validUntil: new Date(2_000_000_000_000) }
    const sendOf = (resolved: ReturnType<typeof resolveSettlementScope>) => {
      const action = resolved?.actions.find(
        (a) => a.selector === OFT_SEND_SELECTOR,
      )
      if (!action) throw new Error('no send')
      return action
    }
    const options = {
      chainId: arbitrum.id,
      environment: 'production',
      account: ACCOUNT,
      oneTimeUse: true,
      settlement: SETTLEMENT_CATALOG,
    } as const
    const send = (amountLD: bigint, minAmountLD: bigint) =>
      encodeFunctionData({
        abi: oftAbi,
        functionName: 'send',
        args: [
          {
            dstEid: OFT_PLASMA.eid,
            to: pad(ACCOUNT),
            amountLD,
            minAmountLD,
            extraOptions: '0x',
            composeMsg: '0x',
            oftCmd: '0x',
          },
          { nativeFee: 1n, lzTokenFee: 0n },
          ACCOUNT,
        ],
      })

    test('floors the send on an OFT-only permit', () => {
      const action = resolveSettlementScope([permit(['OFT'])], options)
        ?.actions[0]
      if (action?.selector !== OFT_SEND_SELECTOR) throw new Error('no send')
      expect(satisfiesRules(action, send(100n, 95n))).toBe(true)
      expect(satisfiesRules(action, send(100n, 94n))).toBe(false)
      expect(satisfiesRules(action, send(100n, 0n))).toBe(false)
    })

    test('is refused beside CCTP, which cannot enforce it', () => {
      expect(() =>
        resolveSettlementScope([permit(['OFT', 'CCTP'])], options),
      ).toThrow('CCTP cannot enforce `to.minAmount`')
    })

    test("settles over OFT alone under 'all' when ECO_IE cannot settle the permit", () => {
      // No validUntil: ECO_IE is dropped, and CCTP cannot enforce the floor.
      const resolved = resolveSettlementScope([permit('all')], options)
      expect(resolved?.settlementLayers).toEqual(['OFT'])
      const action = sendOf(resolved)
      expect(satisfiesRules(action, send(100n, 95n))).toBe(true)
      expect(satisfiesRules(action, send(100n, 94n))).toBe(false)
    })

    test.each([
      ['beside ECO_IE', ['ECO_IE', 'OFT'] as const],
      ["under 'all'", 'all' as const],
    ])('floors the send %s', (_, layers) => {
      const resolved = resolveSettlementScope(
        [permit(layers === 'all' ? layers : [...layers], withEco)],
        options,
      )
      expect(resolved?.settlementLayers).toEqual(['OFT', 'ECO_IE'])
      const action = sendOf(resolved)
      expect(satisfiesRules(action, send(100n, 95n))).toBe(true)
      expect(satisfiesRules(action, send(100n, 94n))).toBe(false)
    })

    test("drops OFT under 'all' when it cannot meet the floor", () => {
      // ECO_IE takes a floor above maxAmount; OFT admits no send under it.
      const over = { to: { ...permit('all').to![0], minAmount: 101n } }
      expect(
        resolveSettlementScope(
          [permit('all', { ...withEco, ...over })],
          options,
        )?.settlementLayers,
      ).toEqual(['ECO_IE'])
      expect(() =>
        resolveSettlementScope(
          [permit(['ECO_IE', 'OFT'], { ...withEco, ...over })],
          options,
        ),
      ).toThrow('an OFT `to.minAmount` above `maxAmount` admits no send')
    })
  })

  test('an LZ permit restricts the session to execute and the TransferDelegate approve', () => {
    const lz = definition({ settlementLayers: ['LZ'] }, withOnce)
    const data = resolveSessionData(lz)
    expect(
      data.actions
        .slice(0, 2)
        .map((a) => [a.actionTarget, a.actionTargetSelector]),
    ).toEqual([
      [LZ_BASE.multiCall, LZ_EXECUTE_SELECTOR],
      [USDC, APPROVE],
    ])
    expect(toSession(lz).settlementLayers).toEqual(['LZ'])
    // Each Stargate send burns a LayerZero fee, as OFT's does.
    expect(() => resolveSessionData({ ...lz, oneTimeUse: undefined })).toThrow(
      'an LZ permit requires oneTimeUse',
    )
  })

  test('the LZ approve may only name the TransferDelegate', () => {
    const resolved = resolveSettlementScope(
      [
        resolveCrossChainPermission({
          from: { chain: base, token: USDC, maxAmount: 100n },
          to: { chain: arbitrum, token: USDC_ARB },
          settlementLayers: ['LZ'],
        }),
      ],
      {
        chainId: base.id,
        environment: 'production',
        account: ACCOUNT,
        oneTimeUse: true,
        settlement: SETTLEMENT_CATALOG,
      },
    )
    const action = resolved?.actions.find((a) => a.selector === APPROVE)
    if (!action) throw new Error('no approve action')
    const approve = (spender: Address, amount = 100n) =>
      encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, amount],
      })
    const delegate = LZ_BASE.transferDelegate
    expect(satisfiesRules(action, approve(delegate))).toBe(true)
    expect(satisfiesRules(action, approve(delegate, 101n))).toBe(false)
    // The burning transaction admits every later op, so the cap is a total across
    // approves, not a per-call bound.
    const usage: RuleUsage = new Map()
    expect(satisfiesRules(action, approve(delegate, 60n), usage)).toBe(true)
    expect(satisfiesRules(action, approve(delegate, 60n), usage)).toBe(false)
    expect(satisfiesRules(action, approve(delegate, 40n), usage)).toBe(true)
    // LZMultiCall runs whatever it is handed, so it must never hold an allowance.
    expect(satisfiesRules(action, approve(LZ_BASE.multiCall))).toBe(false)
  })

  describe('SAME_CHAIN_IE', () => {
    const sameChain = (to: CrossChainPermissionInput['to']) =>
      definition({
        to,
        settlementLayers: ['SAME_CHAIN_IE'],
        allowRecipientNotAccount: true,
      })

    test('a transfer permit restricts the session to that transfer', () => {
      const data = resolveSessionData(
        sameChain({ chain: base, token: USDC, recipient: OTHER }),
      )
      expect(data.actions[0]).toMatchObject({
        actionTarget: USDC,
        actionTargetSelector: toFunctionSelector('transfer(address,uint256)'),
      })
      expect(
        data.actions.some(
          (a) => a.actionTarget === SMART_SESSIONS_FALLBACK_TARGET_FLAG,
        ),
      ).toBe(false)
      expect(data.erc7739Policies.erc1271Policies).toEqual([])
    })

    test('a swap permit compiles through the swap scope, one params policy per action', () => {
      const WETH = '0x4200000000000000000000000000000000000006' as Address
      const def = sameChain({
        chain: base,
        token: WETH,
        recipient: OTHER,
        minAmount: 5n,
      })
      const permit = def.crossChainPermits?.[0]
      const data = resolveSessionData({
        ...def,
        ...withOnce,
        crossChainPermits: [
          { ...permit, from: { chain: base, token: USDC, maxAmount: 100n } },
        ],
      })
      // The floor joins the Swapper's params policy; a second copy of that
      // policy would overwrite the pins on-chain.
      for (const action of data.actions) {
        const policies = action.actionPolicies.map((p) =>
          p.policy.toLowerCase(),
        )
        expect(new Set(policies).size).toBe(policies.length)
      }
      const targets = data.actions.map((a) => a.actionTarget.toLowerCase())
      expect(targets).toContain(USDC.toLowerCase())
      expect(targets).toContain(
        swapperAddresses('production').swapper.toLowerCase(),
      )
    })

    test('refuses to.minAmount on another layer', () => {
      expect(() =>
        resolveSessionData(
          definition({
            to: { chain: arbitrum, token: USDC_ARB, minAmount: 1n },
          }),
        ),
      ).toThrow('CCTP cannot enforce `to.minAmount`')
      expect(() =>
        resolveSessionData(
          definition({
            to: { chain: arbitrum, token: USDC_ARB, minAmount: 1n },
            settlementLayers: ['ACROSS'],
          }),
        ),
      ).toThrow('`to.minAmount` does not apply to Permit2 layers')
    })
  })

  describe('ECO_IE', () => {
    const eco = (permit: Partial<CrossChainPermissionInput> = {}) =>
      definition(
        {
          from: { chain: base, token: USDC, maxAmount: 100n },
          to: { chain: arbitrum, token: USDC_ARB },
          settlementLayers: ['ECO_IE'],
          maxFeeBps: 50,
          validUntil: new Date(2_000_000_000_000),
          ...permit,
        },
        withOnce,
      )

    test('the served prover order does not change the session', () => {
      const reversed = (id: number): SettlementAddresses => ({
        ...SETTLEMENT_CATALOG[id],
        eco: {
          ...SETTLEMENT_CATALOG[id].eco!,
          provers: [...SETTLEMENT_CATALOG[id].eco!.provers].reverse(),
        },
      })
      const settlement = {
        ...SETTLEMENT_CATALOG,
        [base.id]: reversed(base.id),
        [arbitrum.id]: reversed(arbitrum.id),
      }
      // Base and Arbitrum share three provers, so the order is observable.
      expect(SETTLEMENT_CATALOG[base.id].eco!.provers).toHaveLength(3)
      expect(toSession(eco(), { settlement })).toEqual(toSession(eco()))
    })

    test('restricts the session to the Portal publish and approve', () => {
      const data = resolveSessionData(eco())
      expect(
        data.actions
          .slice(0, 2)
          .map((a) => [a.actionTarget, a.actionTargetSelector]),
      ).toEqual([
        [ECO_PORTAL, PUBLISH_AND_FUND_SELECTOR],
        [USDC, APPROVE],
      ])
      expect(data.erc7739Policies.erc1271Policies).toEqual([])
      expect(toSession(eco()).settlementLayers).toEqual(['ECO_IE'])
    })

    test('the approve may only name the Portal', () => {
      const resolved = resolveSettlementScope(
        [resolveCrossChainPermission(eco().crossChainPermits?.[0] ?? {})],
        {
          chainId: base.id,
          environment: 'production',
          account: ACCOUNT,
          oneTimeUse: true,
          settlement: SETTLEMENT_CATALOG,
        },
      )
      const action = resolved?.actions.find((a) => a.selector === APPROVE)
      if (!action) throw new Error('no approve action')
      const approve = (spender: Address, amount = 100n) =>
        encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [spender, amount],
        })
      expect(satisfiesRules(action, approve(ECO_PORTAL))).toBe(true)
      // maxAmount is 100: no larger allowance may outlive the session.
      expect(satisfiesRules(action, approve(ECO_PORTAL, 101n))).toBe(false)
      expect(satisfiesRules(action, approve(OTHER))).toBe(false)
    })

    test('requires oneTimeUse, through its mandatory validUntil and maxAmount', () => {
      expect(() =>
        resolveSessionData({ ...eco(), oneTimeUse: undefined }),
      ).toThrow('supports validUntil only together with oneTimeUse')
    })

    test.each([
      ['on CCTP', definition({ maxFeeBps: 50 })],
      [
        'on a Permit2 layer',
        definition({ settlementLayers: ['ACROSS'], maxFeeBps: 50 }),
      ],
    ])('refuses maxFeeBps %s', (_, def) => {
      expect(() => resolveSessionData(def)).toThrow(
        'maxFeeBps applies only to ECO',
      )
    })

    const USDT0_ARB = SETTLEMENT_CATALOG[arbitrum.id].eco!.stablecoins[1]
    const WETH_ARB = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1' as Address
    const toUsdt = {
      to: { chain: arbitrum, token: USDT0_ARB, minAmount: 98n },
      maxFeeBps: undefined,
    }

    test('takes a to.minAmount in place of maxFeeBps, for served tokens', () => {
      expect(toSession(eco(toUsdt)).settlementLayers).toEqual(['ECO_IE'])
      expect(() =>
        resolveSessionData(
          eco({ to: { ...toUsdt.to, token: WETH_ARB }, maxFeeBps: undefined }),
        ),
      ).toThrow('ECO_IE moves only USD stablecoins; the `to` token')
    })

    describe('a to.minAmount beside CCTP, which cannot enforce it', () => {
      const scoped = (
        minAmount?: bigint,
        settlementLayers: CrossChainPermissionInput['settlementLayers'] = [
          'CCTP',
          'ECO_IE',
        ],
      ) =>
        resolveSettlementScope(
          [
            resolveCrossChainPermission(
              eco({
                to: { chain: arbitrum, token: USDC_ARB, minAmount },
                maxFeeBps: 100,
                settlementLayers,
              }).crossChainPermits?.[0] ?? {},
            ),
          ],
          {
            chainId: base.id,
            environment: 'production',
            account: ACCOUNT,
            oneTimeUse: true,
            settlement: SETTLEMENT_CATALOG,
          },
        )
      const floorsOf = (minAmount?: bigint) => {
        const policy = scoped(minAmount, ['ECO_IE'])?.actions.find(
          (a) => a.selector === PUBLISH_AND_FUND_SELECTOR,
        )?.policies?.[0]
        if (policy?.type !== 'arg-policy') throw new Error('no arg policy')
        const out: bigint[] = []
        const walk = (e: typeof policy.expression): void => {
          if (e.type === 'rule') {
            if (e.rule.condition === 'greaterThanOrEqual')
              out.push(BigInt(e.rule.referenceValue))
          } else if (e.type === 'not') walk(e.child)
          else {
            walk(e.left)
            walk(e.right)
          }
        }
        walk(policy.expression)
        return out
      }

      test('is refused when CCTP is named', () => {
        expect(scoped()?.settlementLayers).toEqual(['CCTP', 'ECO_IE'])
        expect(() => scoped(100n)).toThrow('CCTP cannot enforce `to.minAmount`')
      })

      test("drops CCTP under 'all' and settles over the layers left", () => {
        expect(scoped(undefined, 'all')?.settlementLayers).toContain('CCTP')
        const resolved = scoped(100n, 'all')
        expect(resolved?.settlementLayers).toEqual(['ECO_IE'])
        expect(
          resolved?.actions.some(
            (a) => a.selector === DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR,
          ),
        ).toBe(false)
      })

      test('ECO_IE floors at the higher of maxFeeBps and the floor', () => {
        // cap 100 at 100 bps floors at 99; the owner's 100 is stricter.
        expect(floorsOf()).toEqual([99n, 99n])
        expect(floorsOf(100n)).toEqual([100n, 100n])
      })
    })

    // USDC to USDT0 without validUntil: only ECO_IE could floor it, and 'all'
    // drops it.
    test("refuses a to.minAmount under 'all' when no layer can enforce it", () => {
      expect(() =>
        resolveSessionData(
          eco({ ...toUsdt, settlementLayers: 'all', validUntil: undefined }),
        ),
      ).toThrow('no IntentExecutor layer can settle this permit')
    })

    describe('a to.minAmount across source chains with different caps', () => {
      const USDC_OP = SETTLEMENT_CATALOG[optimism.id].eco!.stablecoins[0]
      const spread = (arbCap: bigint | undefined, maxFeeBps?: number) =>
        eco({
          from: [
            { chain: base, token: USDC, maxAmount: 1000n * 10n ** 6n },
            { chain: arbitrum, token: USDC_ARB, maxAmount: arbCap },
          ],
          to: { chain: optimism, token: USDC_OP, minAmount: 550n * 10n ** 6n },
          maxFeeBps,
        })

      // A 550 USDC floor fits the Arbitrum cap of 600, and lets the Base key pay
      // a 1000 USDC reward for 550.
      test.each([
        ['different caps', 600n * 10n ** 6n],
        ['a leg with no cap', undefined],
      ])('refuses %s without maxFeeBps', (_, arbCap) => {
        expect(() => resolveSessionData(spread(arbCap))).toThrow(
          '`from` legs with different maxAmount need maxFeeBps',
        )
      })

      test('admits them with maxFeeBps, and equal caps without', () => {
        expect(
          toSession(spread(600n * 10n ** 6n, 100)).settlementLayers,
        ).toEqual(['ECO_IE'])
        expect(toSession(spread(1000n * 10n ** 6n)).settlementLayers).toEqual([
          'ECO_IE',
        ])
      })
    })
  })

  test('refuses an action carrying the same policy twice', () => {
    // Enabling keeps one config per policy and action, so the second would
    // silently replace the first.
    const rule = {
      condition: 'equal',
      calldataOffset: 0n,
      referenceValue: 1n,
    } as const
    expect(() =>
      resolveSessionData({
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA] },
        restrictToActions: true,
        actions: [
          {
            target: USDC,
            selector: APPROVE,
            policies: [
              { type: 'universal-action', rules: [rule] },
              { type: 'universal-action', rules: [rule] },
            ],
          },
        ],
      }),
    ).toThrow('twice; the second config would overwrite the first on-chain')
  })

  test('refuses a permit naming a layer that does not route from the chain', () => {
    expect(() =>
      resolveSessionData(
        definition({ settlementLayers: ['CCTP', 'OFT'] }, withOnce),
      ),
    ).toThrow('OFT does not route to chain 8453')
  })

  test.each(['ACROSS', 'ECO', 'SAME_CHAIN'] as const)(
    'a %s permit keeps its Permit2 shape',
    (layer) => {
      const permit = definition({ settlementLayers: [layer] })
      const data = resolveSessionData(permit)
      expect(data.erc7739Policies.erc1271Policies).toHaveLength(1)
      expect(
        data.actions.some(
          (a) => a.actionTarget === SMART_SESSIONS_FALLBACK_TARGET_FLAG,
        ),
      ).toBe(true)
      expect(toSession(permit).settlementLayers).toBeUndefined()
    },
  )

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
        'a destination token CCTP does not mint',
        definition({ to: { chain: arbitrum, token: OTHER } }),
        'CCTP moves only USDC; the `to` token on chain 42161',
      ],
      [
        'two maxAmounts on one chain',
        definition(
          {
            from: [
              { chain: base, token: USDC, maxAmount: 1n },
              { chain: base, token: OTHER, maxAmount: 1n },
            ],
          },
          withOnce,
        ),
        'maxAmount on at most one `from` token per chain',
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

  test("recipient 'any' is left open when allowRecipientNotAccount is set", () => {
    expect(() =>
      resolveSessionData(
        definition({
          to: { chain: arbitrum, token: USDC_ARB, recipient: 'any' },
          allowRecipientNotAccount: true,
        }),
      ),
    ).not.toThrow()
  })

  test('refuses two IntentExecutor-layer permits in one session', () => {
    const def = definition()
    const twice = {
      ...def,
      crossChainPermits: [
        ...(def.crossChainPermits ?? []),
        ...(def.crossChainPermits ?? []),
      ],
    } as SessionDefinition
    expect(() => resolveSessionData(twice)).toThrow(
      'at most one IntentExecutor-layer permit per session',
    )
  })
})

describe('settlement-scoped session salt', () => {
  const plain = {
    chain: base,
    owners: { type: 'ecdsa', accounts: [accountA] },
  } as SessionDefinition

  test('salts a settlement-scoped session without oneTimeUse or saltMode', () => {
    const scoped = toSession(definition())
    expect(scoped.salt).not.toBe(zeroHash)
    expect(scoped.permissionId).not.toBe(toSession(plain).permissionId)
  })

  test('the salt is the strict one', () => {
    expect(toSession(definition()).salt).toBe(
      toSession(definition({}, { saltMode: 'strict' })).salt,
    )
    expect(toSession(definition({}, { saltMode: 'none' })).salt).toBe(
      toSession(definition({}, { saltMode: 'strict' })).salt,
    )
  })

  test("refuses saltMode 'v1'", () => {
    expect(() => toSession(definition({}, { saltMode: 'v1' }))).toThrow(
      "crossChainPermits: a settlement-scoped session cannot use saltMode 'v1'",
    )
  })

  test('leaves a plain or restrictToActions session without saltMode on zeroHash', () => {
    expect(toSession(plain).salt).toBe(zeroHash)
    expect(
      toSession({
        ...plain,
        restrictToActions: true,
        actions: [{ target: USDC, selector: APPROVE }],
      } as SessionDefinition).salt,
    ).toBe(zeroHash)
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
      {
        chainId: base.id,
        environment: 'production',
        account: ACCOUNT,
        oneTimeUse: false,
        settlement: SETTLEMENT_CATALOG,
      },
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

  test.each([
    ['validAfter', { validAfter: new Date(1_900_000_000_000) }],
    [
      'validAfter with validUntil',
      {
        validAfter: new Date(1_900_000_000_000),
        validUntil: new Date(2_000_000_000_000),
      },
    ],
    [
      'validUntil without oneTimeUse',
      { validUntil: new Date(2_000_000_000_000) },
    ],
  ])('refuses %s, a window that needs oneTimeUse', (_, window) => {
    expect(() => scope(window)).toThrow(
      'supports validUntil only together with oneTimeUse, and does not support validAfter',
    )
  })

  test('refuses a permit with no `from` legs', () => {
    expect(() => scope({ from: undefined })).toThrow(
      'no `from` token on chain 8453',
    )
  })

  test('a raw permit without recipientIsAccount defaults to the account', () => {
    const resolve = () =>
      resolveSettlementScope(
        [
          {
            from: [{ chain: base, token: USDC }],
            to: [{ chain: arbitrum, token: USDC_ARB }],
            settlementLayers: ['CCTP'],
          },
        ],
        {
          chainId: base.id,
          environment: 'production',
          account: undefined,
          oneTimeUse: false,
          settlement: SETTLEMENT_CATALOG,
        },
      )
    expect(resolve).toThrow('needs `account` on the session definition')
  })
})

describe('each layer pins the source chain served addresses', () => {
  const SRC = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address
  const SRC_2 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2' as Address
  const DST = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address
  const DST_2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2' as Address

  /** The fixture with the given blocks replaced, so source and destination differ. */
  const withBlocks = (
    blocks: Record<number, SettlementAddresses>,
  ): SettlementCatalog => {
    const out: Record<number, SettlementAddresses> = { ...SETTLEMENT_CATALOG }
    for (const [id, block] of Object.entries(blocks)) {
      out[Number(id)] = { ...SETTLEMENT_CATALOG[Number(id)], ...block }
    }
    return out
  }
  const resolve = (
    permit: CrossChainPermissionInput,
    chainId: number,
    settlement: SettlementCatalog,
  ) => {
    const resolved = resolveSettlementScope(
      [resolveCrossChainPermission(permit)],
      {
        chainId,
        environment: 'production',
        account: ACCOUNT,
        oneTimeUse: true,
        settlement,
      },
    )
    if (!resolved) throw new Error('expected a settlement scope')
    const approve = resolved.actions.find((a) => a.selector === APPROVE)
    if (!approve) throw new Error('no approve action')
    return { target: resolved.actions[0].target, approve }
  }
  const approves = (
    action: Parameters<typeof satisfiesRules>[0],
    spender: Address,
  ) =>
    satisfiesRules(
      action,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, 100n],
      }),
    )

  test('CCTP: the source TokenMessenger', () => {
    const cctp = (id: number, tokenMessenger: Address) => ({
      cctp: { ...SETTLEMENT_CATALOG[id].cctp!, tokenMessenger },
    })
    const { target, approve } = resolve(
      {
        from: { chain: base, token: USDC },
        to: { chain: arbitrum, token: USDC_ARB },
        settlementLayers: ['CCTP'],
      },
      base.id,
      withBlocks({
        [base.id]: cctp(base.id, SRC),
        [arbitrum.id]: cctp(arbitrum.id, DST),
      }),
    )
    expect(target).toBe(SRC)
    expect(approves(approve, SRC)).toBe(true)
    expect(approves(approve, DST)).toBe(false)
  })

  test('OFT: the source adapter', () => {
    const oft = (id: number, adapter: Address) => ({
      oft: { ...SETTLEMENT_CATALOG[id].oft!, adapter },
    })
    const { target, approve } = resolve(
      {
        from: { chain: arbitrum, token: OFT_ARB.token },
        to: { chain: plasma, token: OFT_PLASMA.token },
        settlementLayers: ['OFT'],
      },
      arbitrum.id,
      withBlocks({
        [arbitrum.id]: oft(arbitrum.id, SRC),
        [plasma.id]: oft(plasma.id, DST),
      }),
    )
    expect(target).toBe(SRC)
    expect(approves(approve, SRC)).toBe(true)
    expect(approves(approve, DST)).toBe(false)
  })

  test('ECO_IE: the source Portal', () => {
    const eco = (id: number, portal: Address) => ({
      eco: { ...SETTLEMENT_CATALOG[id].eco!, portal },
    })
    const { target, approve } = resolve(
      {
        from: { chain: base, token: USDC, maxAmount: 100n },
        to: { chain: arbitrum, token: USDC_ARB },
        settlementLayers: ['ECO_IE'],
        maxFeeBps: 50,
        validUntil: new Date(2_000_000_000_000),
      },
      base.id,
      withBlocks({
        [base.id]: eco(base.id, SRC),
        [arbitrum.id]: eco(arbitrum.id, DST),
      }),
    )
    expect(target).toBe(SRC)
    expect(approves(approve, SRC)).toBe(true)
    expect(approves(approve, DST)).toBe(false)
  })

  test('LZ: the source LZMultiCall and TransferDelegate', () => {
    const lz = (id: number, multiCall: Address, transferDelegate: Address) => ({
      lz: { ...SETTLEMENT_CATALOG[id].lz!, multiCall, transferDelegate },
    })
    const { target, approve } = resolve(
      {
        from: { chain: base, token: USDC, maxAmount: 100n },
        to: { chain: arbitrum, token: USDC_ARB },
        settlementLayers: ['LZ'],
      },
      base.id,
      withBlocks({
        [base.id]: lz(base.id, SRC, SRC_2),
        [arbitrum.id]: lz(arbitrum.id, DST, DST_2),
      }),
    )
    expect(target).toBe(SRC)
    expect(approves(approve, SRC_2)).toBe(true)
    expect(approves(approve, DST_2)).toBe(false)
    expect(approves(approve, DST)).toBe(false)
  })
})
