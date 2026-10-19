import {
  type Address,
  type Chain,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  isAddressEqual,
  pad,
} from 'viem'
import { arbitrum, base, optimism, plasma } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { accountA } from '../../../../../test/consts'
import {
  call,
  execute,
  fn,
  ACCOUNT as LZ_ACCOUNT,
  cctp as lzCctp,
} from '../../../../../test/utils/lz-calldata'
import { satisfiesRules as holds } from '../../../../../test/utils/policy-rules'
import { sessionFingerprint } from '../../../../../test/utils/session-fingerprint'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { resolveCrossChainPermission } from '../cross-chain-permits'
import { toSession } from '../resolve'
import { PERMIT2 } from '../swap/stable-floor'
import type {
  CrossChainPermissionInput,
  ScopedAction,
  SessionDefinition,
} from '../types'
import { DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR, tokenMessengerAbi } from './cctp'
import { PUBLISH_AND_FUND_SELECTOR } from './eco'
import { APPROVE_SELECTOR } from './fees'
import { LZ_EXECUTE_SELECTOR } from './lz'
import { resolveSettlementScope } from './scope'
import type { SettlementCatalog } from './types'

// These tests assume the TimeFramePolicy is deployed on their chains.
vi.mock('../policies/addresses', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../policies/addresses')>()),
  timeFramePolicyDeployed: () => true,
}))

const BASE = SETTLEMENT_CATALOG[base.id]
const USDC = getAddress(BASE.cctp!.usdc)
const USDC_ARB = getAddress(SETTLEMENT_CATALOG[arbitrum.id].cctp!.usdc)
const USDC_OP = getAddress(SETTLEMENT_CATALOG[optimism.id].cctp!.usdc)
const WETH = '0x4200000000000000000000000000000000000006' as Address
const WETH_ARB = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address
const CBBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' as Address
const USDT0_OP = getAddress(SETTLEMENT_CATALOG[optimism.id].oft!.token)
const USDT0_ARB = getAddress(SETTLEMENT_CATALOG[arbitrum.id].oft!.token)
const OFT_ARB = SETTLEMENT_CATALOG[arbitrum.id].oft!
const OFT_PLASMA = SETTLEMENT_CATALOG[plasma.id].oft!
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
const VALID_UNTIL = new Date(2_000_000_000_000)
const FEES = {
  appFeeCollector: '0x5555555555555555555555555555555555555555',
  paymaster: '0x6666666666666666666666666666666666666666',
} as const
const CATALOG: SettlementCatalog = {
  ...SETTLEMENT_CATALOG,
  [base.id]: { ...BASE, fees: FEES },
}

function definition(
  permit: Partial<CrossChainPermissionInput>,
  chain: Chain = base,
): SessionDefinition {
  return {
    chain,
    owners: { type: 'ecdsa', accounts: [accountA] },
    account: ACCOUNT,
    oneTimeUse: { id: 7n },
    policyAddresses: { oneTimeUseId: ONE_TIME_USE },
    crossChainPermits: [
      {
        from: { chain: base, token: USDC, maxAmount: 100n },
        to: { chain: arbitrum, token: USDC_ARB },
        ...permit,
      },
    ],
  } as SessionDefinition
}

/** Without oneTimeUse, so `'all'` drops OFT and LZ. */
function reusable(def: SessionDefinition): SessionDefinition {
  const { oneTimeUse: _, policyAddresses: __, ...rest } = def
  return rest as SessionDefinition
}

const fingerprint = (def: SessionDefinition) =>
  sessionFingerprint(toSession(def, { settlement: CATALOG }))

