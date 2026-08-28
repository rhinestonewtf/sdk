import { type Address, decodeFunctionData, isAddressEqual } from 'viem'
import { arbitrum, base, optimism } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../test/consts'
import { getSessionData } from '../../modules/validators/smart-sessions/digest'
import { oneTimeUseIdPolicyAbi } from '../../modules/validators/smart-sessions/one-time-use'
import { SUDO_POLICY_ADDRESS } from '../../modules/validators/smart-sessions/policies/addresses'
import {
  CCTP_LAYER_ID,
  addressToBytes32,
  encodeCctpAdapterConfig,
  intentExecutorPolicyEntry,
} from '../../modules/validators/smart-sessions/policies/settlement-layer'
import {
  ARG_POLICY_ADDRESS,
  SPENDING_LIMITS_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
  UNIVERSAL_ACTION_POLICY_ADDRESS,
} from '../../modules/validators/smart-sessions/policies/addresses'
import { experimental_defineSpendSession } from './spend-session'

const OWNER = { type: 'ecdsa' as const, accounts: [accountA] }
const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const DAI: Address = '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb'
const ARB_USDC: Address = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const RECIPIENT: Address = '0x1111111111111111111111111111111111111111'
const RECIPIENT_2: Address = '0x2222222222222222222222222222222222222222'
const ONCE: Address = '0x425Ca0bb0AFd6aba83c15676db11C039b17Dcc0c'
// Prod Across 7579 arbiter (arbiters.ts). Bound as the claim policy spender.
const ACROSS_ARBITER: Address = '0x28a4D41776968c1201A807ec51fFB405362B8882'

// The action the builder scopes for a given token (skips the injected fallback /
// intent-execution / native-wrap / dummy-preclaim actions).
function tokenAction(session: ReturnType<typeof experimental_defineSpendSession>['session'], token: Address) {
  return getSessionData(session).actions.find((a) =>
    isAddressEqual(a.actionTarget, token),
  )
}

function hasPolicy(
  action: { actionPolicies: readonly { policy: Address }[] } | undefined,
  policy: Address,
): boolean {
  return (
    action?.actionPolicies.some((p) => isAddressEqual(p.policy, policy)) ?? false
  )
}

describe('experimental_defineSpendSession — route selection', () => {
  test('no target → executor route', () => {
    const { route } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC }] },
    })
    expect(route).toBe('executor')
  })

  test('target on a different chain → permit2 route', () => {
    const { route } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: {
        tokens: [{ token: USDC }],
        target: { chains: [arbitrum] },
      },
    })
    expect(route).toBe('permit2')
  })

  test('target listing only the session chain → executor route', () => {
    const { route } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC }], target: { chains: [base] } },
    })
    expect(route).toBe('executor')
  })

  test('explicit route override wins', () => {
    const { route } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC }] },
      route: 'permit2',
    })
    expect(route).toBe('permit2')
  })
})

describe('experimental_defineSpendSession — same-chain scoping', () => {
  test('no claim policy on the executor route', () => {
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC, maxAmount: 1n }], recipients: [RECIPIENT] },
    })
    expect(session.claimPolicies).toHaveLength(0)
  })

  test('amount cap → spending-limits policy on the token action', () => {
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC, maxAmount: 1_000_000n }] },
    })
    expect(hasPolicy(tokenAction(session, USDC), SPENDING_LIMITS_POLICY_ADDRESS)).toBe(
      true,
    )
  })

  test('single recipient → universal-action policy', () => {
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC }], recipients: [RECIPIENT] },
    })
    expect(
      hasPolicy(tokenAction(session, USDC), UNIVERSAL_ACTION_POLICY_ADDRESS),
    ).toBe(true)
  })

  test('multiple recipients → arg-policy (allowlist)', () => {
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: {
        tokens: [{ token: USDC }],
        recipients: [RECIPIENT, RECIPIENT_2],
      },
    })
    expect(hasPolicy(tokenAction(session, USDC), ARG_POLICY_ADDRESS)).toBe(true)
  })

  test('validUntil/validAfter → time-frame policy', () => {
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: {
        tokens: [{ token: USDC }],
        validUntil: new Date('2030-01-01'),
        validAfter: new Date('2025-01-01'),
      },
    })
    expect(hasPolicy(tokenAction(session, USDC), TIME_FRAME_POLICY_ADDRESS)).toBe(
      true,
    )
  })

  test('multiple tokens → one scoped action each', () => {
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: {
        tokens: [
          { token: USDC, maxAmount: 1n },
          { token: DAI, maxAmount: 2n },
        ],
      },
    })
    expect(tokenAction(session, USDC)).toBeDefined()
    expect(tokenAction(session, DAI)).toBeDefined()
  })
})

