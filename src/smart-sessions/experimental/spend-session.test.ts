import { type Address, decodeFunctionData, isAddressEqual } from 'viem'
import { arbitrum, base, optimism } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../test/consts'
import { getSessionData } from '../../modules/validators/smart-sessions/digest'
import { oneTimeUseIdPolicyAbi } from '../../modules/validators/smart-sessions/one-time-use'
import {
  ARG_POLICY_ADDRESS,
  SPENDING_LIMITS_POLICY_ADDRESS,
  SUDO_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
  UNIVERSAL_ACTION_POLICY_ADDRESS,
} from '../../modules/validators/smart-sessions/policies/addresses'
import {
  addressToBytes32,
  CCTP_LAYER_ID,
  encodeCctpAdapterConfig,
  intentExecutorPolicyEntry,
} from '../../modules/validators/smart-sessions/policies/settlement-layer'
import { experimental_defineSpendSession } from './spend-session'

const OWNER = { type: 'ecdsa' as const, accounts: [accountA] }
const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const DAI: Address = '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb'
const ARB_USDC: Address = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const OP_USDC: Address = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'
const RECIPIENT: Address = '0x1111111111111111111111111111111111111111'
const RECIPIENT_2: Address = '0x2222222222222222222222222222222222222222'
const ONCE: Address = '0x425Ca0bb0AFd6aba83c15676db11C039b17Dcc0c'
// Prod Across 7579 arbiter (arbiters.ts). Bound as the claim policy spender.
const ACROSS_ARBITER: Address = '0x28a4D41776968c1201A807ec51fFB405362B8882'

// Cross-chain target to arbitrum with the destination token wired.
function arbTarget(settlementLayers?: ('SAME_CHAIN' | 'ECO' | 'ACROSS')[]) {
  return {
    chains: [arbitrum],
    ...(settlementLayers ? { settlementLayers } : {}),
    tokens: [{ chain: arbitrum, token: ARB_USDC }],
  }
}

type Result = ReturnType<typeof experimental_defineSpendSession>

function tokenAction(session: Result['session'], token: Address) {
  return getSessionData(session).actions.find((a) =>
    isAddressEqual(a.actionTarget, token),
  )
}

function hasPolicy(
  action: { actionPolicies: readonly { policy: Address }[] } | undefined,
  policy: Address,
): boolean {
  return (
    action?.actionPolicies.some((p) => isAddressEqual(p.policy, policy)) ??
    false
  )
}

describe('experimental_defineSpendSession — route selection', () => {
  test('no target → executor route', () => {
    const { route } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC, maxAmount: 1n }] },
    })
    expect(route).toBe('executor')
  })

  test('target on a different chain → permit2 route', () => {
    const { route } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC }], target: arbTarget() },
    })
    expect(route).toBe('permit2')
  })

  test('target listing only the session chain → executor route', () => {
    const { route } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: {
        tokens: [{ token: USDC, maxAmount: 1n }],
        target: { chains: [base], tokens: [{ chain: base, token: USDC }] },
      },
    })
    expect(route).toBe('executor')
  })
})