// Definitions that build on origin/main; their sessions must not move.
const EXISTING: Record<string, SessionDefinition> = {
  CCTP: definition({ settlementLayers: ['CCTP'] }),
  'CCTP + LZ': definition({ settlementLayers: ['CCTP', 'LZ'] }),
  'ACROSS + CCTP': definition({ settlementLayers: ['ACROSS', 'CCTP'] }),
  'CCTP two destinations': definition({
    settlementLayers: ['CCTP'],
    to: [
      { chain: arbitrum, token: USDC_ARB },
      { chain: optimism, token: USDC_OP },
    ],
  }),
  'CCTP with fees': definition({ settlementLayers: ['CCTP'], allowFees: true }),
  all: definition({}),
  'all, reusable': reusable(definition({})),
  // Several tokens through scope.ts that no IntentExecutor layer moves.
  'all, WETH + cbBTC': definition({
    from: [
      { chain: base, token: WETH, maxAmount: 10n ** 18n },
      { chain: base, token: CBBTC },
    ],
    to: { chain: arbitrum, token: WETH_ARB },
  }),
  'all, WETH + cbBTC, reusable': reusable(
    definition({
      from: [
        { chain: base, token: WETH },
        { chain: base, token: CBBTC },
      ],
      to: { chain: arbitrum, token: WETH_ARB },
    }),
  ),
  'all, two destinations': definition({
    to: [
      { chain: arbitrum, token: USDC_ARB },
      { chain: optimism, token: USDC_OP },
    ],
  }),
  'ACROSS + CCTP + LZ': definition({
    settlementLayers: ['ACROSS', 'CCTP', 'LZ'],
  }),
  'all, open recipient': definition({
    allowRecipientNotAccount: true,
    to: { chain: arbitrum, token: USDC_ARB, recipient: OTHER },
  }),
  'ACROSS, USDC + WETH': definition({
    from: [
      { chain: base, token: USDC, maxAmount: 100n },
      { chain: base, token: WETH },
    ],
    settlementLayers: ['ACROSS'],
  }),
  ECO_IE: definition({
    settlementLayers: ['ECO_IE'],
    maxFeeBps: 50,
    validUntil: VALID_UNTIL,
  }),
  OFT: definition(
    {
      from: { chain: arbitrum, token: OFT_ARB.token, maxAmount: 100n },
      to: { chain: plasma, token: OFT_PLASMA.token },
      settlementLayers: ['OFT'],
    },
    arbitrum,
  ),
}

describe('multi-token IntentExecutor-layer permits', () => {
  test('sessions that build today keep their fingerprints', () => {
    const fingerprints = Object.fromEntries(
      Object.entries(EXISTING).map(([name, def]) => [name, fingerprint(def)]),
    )
    expect(fingerprints).toMatchInlineSnapshot(`
      {
        "ACROSS + CCTP": "0xa3f485683c64418c4e8475a1308c14b8b71bc548c1c33c80bc78ee468da9a431",
        "ACROSS + CCTP + LZ": "0x033c93c174ccb13dfff1d47cb4d0f5b639b599f4e2fa87fac18c21468e7080dc",
        "ACROSS, USDC + WETH": "0xbfd17fb07ad7e3e3a80cdb178af0a3a6487d77d7aada9b9b023297c47f230f9b",
        "CCTP": "0xbf87b8350c7853b8cd36bbc4335981497686dae2fe923ccbfe54587689249bbb",
        "CCTP + LZ": "0x0bc5f907112192b7bdc7e76c9583af0977d3d8169d3c5d59cb054ed126994754",
        "CCTP two destinations": "0x9ed85e9dda9a3a38779cc847d36a8dc0d4f98e6a1ca675e6b54f9659ead14769",
        "CCTP with fees": "0xf7ad71ccb1ba05a8565fef07e19ba3365d8aaf5bd42841443d6ba2f9f1468cbb",
        "ECO_IE": "0xb62e49180f1d7b6138c048260da917383e59df00125adb8084e872e15ffcb6f0",
        "OFT": "0x098fb71c867c060658796450ebbf82a30248d9a835c674184a80b8500ec567e0",
        "all": "0x033c93c174ccb13dfff1d47cb4d0f5b639b599f4e2fa87fac18c21468e7080dc",
        "all, WETH + cbBTC": "0xf0c7939c45c75a962fba78f8ead56c212814ef8741cfc811b3cce8ba69725544",
        "all, WETH + cbBTC, reusable": "0x28f664d135cb55f09816c517376cda226462946dc2bfe5a57469e3bfab1d78e1",
        "all, open recipient": "0xce4120780f062bfb4b0d2febbd8bec3f0cbe3f1d9c8cc4cfda3975f8be43f727",
        "all, reusable": "0x68bda12d6d633a364e68d89a2bf7c700b204dcf7f5f38cf13bdb4621eeaf413f",
        "all, two destinations": "0x0d62e77786b609381a2ee92f8a62c53bd6932f35d4c872992b0ca2c5c075da0d",
      }
    `)
  })
})