describe('experimental_defineSpendSession — cross-chain scoping', () => {
  test('permit2 claim policy is present and typed', () => {
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: {
        tokens: [{ token: USDC, maxAmount: 1_000_000n }],
        recipients: [RECIPIENT],
        target: { chains: [arbitrum], settlementLayers: ['ACROSS'] },
      },
    })
    expect(session.claimPolicies.length).toBeGreaterThan(0)
    expect(session.claimPolicies[0].type).toBe('permit2')
  })

  test('the settlement-layer arbiter is bound as the claim policy spender', () => {
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: {
        tokens: [{ token: USDC }],
        target: { chains: [arbitrum], settlementLayers: ['ACROSS'] },
      },
    })
    const spenders = session.claimPolicies[0].spenders ?? []
    expect(spenders.some((s) => isAddressEqual(s, ACROSS_ARBITER))).toBe(true)
  })

  test('multiple target chains are covered', () => {
    const { route, session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: {
        tokens: [{ token: USDC }],
        target: {
          chains: [arbitrum, optimism],
          settlementLayers: ['ACROSS'],
        },
      },
    })
    expect(route).toBe('permit2')
    expect(session.claimPolicies.length).toBeGreaterThan(0)
  })
})

describe('experimental_defineSpendSession — one-time-use', () => {
  test('installs the once-policy on every action (executor)', () => {
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC, maxAmount: 1n }] },
      singleUse: { id: 42n },
      policyAddresses: { oneTimeUseId: ONCE },
    })
    const data = getSessionData(session)
    expect(data.actions.length).toBeGreaterThan(0)
    for (const action of data.actions) {
      expect(hasPolicy(action, ONCE)).toBe(true)
    }
  })

  test('installs the once-policy on the erc1271 list (permit2)', () => {
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: {
        tokens: [{ token: USDC }],
        recipients: [RECIPIENT],
        target: { chains: [arbitrum], settlementLayers: ['ACROSS'] },
      },
      singleUse: { id: 9n },
      policyAddresses: { oneTimeUseId: ONCE },
    })
    const data = getSessionData(session)
    expect(
      data.erc7739Policies.erc1271Policies.some((p) =>
        isAddressEqual(p.policy, ONCE),
      ),
    ).toBe(true)
  })

  test('executor burn op is consume(id)', () => {
    const { buildBurnOp } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC }] },
      singleUse: { id: 42n },
      policyAddresses: { oneTimeUseId: ONCE },
    })
    const burn = buildBurnOp()
    expect(isAddressEqual(burn.to, ONCE)).toBe(true)
    const decoded = decodeFunctionData({ abi: oneTimeUseIdPolicyAbi, data: burn.data })
    expect(decoded.functionName).toBe('consume')
    expect(decoded.args).toEqual([42n])
  })

  test('permit2 burn op is consumeFor(id, 0) placeholder', () => {
    const { buildBurnOp, route } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: {
        tokens: [{ token: USDC }],
        target: { chains: [arbitrum], settlementLayers: ['ACROSS'] },
      },
      singleUse: { id: 7n },
      policyAddresses: { oneTimeUseId: ONCE },
    })
    expect(route).toBe('permit2')
    const decoded = decodeFunctionData({
      abi: oneTimeUseIdPolicyAbi,
      data: buildBurnOp().data,
    })
    expect(decoded.functionName).toBe('consumeFor')
    expect(decoded.args).toEqual([7n, 0n])
  })

  test('route override changes the burn op (executor id, permit2 shape)', () => {
    const { buildBurnOp } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC }] },
      route: 'permit2',
      singleUse: { id: 5n },
      policyAddresses: { oneTimeUseId: ONCE },
    })
    const decoded = decodeFunctionData({
      abi: oneTimeUseIdPolicyAbi,
      data: buildBurnOp().data,
    })
    expect(decoded.functionName).toBe('consumeFor')
  })
})