describe('experimental_defineSpendSession — same-chain scoping', () => {
  test('no claim policy on the executor route', () => {
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: {
        tokens: [{ token: USDC, maxAmount: 1n }],
        recipients: [RECIPIENT],
      },
    })
    expect(session.claimPolicies).toHaveLength(0)
  })

  test('amount cap → spending-limits policy on the token action', () => {
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC, maxAmount: 1_000_000n }] },
    })
    expect(
      hasPolicy(tokenAction(session, USDC), SPENDING_LIMITS_POLICY_ADDRESS),
    ).toBe(true)
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
    expect(
      hasPolicy(tokenAction(session, USDC), TIME_FRAME_POLICY_ADDRESS),
    ).toBe(true)
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

  test('a fully-unrestricted same-chain spend is refused', () => {
    expect(() =>
      experimental_defineSpendSession({
        chain: base,
        owners: OWNER,
        spend: { tokens: [{ token: USDC }] },
      }),
    ).toThrow(/unrestricted same-chain spend/)
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
        target: arbTarget(['ACROSS']),
      },
    })
    expect(session.claimPolicies.length).toBeGreaterThan(0)
    expect(session.claimPolicies[0].type).toBe('permit2')
  })

  test('the settlement-layer arbiter is bound as the claim policy spender', () => {
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC }], target: arbTarget(['ACROSS']) },
    })
    const spenders = session.claimPolicies[0].spenders ?? []
    expect(spenders.some((s) => isAddressEqual(s, ACROSS_ARBITER))).toBe(true)
  })

  test('multiple target chains each need their destination token', () => {
    const { route, session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: {
        tokens: [{ token: USDC }],
        target: {
          chains: [arbitrum, optimism],
          settlementLayers: ['ACROSS'],
          tokens: [
            { chain: arbitrum, token: ARB_USDC },
            { chain: optimism, token: OP_USDC },
          ],
        },
      },
    })
    expect(route).toBe('permit2')
    expect(session.claimPolicies.length).toBeGreaterThan(0)
  })

  test('a cross-chain target missing a destination token is refused', () => {
    expect(() =>
      experimental_defineSpendSession({
        chain: base,
        owners: OWNER,
        spend: {
          tokens: [{ token: USDC }],
          target: { chains: [arbitrum] } as any,
        },
      }),
    ).toThrow(/destination token/)
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
        target: arbTarget(['ACROSS']),
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
    const decoded = decodeFunctionData({
      abi: oneTimeUseIdPolicyAbi,
      data: burn.data,
    })
    expect(decoded.functionName).toBe('consume')
    expect(decoded.args).toEqual([42n])
  })

  test('permit2 burn op is consumeFor(id, 0) placeholder', () => {
    const { buildBurnOp, route } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC }], target: arbTarget(['ACROSS']) },
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
})

describe('experimental_defineSpendSession — settlement-layer policy', () => {
  const IE: Address = '0x00000000005aD9ce1f5035FD62CA96CEf16AdAAF'
  const POLICY: Address = '0x00000000000000000000000000000000000000AA'
  const entry = () =>
    intentExecutorPolicyEntry({
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

  test('is installed on the 1271 list and replaces sudo', () => {
    const { session } = experimental_defineSpendSession({
      chain: base,
      owners: OWNER,
      spend: { tokens: [{ token: USDC, maxAmount: 1n }] },
      erc1271Policies: [entry()],
    })
    const list = getSessionData(session).erc7739Policies.erc1271Policies
    expect(list.some((p) => isAddressEqual(p.policy, POLICY))).toBe(true)
    expect(
      list.some((p) => isAddressEqual(p.policy, SUDO_POLICY_ADDRESS)),
    ).toBe(false)
  })

  test('is refused alongside a cross-chain arbiter target', () => {
    expect(() =>
      experimental_defineSpendSession({
        chain: base,
        owners: OWNER,
        spend: { tokens: [{ token: USDC }], target: arbTarget(['ACROSS']) },
        erc1271Policies: [entry()],
      }),
    ).toThrow(/mutually exclusive/)
  })
})

describe('experimental_defineSpendSession — layer refusal & validation', () => {
  test('an IntentExecutor layer not yet supported is refused', () => {
    expect(() =>
      experimental_defineSpendSession({
        chain: base,
        owners: OWNER,
        spend: {
          tokens: [{ token: USDC }],
          target: { ...arbTarget(), settlementLayers: ['RHINO'] as never },
        },
      }),
    ).toThrow(/not yet supported/)
  })

  test('an unsupported layer is refused even with a recipient set', () => {
    // RELAY is availableToday:false, so it refuses on availability first.
    expect(() =>
      experimental_defineSpendSession({
        chain: base,
        owners: OWNER,
        spend: {
          tokens: [{ token: USDC }],
          recipients: [RECIPIENT],
          target: { ...arbTarget(), settlementLayers: ['RELAY'] as never },
        },
      }),
    ).toThrow(/not yet supported/)
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
            target: arbTarget([layer]),
          },
        }),
      ).not.toThrow()
    }
  })

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
        spend: { tokens: [] as any },
      }),
    ).toThrow(/at least one token/)
  })

  test('empty recipients array throws (must omit or be non-empty)', () => {
    expect(() =>
      experimental_defineSpendSession({
        chain: base,
        owners: OWNER,
        spend: { tokens: [{ token: USDC, maxAmount: 1n }], recipients: [] },
      }),
    ).toThrow(/non-empty/)
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