const USDC_AND_WETH: Partial<CrossChainPermissionInput> = {
  from: [
    { chain: base, token: USDC, maxAmount: 100n },
    { chain: base, token: WETH },
  ],
  to: [
    { chain: arbitrum, token: USDC_ARB },
    { chain: arbitrum, token: WETH_ARB },
  ],
}

const scope = (
  permit: Partial<CrossChainPermissionInput>,
  options: {
    oneTimeUse?: boolean
    across?: boolean
    account?: Address
    settlement?: SettlementCatalog
    chainId?: number
  } = {},
) => {
  const resolved = resolveSettlementScope(
    [
      resolveCrossChainPermission({
        settlementLayers: 'all',
        ...definition(permit).crossChainPermits![0],
      }),
    ],
    {
      chainId: options.chainId ?? base.id,
      environment: 'production',
      account: options.account ?? ACCOUNT,
      oneTimeUse: options.oneTimeUse ?? true,
      settlement: options.settlement ?? CATALOG,
      ...(options.across ? { across: {} } : {}),
    },
  )
  if (!resolved) throw new Error('expected a settlement scope')
  return resolved
}

const actionOf = (
  actions: readonly ScopedAction[],
  target: Address,
  selector: Hex,
) => {
  const found = actions.filter(
    (a) => isAddressEqual(a.target, target) && a.selector === selector,
  )
  expect(found).toHaveLength(1)
  return found[0]
}

const approve = (spender: Address, amount = 100n) =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  })

function burn(
  o: Partial<{ token: Address; domain: number; recipient: Address }> = {},
): Hex {
  return encodeFunctionData({
    abi: tokenMessengerAbi,
    functionName: 'depositForBurnWithHook',
    args: [
      100n,
      o.domain ?? SETTLEMENT_CATALOG[arbitrum.id].cctp!.domain,
      pad(o.recipient ?? ACCOUNT),
      o.token ?? USDC,
      pad('0x'),
      1n,
      1000,
      '0x',
    ],
  })
}

const refusalOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    return error as Error & { code?: string; leg?: string; chainId?: number }
  }
  throw new Error('expected a refusal')
}