describe('experimental_defineSpendSession — validation & the old way', () => {
  test('singleUse without oneTimeUseId address throws', () => {
    expect(() =>
      experimental_defineSpendSession({
        chain: base,
        owners: OWNER,
        spend: { tokens: [{ token: USDC }] },
        singleUse: { id: 1n },
      }),
    ).toThrow(/oneTimeUseId/)
  })

  test('empty tokens throws', () => {
    expect(() =>
      experimental_defineSpendSession({
        chain: base,
        owners: OWNER,
        // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
        spend: { tokens: [] as any },
      }),
    ).toThrow(/at least one token/)
  })

  test('an IntentExecutor layer not yet supported is refused', () => {
    expect(() =>
      experimental_defineSpendSession({
        chain: base,
        owners: OWNER,
        spend: {
          tokens: [{ token: USDC }],
          target: { chains: [arbitrum], settlementLayers: ['RHINO'] },
        },
      }),
    ).toThrow(/not yet supported/)
  })

  test('recipient restriction on a layer that cannot enforce it is refused', () => {
    // RHINO has no on-chain recipient; even once available it cannot bind one.
    // (Today it is refused earlier for availability, so assert on availability
    // via a layer that WILL enforce recipient to keep this test about the arg.)
    expect(() =>
      experimental_defineSpendSession({
        chain: base,
        owners: OWNER,
        spend: {
          tokens: [{ token: USDC }],
          recipients: [RECIPIENT],
          target: { chains: [arbitrum], settlementLayers: ['RELAY'] },
        },
      }),
    ).toThrow(/not yet supported|recipient/)
  })

  test('supported arbiter layers pass validation', () => {
    for (const layer of ['SAME_CHAIN', 'ECO', 'ACROSS'] as const) {
      expect(() =>
        experimental_defineSpendSession({
          chain: base,
          owners: OWNER,
          spend: {
            tokens: [{ token: USDC, maxAmount: 1n }],
            recipients: [RECIPIENT],
            target: { chains: [arbitrum], settlementLayers: [layer] },
          },
        }),
      ).not.toThrow()
    }
  })

  test('a settlement-layer 1271 policy is installed and replaces sudo', () => {
    const POLICY: Address = '0x00000000000000000000000000000000000000AA'
    const IE: Address = '0x00000000005aD9ce1f5035FD62CA96CEf16AdAAF'
    const entry = intentExecutorPolicyEntry({
      policy: POLICY,
      base: { intentExecutor: IE },
      layers: [
        {
          layerId: CCTP_LAYER_ID,
          config: encodeCctpAdapterConfig({
            tokenMessenger: '0xBd3fa81B58Ba92a82136038B25aDec7066af3155',
            mintRecipients: [addressToBytes32(RECIPIENT)],
            burnTokens: [USDC],
          }),
        },
      ],
    })
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC }] },
      erc1271Policies: [entry],
      policyAddresses: { intentExecutorPolicy: POLICY },
    })
    const list = getSessionData(session).erc7739Policies.erc1271Policies
    expect(list.some((p) => isAddressEqual(p.policy, POLICY))).toBe(true)
    // enforcing 1271 policy drops the default sudo entry
    expect(list.some((p) => isAddressEqual(p.policy, SUDO_POLICY_ADDRESS))).toBe(
      false,
    )
  })

  test('settlement-layer policy is refused alongside a cross-chain arbiter target', () => {
    const entry = intentExecutorPolicyEntry({
      policy: '0x00000000000000000000000000000000000000AA',
      base: { intentExecutor: '0x00000000005aD9ce1f5035FD62CA96CEf16AdAAF' },
      layers: [
        {
          layerId: CCTP_LAYER_ID,
          config: encodeCctpAdapterConfig({
            tokenMessenger: '0xBd3fa81B58Ba92a82136038B25aDec7066af3155',
            mintRecipients: [addressToBytes32(RECIPIENT)],
            burnTokens: [USDC],
          }),
        },
      ],
    })
    expect(() =>
      experimental_defineSpendSession({
        chain: base,
        owners: OWNER,
        spend: {
          tokens: [{ token: USDC }],
          target: { chains: [arbitrum], settlementLayers: ['ACROSS'] },
        },
        erc1271Policies: [entry],
      }),
    ).toThrow(/mutually exclusive/)
  })

  test('the old way (no singleUse) still scopes but has no burn op', () => {
    const { session, buildBurnOp } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: {
        tokens: [{ token: USDC, maxAmount: 500n }],
        recipients: [RECIPIENT],
      },
    })
    expect(session.oneTimeUse).toBeFalsy()
    expect(tokenAction(session, USDC)).toBeDefined()
    expect(() => buildBurnOp()).toThrow(/singleUse/)
  })
})