describe('a permit with tokens only some layers move', () => {
  test('USDC + WETH settles over ACROSS for both and CCTP for USDC', () => {
    const session = toSession(reusable(definition(USDC_AND_WETH)), {
      settlement: CATALOG,
    })
    expect(session.settlementLayers).toEqual(['ACROSS', 'CCTP'])
    expect(
      session.actions
        .slice(0, 3)
        .map((a) => [a.actionTarget, a.actionTargetSelector]),
    ).toEqual([
      [BASE.cctp!.tokenMessenger, DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR],
      [USDC, APPROVE_SELECTOR],
      [WETH, APPROVE_SELECTOR],
    ])
    // ACROSS claims both tokens, delivered to the account only.
    expect(session.claimPolicies).toMatchObject([
      {
        type: 'permit2',
        sourceTokens: [
          { chain: base, address: USDC },
          { chain: base, address: WETH },
        ],
        destinationTokens: [
          { chain: arbitrum, address: USDC_ARB },
          { chain: arbitrum, address: WETH_ARB },
        ],
        recipientIsAccount: true,
      },
    ])
  })

  test('with oneTimeUse, LZ joins for the USDC leg too', () => {
    expect(
      toSession(definition(USDC_AND_WETH), { settlement: CATALOG })
        .settlementLayers,
    ).toEqual(['ACROSS', 'CCTP', 'LZ'])
  })

  test('the CCTP leg burns USDC only, to the account, on a permitted chain', () => {
    const { actions } = scope(USDC_AND_WETH, { across: true })
    const action = actionOf(
      actions,
      BASE.cctp!.tokenMessenger,
      DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR,
    )
    expect(holds(action, burn())).toBe(true)
    expect(holds(action, burn({ token: WETH }))).toBe(false)
    expect(holds(action, burn({ recipient: OTHER }))).toBe(false)
    expect(
      holds(
        action,
        burn({ domain: SETTLEMENT_CATALOG[optimism.id].cctp!.domain }),
      ),
    ).toBe(false)
  })

  test('WETH is approved to Permit2 alone, USDC to the layers that move it', () => {
    const { actions } = scope(USDC_AND_WETH, { across: true })
    const messenger = BASE.cctp!.tokenMessenger
    const delegate = BASE.lz!.transferDelegate
    const weth = actionOf(actions, WETH, APPROVE_SELECTOR)
    expect(holds(weth, approve(PERMIT2))).toBe(true)
    expect(holds(weth, approve(messenger))).toBe(false)
    expect(holds(weth, approve(delegate))).toBe(false)
    const usdc = actionOf(actions, USDC, APPROVE_SELECTOR)
    for (const spender of [PERMIT2, messenger, delegate]) {
      expect(holds(usdc, approve(spender))).toBe(true)
    }
    expect(holds(usdc, approve(OTHER))).toBe(false)
  })

  test('the LZ leg pulls USDC only and delivers to the account', () => {
    const { actions } = scope(USDC_AND_WETH, {
      across: true,
      account: LZ_ACCOUNT,
    })
    const action = actionOf(actions, BASE.lz!.multiCall, LZ_EXECUTE_SELECTOR)
    const calls = (to?: Address) => lzCctp({ pull: 100n, fee: 1n, to })
    expect(holds(action, execute(calls()))).toBe(true)
    expect(holds(action, execute(calls(OTHER)))).toBe(false)
    const [pull, ...rest] = calls()
    const wethPull = call(
      pull.target,
      fn('delegateTransferFrom', [WETH, LZ_ACCOUNT, BASE.lz!.multiCall, 100n]),
    )
    expect(holds(action, execute([wethPull, ...rest]))).toBe(false)
  })

  test('every IE leg pins the recipient to the account', () => {
    const { actions } = scope(
      {
        ...USDC_AND_WETH,
        to: [
          { chain: arbitrum, token: USDC_ARB },
          { chain: optimism, token: USDC_OP },
          { chain: arbitrum, token: WETH_ARB },
        ],
      },
      { across: true },
    )
    const action = actionOf(
      actions,
      BASE.cctp!.tokenMessenger,
      DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR,
    )
    for (const chain of [arbitrum, optimism]) {
      const domain = SETTLEMENT_CATALOG[chain.id].cctp!.domain
      expect(holds(action, burn({ domain }))).toBe(true)
      expect(holds(action, burn({ domain, recipient: OTHER }))).toBe(false)
    }
  })

  test('a token no IE layer moves is left to ACROSS', () => {
    const { actions, settlementLayers } = scope(
      {
        from: [{ chain: base, token: WETH, maxAmount: 100n }],
        to: { chain: arbitrum, token: WETH_ARB },
      },
      { across: true },
    )
    expect(settlementLayers).toEqual(['ACROSS'])
    expect(actions.map((a) => [a.target, a.selector])).toEqual([
      [WETH, APPROVE_SELECTOR],
    ])
  })

  test('without ACROSS, a token no layer moves gets no approve', () => {
    const { actions, settlementLayers } = scope({
      ...USDC_AND_WETH,
      settlementLayers: 'all',
    })
    expect(settlementLayers).toEqual(['CCTP', 'LZ'])
    expect(actions.some((a) => isAddressEqual(a.target, WETH))).toBe(false)
  })

  test('an explicit list refuses a token none of its layers moves', () => {
    const from = refusalOf(() =>
      scope({ ...USDC_AND_WETH, settlementLayers: ['CCTP'] }),
    )
    expect([from.code, from.leg]).toEqual(['TOKEN_NOT_ROUTED', 'from'])
    const to = refusalOf(() =>
      scope({
        to: USDC_AND_WETH.to,
        settlementLayers: ['CCTP'],
      }),
    )
    expect([to.code, to.leg]).toEqual(['TOKEN_NOT_ROUTED', 'to'])
    expect(
      scope(
        { ...USDC_AND_WETH, settlementLayers: ['ACROSS', 'CCTP'] },
        {
          across: true,
        },
      ).settlementLayers,
    ).toEqual(['ACROSS', 'CCTP'])
  })

  test('a layer that moves two of the tokens still takes one', () => {
    const eco = { ...BASE.eco!, stablecoins: [USDC, OTHER] }
    const refused = refusalOf(() =>
      scope(
        {
          from: [
            { chain: base, token: USDC, maxAmount: 100n },
            { chain: base, token: OTHER },
          ],
          settlementLayers: ['ECO_IE'],
          maxFeeBps: 50,
          validUntil: VALID_UNTIL,
        },
        { settlement: { ...CATALOG, [base.id]: { ...CATALOG[base.id], eco } } },
      ),
    )
    expect(refused.code).toBe('ONE_SOURCE_TOKEN')
  })

  test('a layer that moves none of several tokens says so', () => {
    const refused = refusalOf(() =>
      scope({
        from: [
          { chain: base, token: WETH, maxAmount: 100n },
          { chain: base, token: OTHER },
        ],
        settlementLayers: ['CCTP'],
      }),
    )
    expect([refused.code, refused.message]).toEqual([
      'TOKEN_NOT_ROUTED',
      `crossChainPermits: CCTP moves none of the \`from\` tokens on chain ${base.id}`,
    ])
  })
})

describe('caps and fee-paying layers across tokens', () => {
  const OP_STABLES: Partial<CrossChainPermissionInput> = {
    from: [
      { chain: optimism, token: USDC_OP, maxAmount: 100n },
      { chain: optimism, token: USDT0_OP },
    ],
    to: [
      { chain: arbitrum, token: USDC_ARB },
      { chain: arbitrum, token: USDT0_ARB },
    ],
  }

  test("'all' with OFT and LZ both able to settle keeps neither, and builds", () => {
    const uncapped = {
      ...OP_STABLES,
      from: [
        { chain: optimism, token: USDC_OP },
        { chain: optimism, token: USDT0_OP },
      ],
    }
    const session = toSession(definition(uncapped, optimism), {
      settlement: CATALOG,
    })
    expect(session.settlementLayers).toEqual(['ACROSS', 'CCTP'])
    expect(
      session.settlementCoverage?.dropped
        .filter(({ reason }) => reason.includes('each pay a native'))
        .map(({ layer }) => layer),
    ).toEqual(['OFT', 'LZ'])
    // An explicit list still refuses the pair.
    expect(
      refusalOf(() =>
        toSession(
          definition(
            { ...uncapped, settlementLayers: ['OFT', 'LZ'] },
            optimism,
          ),
          { settlement: CATALOG },
        ),
      ).code,
    ).toBe('MULTIPLE_FEE_PAYING_LAYERS')
  })

  test('the USDC-capped USDC + USDT0 permit on Optimism builds', () => {
    const session = toSession(definition(OP_STABLES, optimism), {
      settlement: CATALOG,
    })
    // OFT moves USDT0, which the cap is not set on.
    expect(session.settlementLayers).toEqual(['ACROSS', 'CCTP', 'LZ'])
    expect(
      session.settlementCoverage?.dropped.find(({ layer }) => layer === 'OFT')
        ?.reason,
    ).toContain('maxAmount is set on')
  })

  const WETH_CAPPED: Partial<CrossChainPermissionInput> = {
    ...USDC_AND_WETH,
    from: [
      { chain: base, token: USDC },
      { chain: base, token: WETH, maxAmount: 10n ** 18n },
    ],
  }

  test("'all' drops a layer whose token the cap is not set on", () => {
    const { settlementLayers, dropped } = scope(WETH_CAPPED, { across: true })
    expect(settlementLayers).toEqual(['ACROSS'])
    for (const layer of ['CCTP', 'LZ']) {
      expect(dropped.find((d) => d.layer === layer)?.reason).toBe(
        `${layer} moves ${USDC} on chain ${base.id}, but maxAmount is set on ${WETH}`,
      )
    }
  })

  test('a layer moving the capped token keeps the cap', () => {
    const { actions, settlementLayers } = scope(USDC_AND_WETH, {
      across: true,
    })
    expect(settlementLayers).toEqual(['ACROSS', 'CCTP', 'LZ'])
    const action = actionOf(
      actions,
      BASE.cctp!.tokenMessenger,
      DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR,
    )
    const burnOf = (amount: bigint) =>
      encodeFunctionData({
        abi: tokenMessengerAbi,
        functionName: 'depositForBurnWithHook',
        args: [
          amount,
          SETTLEMENT_CATALOG[arbitrum.id].cctp!.domain,
          pad(ACCOUNT),
          USDC,
          pad('0x'),
          1n,
          1000,
          '0x',
        ],
      })
    expect(holds(action, burnOf(100n))).toBe(true)
    expect(holds(action, burnOf(101n))).toBe(false)
  })

  test('an explicit list refuses a layer whose token the cap is not set on', () => {
    for (const across of [false, true]) {
      const refused = refusalOf(() =>
        scope(
          {
            ...WETH_CAPPED,
            settlementLayers: across ? ['ACROSS', 'CCTP'] : ['CCTP'],
          },
          { across },
        ),
      )
      expect([refused.code, refused.leg]).toEqual([
        'CAP_TOKEN_MISMATCH',
        'from',
      ])
    }
  })

  const STABLES_OP: Partial<CrossChainPermissionInput> = {
    from: [
      { chain: optimism, token: USDC_OP },
      { chain: optimism, token: USDT0_OP },
    ],
    to: [
      { chain: arbitrum, token: USDC_ARB },
      { chain: arbitrum, token: USDT0_ARB, minAmount: 1n },
    ],
  }

  test('a floor binds only the layer that delivers the floored leg', () => {
    const { settlementLayers } = scope(
      { ...STABLES_OP, settlementLayers: ['CCTP', 'OFT'] },
      { chainId: optimism.id },
    )
    expect(settlementLayers).toEqual(['CCTP', 'OFT'])
  })

  test('a floored leg only a non-flooring layer delivers is refused', () => {
    const refused = refusalOf(() =>
      scope(
        {
          ...STABLES_OP,
          to: [
            { chain: arbitrum, token: USDC_ARB, minAmount: 1n },
            { chain: arbitrum, token: USDT0_ARB },
          ],
          settlementLayers: ['CCTP', 'OFT'],
        },
        { chainId: optimism.id },
      ),
    )
    expect(refused.code).toBe('MIN_AMOUNT_NOT_ENFORCEABLE')
  })

  const xLayer = { ...arbitrum, id: 196 } as Chain
  const ARB_AND_XLAYER: Partial<CrossChainPermissionInput> = {
    from: [{ chain: base, token: USDC }],
    to: [
      { chain: arbitrum, token: USDC_ARB },
      { chain: xLayer, token: USDC_ARB },
    ],
  }

  test("'all' keeps CCTP for its leg when another leg targets a chain CCTP does not serve", () => {
    const { settlementLayers, actions } = scope(ARB_AND_XLAYER, {
      across: true,
    })
    expect(settlementLayers).toContain('CCTP')
    const action = actionOf(
      actions,
      BASE.cctp!.tokenMessenger,
      DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR,
    )
    expect(holds(action, burn())).toBe(true)
    expect(holds(action, burn({ recipient: OTHER }))).toBe(false)
  })

  test('an explicit CCTP list refuses a leg no named layer serves', () => {
    const refused = refusalOf(() =>
      scope({ ...ARB_AND_XLAYER, settlementLayers: ['CCTP'] }),
    )
    expect([refused.code, refused.leg]).toEqual(['LAYER_NOT_SERVED', 'to'])
  })

  test('an explicit LZ list refuses a `to` leg on a chain LZ does not reach', () => {
    const xLayer = { ...arbitrum, id: 196 } as Chain
    const refused = refusalOf(() =>
      scope({
        to: [
          { chain: arbitrum, token: USDC_ARB },
          { chain: xLayer, token: USDC_ARB },
        ],
        settlementLayers: ['LZ'],
      }),
    )
    expect([refused.code, refused.leg]).toEqual(['LAYER_NOT_SERVED', 'to'])
  })
})

describe('legs a layer does not deliver', () => {
  test('an explicit LZ list refuses a served `to` leg LZ has no route to', () => {
    const refused = refusalOf(() =>
      scope({
        to: [
          { chain: arbitrum, token: USDC_ARB },
          { chain: base, token: USDC },
        ],
        settlementLayers: ['LZ'],
      }),
    )
    // LZ says why it cannot pin the leg.
    expect(refused.code).toBe('LZ_NO_ROUTE')
  })

  const FLOORED_USDT0 = 5_000_000n
  const OP_SPLIT: Partial<CrossChainPermissionInput> = {
    from: [
      { chain: optimism, token: USDC_OP },
      { chain: optimism, token: USDT0_OP },
    ],
    to: [
      { chain: arbitrum, token: USDC_ARB },
      { chain: arbitrum, token: USDT0_ARB, minAmount: FLOORED_USDT0 },
    ],
  }

  test('a floor binds only the layer that delivers its leg', () => {
    const { actions, settlementLayers } = scope(
      { ...OP_SPLIT, settlementLayers: ['CCTP', 'OFT'] },
      { chainId: optimism.id },
    )
    expect(settlementLayers).toEqual(['CCTP', 'OFT'])
    const send = actions.find((a) =>
      isAddressEqual(a.target, SETTLEMENT_CATALOG[optimism.id].oft!.adapter),
    )
    const rules = JSON.stringify(send?.policies, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    )
    // OFT floors minAmountLD (offset 224) at the leg's minAmount.
    expect(rules).toContain(
      `"condition":"greaterThanOrEqual","calldataOffset":"224","referenceValue":"${FLOORED_USDT0}"`,
    )
  })

  test('CCTP still refuses a floor on a leg it delivers', () => {
    const refused = refusalOf(() =>
      scope({
        to: { chain: arbitrum, token: USDC_ARB, minAmount: 90n },
        settlementLayers: ['CCTP'],
      }),
    )
    expect(refused.code).toBe('MIN_AMOUNT_NOT_ENFORCEABLE')
  })

  test('a floored leg no named layer can floor is refused', () => {
    const refused = refusalOf(() =>
      scope(
        {
          from: { chain: optimism, token: USDC_OP },
          to: OP_SPLIT.to,
          settlementLayers: ['CCTP'],
        },
        { chainId: optimism.id },
      ),
    )
    expect([refused.code, refused.leg, refused.chainId]).toEqual([
      'TOKEN_NOT_ROUTED',
      'to',
      arbitrum.id,
    ])
  })
})

describe('ECO_IE legs and caps', () => {
  const RONIN = { ...arbitrum, id: 2020 } as Chain
  const USDC_RONIN = getAddress(SETTLEMENT_CATALOG[2020].eco!.stablecoins[0])
  // Optimism and Ronin share no Eco prover; Optimism and Arbitrum do.
  const OP_TO_ARB_AND_RONIN: Partial<CrossChainPermissionInput> = {
    from: { chain: optimism, token: USDC_OP, maxAmount: 100n },
    to: [
      { chain: arbitrum, token: USDC_ARB },
      { chain: RONIN, token: USDC_RONIN },
    ],
    maxFeeBps: 50,
    validUntil: VALID_UNTIL,
  }

  test("'all' keeps ECO_IE for the leg it has a prover for", () => {
    const { actions, settlementLayers } = scope(OP_TO_ARB_AND_RONIN, {
      chainId: optimism.id,
    })
    expect(settlementLayers).toContain('ECO_IE')
    const publish = actions.find(
      (a) => a.selector === PUBLISH_AND_FUND_SELECTOR,
    )
    const rules = JSON.stringify(publish?.policies, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    )
    // Only the Arbitrum leg is pinned, to the account.
    expect(rules).toContain(`"referenceValue":"${arbitrum.id}"`)
    expect(rules).not.toContain(`"referenceValue":"2020"`)
    expect(rules.toLowerCase()).toContain(ACCOUNT.slice(2).toLowerCase())
  })

  test('an explicit ECO_IE list says why it cannot pin a leg', () => {
    const refused = refusalOf(() =>
      scope(
        { ...OP_TO_ARB_AND_RONIN, settlementLayers: ['ECO_IE'] },
        { chainId: optimism.id },
      ),
    )
    expect([refused.code, refused.chainId]).toEqual([
      'ECO_IE_NO_SHARED_PROVER',
      2020,
    ])
  })

  test("another token's missing cap does not drop ECO_IE's floor", () => {
    const { actions, settlementLayers } = scope({
      from: [
        { chain: base, token: USDC, maxAmount: 100n },
        { chain: base, token: WETH },
      ],
      to: { chain: arbitrum, token: USDC_ARB, minAmount: 95n },
    })
    expect(settlementLayers).toContain('ECO_IE')
    const publish = actions.find(
      (a) => a.selector === PUBLISH_AND_FUND_SELECTOR,
    )
    // The floor binds what the route delivers.
    expect(
      JSON.stringify(publish?.policies, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    ).toContain('"condition":"greaterThanOrEqual","calldataOffset"')
    expect(
      JSON.stringify(publish?.policies, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    ).toContain('"referenceValue":"95"')
  })
})
