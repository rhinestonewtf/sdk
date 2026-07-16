import {
  type Address,
  decodeAbiParameters,
  encodeAbiParameters,
  encodePacked,
  erc20Abi,
  type Hex,
  isAddressEqual,
  parseEther,
  slice,
  zeroHash,
} from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA, accountB } from '../../../test/consts'
import type { ArgPolicyExpression } from '../../types'
import { PERMIT2_CLAIM_POLICY_ADDRESS } from './policies/claim/permit2'
import { getPermissionId, getSessionData } from './smart-sessions/digest'
import { buildSmartSessionMockSignature } from './smart-sessions/mock-signature'
import { SMART_SESSION_EMISSARY_ADDRESS } from './smart-sessions/module'
import {
  ARG_POLICY_ADDRESS,
  INTENT_EXECUTION_POLICY_ADDRESS,
  SPENDING_LIMITS_POLICY_ADDRESS,
  SUDO_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
  UNIVERSAL_ACTION_POLICY_ADDRESS,
  USAGE_LIMIT_POLICY_ADDRESS,
  VALUE_LIMIT_POLICY_ADDRESS,
} from './smart-sessions/policies/addresses'
import { selectPermit2ClaimPolicyForMessage } from './smart-sessions/policies/claim'
import { encodeSessionPolicy } from './smart-sessions/policies/encode'
import {
  DUMMY_PRECLAIMOP_SELECTOR,
  DUMMY_PRECLAIMOP_TARGET,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
  toSession,
} from './smart-sessions/resolve'
import { encodeSmartSessionSignature as packSignature } from './smart-sessions/signature'
import type {
  ResolvedSessionSignerSet,
  Session,
  SessionPolicy,
  SmartSessionMockShape,
} from './smart-sessions/types'

const getPolicyData = (policy: SessionPolicy, useDevContracts?: boolean) =>
  encodeSessionPolicy(policy, useDevContracts ? 'development' : 'production')

const buildMockSignature = (
  session: Session,
  useDevContracts = false,
  chainCount = 1,
  targetChainId?: number,
  shape: SmartSessionMockShape = 'enable',
) =>
  buildSmartSessionMockSignature({
    session,
    environment: useDevContracts ? 'development' : 'production',
    chainCount,
    targetChainId,
    shape,
  })

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseSession: Session = toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
})

const sessionWithAction: Session = toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: '0x1111111111111111111111111111111111111111' as Address,
      functions: {
        transfer: {},
      },
    },
  ],
})

const dummySig = `0x${'00'.repeat(65)}` as Hex
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const RECIPIENT: Address = '0x1111111111111111111111111111111111111111'

// ---------------------------------------------------------------------------
// A. Policy encoding
// ---------------------------------------------------------------------------

describe('getPolicyData', () => {
  test('sudo → SUDO_POLICY_ADDRESS, empty initData', () => {
    const result = getPolicyData({ type: 'sudo' })
    expect(result.policy).toBe(SUDO_POLICY_ADDRESS)
    expect(result.initData).toBe('0x')
  })

  test('intent-execution → INTENT_EXECUTION_POLICY_ADDRESS, empty initData', () => {
    const result = getPolicyData({ type: 'intent-execution' })
    expect(result.policy).toBe(INTENT_EXECUTION_POLICY_ADDRESS)
    expect(result.initData).toBe('0x')
  })

  test('spending-limits encodes token addresses and amounts', () => {
    const token = '0xaabbccdd00000000000000000000000000000001' as Address
    const result = getPolicyData({
      type: 'spending-limits',
      limits: [{ token, amount: 1000n }],
    })
    expect(result.policy).toBe(SPENDING_LIMITS_POLICY_ADDRESS)
    const expected = encodeAbiParameters(
      [{ type: 'address[]' }, { type: 'uint256[]' }],
      [[token], [1000n]],
    )
    expect(result.initData).toBe(expected)
  })

  test('time-frame packs (validUntil, validAfter) as uint48 || uint48 in seconds (ms → s)', () => {
    const validUntil = 1_800_000_000_000
    const validAfter = 1_700_000_000_000
    const result = getPolicyData({ type: 'time-frame', validUntil, validAfter })
    expect(result.policy).toBe(TIME_FRAME_POLICY_ADDRESS)
    const expected = encodePacked(
      ['uint48', 'uint48'],
      [Math.floor(validUntil / 1000), Math.floor(validAfter / 1000)],
    )
    expect(result.initData).toBe(expected)
    // 12 bytes total (matches deployed TimeFramePolicy's bytes12 / uint96 layout)
    expect((expected.length - 2) / 2).toBe(12)
  })

  test('usage-limit encodes limit as uint128', () => {
    const result = getPolicyData({ type: 'usage-limit', limit: 5n })
    expect(result.policy).toBe(USAGE_LIMIT_POLICY_ADDRESS)
    expect(result.initData).toBe(encodePacked(['uint128'], [5n]))
  })

  test('value-limit encodes limit as uint256', () => {
    const limit = parseEther('1')
    const result = getPolicyData({ type: 'value-limit', limit })
    expect(result.policy).toBe(VALUE_LIMIT_POLICY_ADDRESS)
    expect(result.initData).toBe(
      encodeAbiParameters([{ type: 'uint256' }], [limit]),
    )
  })

  test('universal-action → UNIVERSAL_ACTION_POLICY_ADDRESS, non-empty initData', () => {
    const result = getPolicyData({
      type: 'universal-action',
      valueLimitPerUse: 0n,
      rules: [
        {
          condition: 'equal',
          calldataOffset: 4n,
          referenceValue: 100n,
        },
      ],
    })
    expect(result.policy).toBe(UNIVERSAL_ACTION_POLICY_ADDRESS)
    expect(result.initData.length).toBeGreaterThan(2)
  })

  test('rejects universal action policies with more than sixteen rules', () => {
    const rules = Array.from({ length: 17 }, () => ({
      condition: 'equal' as const,
      calldataOffset: 4n,
      referenceValue: 1n,
    }))
    expect(() =>
      getPolicyData({
        type: 'universal-action',
        rules: rules as [(typeof rules)[number], ...typeof rules],
      }),
    ).toThrow('at most 16 rules')
  })
})

// ---------------------------------------------------------------------------
// A2. ArgPolicy encoding — verifies the bit-packed node layout matches
//     ArgPolicyTreeLib.sol exactly: [type:2 | ruleIdx:8 | leftChild:8 | rightChild:8]
// ---------------------------------------------------------------------------

const argPolicyActionConfigAbi = [
  {
    components: [
      { name: 'valueLimitPerUse', type: 'uint256' },
      {
        components: [
          { name: 'rootNodeIndex', type: 'uint8' },
          {
            components: [
              { name: 'condition', type: 'uint8' },
              { name: 'offset', type: 'uint64' },
              { name: 'isLimited', type: 'bool' },
              { name: 'ref', type: 'bytes32' },
              {
                components: [
                  { name: 'limit', type: 'uint256' },
                  { name: 'used', type: 'uint256' },
                ],
                name: 'usage',
                type: 'tuple',
              },
            ],
            name: 'rules',
            type: 'tuple[]',
          },
          { name: 'packedNodes', type: 'uint256[]' },
        ],
        name: 'paramRules',
        type: 'tuple',
      },
    ],
    name: 'ActionConfig',
    type: 'tuple',
  },
] as const

function decodeArgPolicyInitData(initData: Hex) {
  return decodeAbiParameters(argPolicyActionConfigAbi, initData)[0]
}

const NODE_TYPE_MASK = 0x3n
const RULE_INDEX_MASK = 0xffn
const CHILD_MASK = 0xffn

function unpackNode(node: bigint) {
  return {
    nodeType: Number(node & NODE_TYPE_MASK),
    ruleIndex: Number((node >> 2n) & RULE_INDEX_MASK),
    leftChild: Number((node >> 10n) & CHILD_MASK),
    rightChild: Number((node >> 18n) & CHILD_MASK),
  }
}

describe('getPolicyData arg-policy', () => {
  test('single rule → 1 rule, 1 RULE node, root index 0', () => {
    const result = getPolicyData({
      type: 'arg-policy',
      valueLimitPerUse: 42n,
      expression: {
        type: 'rule',
        rule: {
          condition: 'equal',
          calldataOffset: 4n,
          referenceValue: 100n,
        },
      },
    })
    expect(result.policy).toBe(ARG_POLICY_ADDRESS)
    const decoded = decodeArgPolicyInitData(result.initData)
    expect(decoded.valueLimitPerUse).toBe(42n)
    expect(decoded.paramRules.rootNodeIndex).toBe(0)
    expect(decoded.paramRules.rules.length).toBe(1)
    expect(decoded.paramRules.packedNodes.length).toBe(1)
    const root = unpackNode(decoded.paramRules.packedNodes[0])
    expect(root.nodeType).toBe(0) // RULE
    expect(root.ruleIndex).toBe(0)
    expect(decoded.paramRules.rules[0].ref).toBe(
      `0x${'00'.repeat(31)}64` as Hex,
    )
    expect(decoded.paramRules.rules[0].offset).toBe(4n)
    expect(decoded.paramRules.rules[0].isLimited).toBe(false)
  })

  test('OR of two rules — root is OR with two RULE children, children come before parent', () => {
    const rule = (ref: bigint) =>
      ({
        type: 'rule',
        rule: {
          condition: 'equal' as const,
          calldataOffset: 4n,
          referenceValue: ref,
        },
      }) as const
    const result = getPolicyData({
      type: 'arg-policy',
      expression: {
        type: 'or',
        left: rule(1n),
        right: rule(2n),
      },
    })
    const decoded = decodeArgPolicyInitData(result.initData)
    expect(decoded.paramRules.rules.length).toBe(2)
    expect(decoded.paramRules.packedNodes.length).toBe(3)
    const leftLeaf = unpackNode(decoded.paramRules.packedNodes[0])
    const rightLeaf = unpackNode(decoded.paramRules.packedNodes[1])
    const root = unpackNode(decoded.paramRules.packedNodes[2])
    expect(leftLeaf.nodeType).toBe(0)
    expect(leftLeaf.ruleIndex).toBe(0)
    expect(rightLeaf.nodeType).toBe(0)
    expect(rightLeaf.ruleIndex).toBe(1)
    expect(root.nodeType).toBe(3) // OR
    expect(root.leftChild).toBe(0)
    expect(root.rightChild).toBe(1)
    expect(decoded.paramRules.rootNodeIndex).toBe(2)
  })

  test('NOT wraps a single rule, unary child packed into left slot only', () => {
    const result = getPolicyData({
      type: 'arg-policy',
      expression: {
        type: 'not',
        child: {
          type: 'rule',
          rule: {
            condition: 'equal',
            calldataOffset: 4n,
            referenceValue: 1n,
          },
        },
      },
    })
    const decoded = decodeArgPolicyInitData(result.initData)
    expect(decoded.paramRules.packedNodes.length).toBe(2)
    const notRoot = unpackNode(decoded.paramRules.packedNodes[1])
    expect(notRoot.nodeType).toBe(1) // NOT
    expect(notRoot.leftChild).toBe(0)
    expect(notRoot.rightChild).toBe(0)
  })

  test('nested (A AND B) OR (NOT C) — post-order, every parent points at earlier children', () => {
    const ruleA: ArgPolicyExpression = {
      type: 'rule',
      rule: { condition: 'equal', calldataOffset: 4n, referenceValue: 1n },
    }
    const ruleB: ArgPolicyExpression = {
      type: 'rule',
      rule: { condition: 'equal', calldataOffset: 4n, referenceValue: 2n },
    }
    const ruleC: ArgPolicyExpression = {
      type: 'rule',
      rule: { condition: 'equal', calldataOffset: 4n, referenceValue: 3n },
    }
    const result = getPolicyData({
      type: 'arg-policy',
      expression: {
        type: 'or',
        left: { type: 'and', left: ruleA, right: ruleB },
        right: { type: 'not', child: ruleC },
      },
    })
    const decoded = decodeArgPolicyInitData(result.initData)
    // 3 rules, 3 leaf nodes + AND + NOT + OR = 6 nodes
    expect(decoded.paramRules.rules.length).toBe(3)
    expect(decoded.paramRules.packedNodes.length).toBe(6)
    decoded.paramRules.packedNodes.forEach((rawNode: bigint, i: number) => {
      const n = unpackNode(rawNode)
      if (n.nodeType === 1) {
        expect(n.leftChild).toBeLessThan(i)
      } else if (n.nodeType === 2 || n.nodeType === 3) {
        expect(n.leftChild).toBeLessThan(i)
        expect(n.rightChild).toBeLessThan(i)
      }
    })
    expect(decoded.paramRules.rootNodeIndex).toBe(5)
    const root = unpackNode(decoded.paramRules.packedNodes[5])
    expect(root.nodeType).toBe(3) // OR
  })

  test('usageLimit on a rule sets isLimited=true and copies the limit', () => {
    const result = getPolicyData({
      type: 'arg-policy',
      expression: {
        type: 'rule',
        rule: {
          condition: 'lessThanOrEqual',
          calldataOffset: 36n,
          referenceValue: 1000n,
          usageLimit: 5000n,
        },
      },
    })
    const decoded = decodeArgPolicyInitData(result.initData)
    expect(decoded.paramRules.rules[0].isLimited).toBe(true)
    expect(decoded.paramRules.rules[0].usage.limit).toBe(5000n)
    expect(decoded.paramRules.rules[0].usage.used).toBe(0n)
  })

  test('reference value as hex is left-padded to bytes32', () => {
    const addr = '0xaabbccdd00000000000000000000000000000001' as Hex
    const result = getPolicyData({
      type: 'arg-policy',
      expression: {
        type: 'rule',
        rule: {
          condition: 'equal',
          calldataOffset: 4n,
          referenceValue: addr,
        },
      },
    })
    const decoded = decodeArgPolicyInitData(result.initData)
    expect(decoded.paramRules.rules[0].ref).toBe(
      `0x000000000000000000000000aabbccdd00000000000000000000000000000001` as Hex,
    )
  })

  test('rule index packing uses bits 2..9 — supports indices > 0', () => {
    const r = (v: bigint): ArgPolicyExpression => ({
      type: 'rule',
      rule: { condition: 'equal', calldataOffset: 4n, referenceValue: v },
    })
    const result = getPolicyData({
      type: 'arg-policy',
      expression: {
        type: 'and',
        left: r(1n),
        right: { type: 'and', left: r(2n), right: r(3n) },
      },
    })
    const decoded = decodeArgPolicyInitData(result.initData)
    const leafIndices = decoded.paramRules.packedNodes
      .map(unpackNode)
      .filter((n) => n.nodeType === 0)
      .map((n) => n.ruleIndex)
    expect(leafIndices).toContain(2)
  })

  test('throws when expression compiles to >128 rules', () => {
    const leaf = (v: bigint): ArgPolicyExpression => ({
      type: 'rule',
      rule: { condition: 'equal', calldataOffset: 4n, referenceValue: v },
    })
    let expr: ArgPolicyExpression = leaf(0n)
    for (let i = 1; i < 129; i++) {
      expr = { type: 'and', left: leaf(BigInt(i)), right: expr }
    }
    expect(() =>
      getPolicyData({ type: 'arg-policy', expression: expr }),
    ).toThrow(/max is 128/)
  })

  test('throws when expression compiles to more than 256 nodes', () => {
    let expr: ArgPolicyExpression = {
      type: 'rule',
      rule: { condition: 'equal', calldataOffset: 4n, referenceValue: 1n },
    }
    for (let index = 0; index < 256; index++) {
      expr = { type: 'not', child: expr }
    }
    expect(() =>
      getPolicyData({ type: 'arg-policy', expression: expr }),
    ).toThrow('max is 256')
  })
})

// ---------------------------------------------------------------------------
// A3. Per-session policyAddresses override
// ---------------------------------------------------------------------------

describe('policyAddresses override', () => {
  const SUDO_OVERRIDE: Address = '0xdeadbeef00000000000000000000000000000001'
  const UA_OVERRIDE: Address = '0xdeadbeef00000000000000000000000000000002'

  test('override propagates to the erc1271 sudo policy too', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      policyAddresses: { sudo: SUDO_OVERRIDE },
    })
    const data = getSessionData(session)
    expect(data.erc7739Policies.erc1271Policies[0].policy).toBe(SUDO_OVERRIDE)
  })

  test('default fallback sudo action picks up the override', () => {
    // No explicit permissions → resolveSessionData emits the [sudoAction] fallback.
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      policyAddresses: { sudo: SUDO_OVERRIDE },
    })
    const data = getSessionData(session)
    expect(data.actions[0].actionPolicies[0].policy).toBe(SUDO_OVERRIDE)
  })

  test('universal-action address override is reflected in encoded action policy', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      permissions: [
        {
          abi: erc20Abi,
          address: USDC,
          functions: {
            transfer: {
              params: {
                recipient: { condition: 'equal', value: RECIPIENT },
              },
            },
          },
        },
      ],
      policyAddresses: { universalAction: UA_OVERRIDE },
    })
    const data = getSessionData(session)
    expect(data.actions[0].actionPolicies[0].policy).toBe(UA_OVERRIDE)
  })

  test('no override → all default V2 addresses are used', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      permissions: [
        {
          abi: erc20Abi,
          address: USDC,
          functions: {
            transfer: {},
          },
        },
      ],
    })
    const data = getSessionData(session)
    expect(data.actions[0].actionPolicies[0].policy).toBe(SUDO_POLICY_ADDRESS)
    expect(data.erc7739Policies.erc1271Policies[0].policy).toBe(
      SUDO_POLICY_ADDRESS,
    )
  })
})

// ---------------------------------------------------------------------------
// B. getSessionData
// ---------------------------------------------------------------------------

describe('getSessionData', () => {
  test('ENS session owners are rejected', () => {
    expect(() =>
      toSession({
        chain: base,
        owners: {
          type: 'ens',
          owners: [{ account: accountA }],
        },
      }),
    ).toThrow('ENS owners are not supported for smart sessions')
  })

  test('no actions → single sudoAction fallback', () => {
    const data = getSessionData(baseSession)
    expect(data.actions).toHaveLength(1)
    expect(data.actions[0].actionTarget).toBe(
      SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    )
    expect(data.actions[0].actionTargetSelector).toBe(
      SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
    )
  })

  test('explicit actions → user action + 3 injected (WETH deposit + intent-execution fallback + dummy preclaimop)', () => {
    const data = getSessionData(sessionWithAction)
    expect(data.actions).toHaveLength(4)
    expect(data.actions[0].actionTarget).toBe(
      '0x1111111111111111111111111111111111111111',
    )
    // injected WETH deposit — target is the wrapped token (non-zero address)
    expect(data.actions[1].actionTarget).not.toBe(
      '0x0000000000000000000000000000000000000000',
    )
    // injected intent-execution fallback
    expect(data.actions[2].actionTarget).toBe(
      SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    )
    // injected dummy preclaimop action
    expect(data.actions[3].actionTarget).toBe(DUMMY_PRECLAIMOP_TARGET)
    expect(data.actions[3].actionTargetSelector).toBe(DUMMY_PRECLAIMOP_SELECTOR)
  })

  test('dummy preclaimop action uses sudo policy', () => {
    const data = getSessionData(sessionWithAction)
    const dummyAction = data.actions.find(
      (a) => a.actionTargetSelector === DUMMY_PRECLAIMOP_SELECTOR,
    )
    expect(dummyAction).toBeDefined()
    expect(dummyAction!.actionPolicies).toHaveLength(1)
    expect(dummyAction!.actionPolicies[0].policy).toBe(SUDO_POLICY_ADDRESS)
    expect(dummyAction!.actionPolicies[0].initData).toBe('0x')
  })

  test('no explicit actions → sudoAction fallback only (dummy injected via injectedActions path is not used)', () => {
    // Sessions without explicit actions use the [sudoAction] fallback directly,
    // which covers all (target, selector) pairs — no dummy action needed.
    const data = getSessionData(baseSession)
    expect(data.actions).toHaveLength(1)
    expect(data.actions[0].actionTarget).toBe(
      SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    )
  })

  test('empty permissions array → same sudoAction fallback as no permissions', () => {
    // permissions: [] is truthy but has no elements — must be treated the same as
    // permissions: undefined so injectedActions are not appended.
    const sessionWithEmptyPermissions = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      permissions: [],
    })
    const data = getSessionData(sessionWithEmptyPermissions)
    expect(data.actions).toHaveLength(1)
    expect(data.actions[0].actionTarget).toBe(
      SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    )
  })

  test('salt is always zeroHash', () => {
    expect(getSessionData(baseSession).salt).toBe(zeroHash)
    expect(getSessionData(sessionWithAction).salt).toBe(zeroHash)
  })

  test('erc7739Policies has sudo erc1271 policy', () => {
    const data = getSessionData(baseSession)
    expect(data.erc7739Policies.erc1271Policies[0].policy).toBe(
      SUDO_POLICY_ADDRESS,
    )
  })

  test('claimPolicies resolves public Permit2 policy to policy data', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      claimPolicies: [
        {
          type: 'permit2',
          spenders: ['0x1234567890123456789012345678901234567890'],
          sourceTokens: [{ chain: base, address: USDC }],
          destinationTokens: [{ chain: base, address: RECIPIENT }],
          recipients: [{ chain: base, address: 'any' }],
          recipientIsAccount: true,
          permitDeadline: { min: 1n, max: 2n },
          fillDeadline: [{ chain: base, min: 3n, max: 4n }],
        },
      ],
    })
    const data = getSessionData(session)
    expect(data.claimPolicies).toHaveLength(1)
    expect(data.claimPolicies[0].policy).toBe(PERMIT2_CLAIM_POLICY_ADDRESS)
    expect(data.claimPolicies[0].initData).not.toBe('0x')
  })
})

// ---------------------------------------------------------------------------
// B'. crossChainPermits expansion
// ---------------------------------------------------------------------------

describe('crossChainPermits expansion', () => {
  const USDC_ARB: Address = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'

  test('one permit with settlement layer → one Permit2 claim policy with arbiter whitelist', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      crossChainPermits: [
        {
          from: [{ chain: base, token: USDC }],
          to: [{ chain: base, token: USDC_ARB }],
          settlementLayers: ['ECO'],
        },
      ],
    })
    const data = getSessionData(session)
    expect(data.claimPolicies).toHaveLength(1)
    expect(data.claimPolicies[0].policy).toBe(PERMIT2_CLAIM_POLICY_ADDRESS)
    // modeConfig header: FIELD_ARBITER bit (bit 0) set → arbiter check on
    const modeConfig = Number.parseInt(
      data.claimPolicies[0].initData.slice(2, 10),
      16,
    )
    expect(modeConfig & 0b11).toBe(0b01)
  })

  test('permit with maxAmount adds a SpendingLimitsPolicy to the fallback', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      crossChainPermits: [
        {
          from: [{ chain: base, token: USDC, maxAmount: 1_000n }],
          to: [{ chain: base, token: USDC_ARB }],
        },
      ],
    })
    const data = getSessionData(session)
    const fallback = data.actions.find(
      (a) => a.actionTarget === SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    )!
    expect(
      fallback.actionPolicies.some(
        (p) => p.policy === SPENDING_LIMITS_POLICY_ADDRESS,
      ),
    ).toBe(true)
  })

  test('permit with validUntil adds a TimeFramePolicy to the fallback', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      crossChainPermits: [
        {
          from: [{ chain: base, token: USDC }],
          to: [{ chain: base, token: USDC_ARB }],
          validUntil: new Date(2_000_000_000 * 1000),
        },
      ],
    })
    const data = getSessionData(session)
    const fallback = data.actions.find(
      (a) => a.actionTarget === SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    )!
    expect(
      fallback.actionPolicies.some(
        (p) => p.policy === TIME_FRAME_POLICY_ADDRESS,
      ),
    ).toBe(true)
  })

  test('user claimPolicies + crossChainPermits are concatenated', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      claimPolicies: [{ type: 'permit2' }],
      crossChainPermits: [
        {
          from: [{ chain: base, token: USDC }],
          to: [{ chain: base, token: USDC_ARB }],
        },
      ],
    })
    expect(session.claimPolicies).toHaveLength(2)
    const data = getSessionData(session)
    expect(data.claimPolicies).toHaveLength(2)
  })

  test('multiple permits → N claim policies', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      crossChainPermits: [
        {
          from: [{ chain: base, token: USDC }],
          to: [{ chain: base, token: USDC_ARB }],
        },
        {
          from: [{ chain: base, token: USDC }],
          to: [{ chain: base, token: USDC_ARB }],
        },
        {
          from: [{ chain: base, token: USDC }],
          to: [{ chain: base, token: USDC_ARB }],
        },
      ],
    })
    expect(getSessionData(session).claimPolicies).toHaveLength(3)
  })

  test('permit with neither from nor to still emits a claim policy (arbiter-only)', () => {
    // from/to optional — a permit with just a settlement layer is "any
    // cross-chain move through these arbiters". The arbiter whitelist is
    // always present (settlement layers resolve to it), so the claim
    // policy initData is non-empty.
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      crossChainPermits: [{ settlementLayers: ['ECO'] }],
    })
    const data = getSessionData(session)
    expect(data.claimPolicies).toHaveLength(1)
    const modeConfig = Number.parseInt(
      data.claimPolicies[0].initData.slice(2, 10),
      16,
    )
    // arbiter bit set, token-in / token-out bits unset (no from/to)
    expect(modeConfig & 0b11).toBe(0b01)
  })

  test('omitted from/to → source/dest token checks are skipped (mode bits unset)', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      crossChainPermits: [{ settlementLayers: ['ECO'] }],
    })
    const withTokens = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      crossChainPermits: [
        {
          from: [{ chain: base, token: USDC }],
          to: [{ chain: base, token: USDC_ARB }],
          settlementLayers: ['ECO'],
        },
      ],
    })
    const bare = getSessionData(session).claimPolicies[0].initData
    const tokened = getSessionData(withTokens).claimPolicies[0].initData
    // Adding source/dest tokens flips additional mode bits + lengthens the
    // payload, so the two encodings must differ.
    expect(bare).not.toBe(tokened)
    expect(bare.length).toBeLessThan(tokened.length)
  })

  test('one-sided validAfter → TimeFramePolicy gets an always-passing far-future validUntil (not 0)', () => {
    // Regression: a permit with only `validAfter` must NOT produce a
    // TimeFramePolicy with validUntil=0 (expired the instant validAfter is
    // reached). It should default to the year-2100 sentinel, mirroring the
    // permission resolver.
    const validAfterSeconds = 1_700_000_000 // unix seconds
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      crossChainPermits: [
        {
          from: [{ chain: base, token: USDC }],
          to: [{ chain: base, token: USDC_ARB }],
          validAfter: new Date(validAfterSeconds * 1000),
        },
      ],
    })
    const data = getSessionData(session)
    const fallback = data.actions.find(
      (a) => a.actionTarget === SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    )!
    const timeFrame = fallback.actionPolicies.find(
      (p) => p.policy === TIME_FRAME_POLICY_ADDRESS,
    )
    expect(timeFrame).toBeDefined()
    // initData is encodePacked(['uint48','uint48'], [validUntil_s, validAfter_s]):
    // 6 bytes (12 hex chars) each, validUntil first.
    const hex = timeFrame!.initData.slice(2)
    const validUntilSec = Number.parseInt(hex.slice(0, 12), 16)
    const validAfterSec = Number.parseInt(hex.slice(12, 24), 16)
    expect(validAfterSec).toBe(validAfterSeconds)
    // Far-future sentinel (year 2100) in seconds — must be well in the future.
    expect(validUntilSec).toBe(4_102_444_800)
    expect(validUntilSec).toBeGreaterThan(validAfterSec)
  })
})

// ---------------------------------------------------------------------------
// B''. selectPermit2ClaimPolicyForMessage — picks the right claim policy for
//      a Permit2 message when a session holds more than one.
// ---------------------------------------------------------------------------

describe('selectPermit2ClaimPolicyForMessage', () => {
  const ARB_A: Address = '0xaAAa000000000000000000000000000000000001'
  const ARB_B: Address = '0xbBBb000000000000000000000000000000000002'
  const TOKEN_OUT: Address = '0xCccC000000000000000000000000000000000003'
  const RCPT: Address = '0xDddD000000000000000000000000000000000004'
  const EMPTY_OP = { vt: zeroHash, ops: [] as never[] }

  function messageWithSpender(
    spender: Address,
    overrides: Partial<{
      targetChain: bigint
      recipient: Address
      tokenOut: Address
    }> = {},
  ) {
    return {
      permitted: [{ token: USDC, amount: 1_000n }],
      spender,
      nonce: 1n,
      deadline: 9_999n,
      mandate: {
        target: {
          recipient: overrides.recipient ?? RCPT,
          tokenOut: [{ token: overrides.tokenOut ?? TOKEN_OUT, amount: 1n }],
          targetChain: overrides.targetChain ?? BigInt(base.id),
          fillExpiry: 8_888n,
        },
        minGas: 0n,
        originOps: EMPTY_OP,
        destOps: EMPTY_OP,
        q: zeroHash,
      },
    }
  }

  test('0 policies → undefined', () => {
    expect(
      selectPermit2ClaimPolicyForMessage([], messageWithSpender(ARB_A)),
    ).toBeUndefined()
  })

  test('1 policy → that policy regardless of match', () => {
    const only = { type: 'permit2' as const, spenders: [ARB_B] }
    expect(
      selectPermit2ClaimPolicyForMessage([only], messageWithSpender(ARB_A)),
    ).toBe(only)
  })

  test('picks the policy whose spender matches the message (not [0])', () => {
    const a = { type: 'permit2' as const, spenders: [ARB_A] }
    const b = { type: 'permit2' as const, spenders: [ARB_B] }
    // message spender = ARB_B → must select b, even though a is first.
    expect(
      selectPermit2ClaimPolicyForMessage([a, b], messageWithSpender(ARB_B)),
    ).toBe(b)
  })

  test('falls back to first policy when none match', () => {
    const a = { type: 'permit2' as const, spenders: [ARB_A] }
    const b = { type: 'permit2' as const, spenders: [ARB_B] }
    const unknownSpender: Address = '0xeeEe000000000000000000000000000000000009'
    expect(
      selectPermit2ClaimPolicyForMessage(
        [a, b],
        messageWithSpender(unknownSpender),
      ),
    ).toBe(a)
  })

  test('a policy with no spenders (any arbiter) matches any message', () => {
    const specific = { type: 'permit2' as const, spenders: [ARB_A] }
    const any = { type: 'permit2' as const }
    // message spender = ARB_B → specific fails, `any` matches.
    expect(
      selectPermit2ClaimPolicyForMessage(
        [specific, any],
        messageWithSpender(ARB_B),
      ),
    ).toBe(any)
  })

  test('disambiguates by destination token + targetChain when spenders overlap', () => {
    const otherToken: Address = '0xffFf00000000000000000000000000000000000a'
    const a = {
      type: 'permit2' as const,
      spenders: [ARB_A],
      destinationTokens: [{ chain: base, address: otherToken }],
    }
    const b = {
      type: 'permit2' as const,
      spenders: [ARB_A],
      destinationTokens: [{ chain: base, address: TOKEN_OUT }],
    }
    // Same spender on both; only b allows the message's tokenOut.
    expect(
      selectPermit2ClaimPolicyForMessage(
        [a, b],
        messageWithSpender(ARB_A, { tokenOut: TOKEN_OUT }),
      ),
    ).toBe(b)
  })

  test("recipient='any' for the target chain matches any recipient", () => {
    const a = {
      type: 'permit2' as const,
      spenders: [ARB_A],
      recipients: [{ chain: base, address: RCPT }],
    }
    const b = {
      type: 'permit2' as const,
      spenders: [ARB_B],
      recipients: [{ chain: base, address: 'any' as const }],
    }
    const otherRecipient: Address = '0x1111000000000000000000000000000000000011'
    // spender ARB_B + a recipient not in a's list → b ('any') matches.
    expect(
      selectPermit2ClaimPolicyForMessage(
        [a, b],
        messageWithSpender(ARB_B, { recipient: otherRecipient }),
      ),
    ).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// C. getPermissionId
// ---------------------------------------------------------------------------

describe('getPermissionId', () => {
  test('deterministic — same session returns same id', () => {
    expect(getPermissionId(baseSession)).toBe(getPermissionId(baseSession))
  })

  test('different owners → different permissionId', () => {
    const sessionB = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountB] },
    })
    expect(getPermissionId(baseSession)).not.toBe(getPermissionId(sessionB))
  })

  test('actions do not affect permissionId (only validator identity does)', () => {
    // permissionId is derived from sessionValidator + sessionValidatorInitData + salt,
    // NOT from actions — so same owner with different actions yields the same id
    expect(getPermissionId(baseSession)).toBe(
      getPermissionId(sessionWithAction),
    )
  })

  test('returns 32-byte hex string', () => {
    const id = getPermissionId(baseSession)
    expect(id).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

// ---------------------------------------------------------------------------
// D. packSignature
// ---------------------------------------------------------------------------

describe('packSignature', () => {
  test('verifyExecutions: false → MODE_USE (0x00) prefix', () => {
    const signers: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: baseSession,
      verifyExecutions: false,
    }
    const result = packSignature(signers, dummySig)
    expect(slice(result, 0, 1)).toBe('0x00')
  })

  test('verifyExecutions: false → bytes 1-32 are the permissionId', () => {
    const signers: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: baseSession,
      verifyExecutions: false,
    }
    const result = packSignature(signers, dummySig)
    const permissionId = getPermissionId(baseSession)
    expect(slice(result, 1, 33)).toBe(permissionId)
  })

  test('verifyExecutions: false → total length > 66 bytes', () => {
    const signers: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: baseSession,
      verifyExecutions: false,
    }
    const result = packSignature(signers, dummySig)
    const byteLen = (result.length - 2) / 2
    expect(byteLen).toBeGreaterThan(66)
  })

  test('verifyExecutions: true + enableData → MODE_ENABLE (0x01) prefix', () => {
    const signers: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: baseSession,
      verifyExecutions: true,
      enableData: {
        userSignature: dummySig,
        hashesAndChainIds: [
          { chainId: BigInt(base.id), sessionDigest: zeroHash },
        ],
        sessionToEnableIndex: 0,
      },
    }
    const result = packSignature(signers, dummySig)
    expect(slice(result, 0, 1)).toBe('0x01')
  })

  test('verifyExecutions: true + enableData → longer output (has compressed payload)', () => {
    const signers: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: baseSession,
      verifyExecutions: true,
      enableData: {
        userSignature: dummySig,
        hashesAndChainIds: [
          { chainId: BigInt(base.id), sessionDigest: zeroHash },
        ],
        sessionToEnableIndex: 0,
      },
    }
    const result = packSignature(signers, dummySig)
    const byteLen = (result.length - 2) / 2
    expect(byteLen).toBeGreaterThan(33)
  })

  test('verifyExecutions: true, no enableData → MODE_USE (0x00) prefix', () => {
    const signers: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: baseSession,
      verifyExecutions: true,
    }
    const result = packSignature(signers, dummySig)
    expect(slice(result, 0, 1)).toBe('0x00')
  })

  test('different owners produce different packed bytes', () => {
    const sessionB = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountB] },
    })
    const signersA: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: baseSession,
      verifyExecutions: false,
    }
    const signersB: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: sessionB,
      verifyExecutions: false,
    }
    expect(packSignature(signersA, dummySig)).not.toBe(
      packSignature(signersB, dummySig),
    )
  })
})

// ---------------------------------------------------------------------------
// E. buildMockSignature (existing tests preserved + extras)
// ---------------------------------------------------------------------------

describe('buildMockSignature', () => {
  test('first 20 bytes are the emissary address', () => {
    const sig = buildMockSignature(baseSession)
    const validatorBytes = slice(sig, 0, 20)
    expect(
      isAddressEqual(validatorBytes as Address, SMART_SESSION_EMISSARY_ADDRESS),
    ).toBe(true)
  })

  test('byte 20 is SMART_SESSION_MODE_ENABLE (0x01)', () => {
    const sig = buildMockSignature(baseSession)
    const modeByte = slice(sig, 20, 21)
    expect(modeByte).toBe('0x01')
  })

  test('total length is larger than just emissary + mode byte (has compressed payload)', () => {
    const sig = buildMockSignature(baseSession)
    const byteLen = (sig.length - 2) / 2
    expect(byteLen).toBeGreaterThan(21)
  })

  test('sessions with different actions produce different sigData', () => {
    const sigBase = buildMockSignature(baseSession)
    const sigWithAction = buildMockSignature(sessionWithAction)
    expect(sigBase).not.toBe(sigWithAction)
  })

  test('useDevContracts=true produces different emissary prefix', () => {
    const sigProd = buildMockSignature(baseSession, false)
    const sigDev = buildMockSignature(baseSession, true)
    expect(slice(sigProd, 0, 20)).not.toBe(slice(sigDev, 0, 20))
  })

  test('chainCount=2 produces valid output (LibZip may compress smaller than chainCount=1)', () => {
    const sig = buildMockSignature(baseSession, false, 2)
    // Must be at least emissaryAddress (20) + mode byte (1) + some payload
    const byteLen = (sig.length - 2) / 2
    expect(byteLen).toBeGreaterThan(21)
    // Must start with the emissary address
    expect(
      isAddressEqual(
        slice(sig, 0, 20) as Address,
        SMART_SESSION_EMISSARY_ADDRESS,
      ),
    ).toBe(true)
  })

  test('omitting targetChainId matches passing session.chain.id explicitly', () => {
    // Backward compat: the legacy single-chain path (no targetChainId)
    // should produce the same sig as explicitly passing session.chain.id.
    const sigDefault = buildMockSignature(baseSession, false, 1)
    const sigExplicitSessionChain = buildMockSignature(
      baseSession,
      false,
      1,
      baseSession.chain.id,
    )
    expect(sigDefault).toBe(sigExplicitSessionChain)
  })

  test('targetChainId different from session.chain.id changes the sig payload', () => {
    // baseSession.chain is Base (8453). Passing a different targetChainId
    // must change the encoded hashesAndChainIds[0].chainId, producing a
    // different compressed sig payload.
    const sigForSessionChain = buildMockSignature(baseSession, false, 1)
    const sigForOtherChain = buildMockSignature(baseSession, false, 1, 42161)
    expect(sigForSessionChain).not.toBe(sigForOtherChain)
  })

  test('different targetChainId values produce different sigs', () => {
    // Two calls with the same session but different target chains must
    // produce distinct sigs — the per-chain mockSignatures path relies on
    // this to give each chain its own correct chainId in the first entry.
    const sigForArb = buildMockSignature(baseSession, false, 2, 42161)
    const sigForOpt = buildMockSignature(baseSession, false, 2, 10)
    expect(sigForArb).not.toBe(sigForOpt)
  })

  test('non-finite chainCount normalizes to 1 (guards against undefined callsite)', () => {
    // Regression guard: `sourceChains?.length` can be undefined at call sites
    // and would previously make `Math.max(1, undefined) === NaN`, producing
    // an empty hashesAndChainIds array and silently dropping the ChainId
    // check. The internal normalization must clamp to at least 1.
    const sigDefault = buildMockSignature(baseSession, false)
    const sigUndefined = buildMockSignature(
      baseSession,
      false,
      undefined as unknown as number,
    )
    const sigNaN = buildMockSignature(baseSession, false, NaN)
    const sigZero = buildMockSignature(baseSession, false, 0)
    expect(sigUndefined).toBe(sigDefault)
    expect(sigNaN).toBe(sigDefault)
    expect(sigZero).toBe(sigDefault)
  })

  test("shape 'enable' emits the ENABLE shape (mode byte 0x01)", () => {
    const sig = buildMockSignature(baseSession, false, 1, undefined, 'enable')
    expect(slice(sig, 20, 21)).toBe('0x01')
  })

  test("shape 'use' emits the USE shape (mode byte 0x00)", () => {
    // Already-enabled session with explicit permissions: the real sig is MODE_USE
    // (verifyExecution, no enableData). The mock must match so the orchestrator
    // simulates the steady-state path, not the install path.
    const sig = buildMockSignature(baseSession, false, 1, undefined, 'use')
    expect(slice(sig, 20, 21)).toBe('0x00')
    // USE shape places the permissionId right after the mode byte (no compressed
    // enable payload), distinguishing it from the 0x01 ENABLE shape.
    expect(slice(sig, 21, 53)).toBe(getPermissionId(baseSession))
  })

  test("shape 'erc1271' emits the ERC-1271 shape (mode byte 0x00), still emissary-prefixed", () => {
    const sig = buildMockSignature(baseSession, false, 1, undefined, 'erc1271')
    expect(
      isAddressEqual(
        slice(sig, 0, 20) as Address,
        SMART_SESSION_EMISSARY_ADDRESS,
      ),
    ).toBe(true)
    expect(slice(sig, 20, 21)).toBe('0x00')
  })

  test("shape 'erc1271' places permissionId right after the mode byte", () => {
    // The orchestrator strips the 20-byte validator prefix + 1 mode byte, then
    // simulate_verify1271 reads signature[0:32] as the permissionId. Pin that
    // the permissionId lands at bytes [21:53] so that stripping stays correct.
    const sig = buildMockSignature(baseSession, false, 1, undefined, 'erc1271')
    expect(slice(sig, 21, 53)).toBe(getPermissionId(baseSession))
  })

  test('enable / use / erc1271 shapes all differ', () => {
    const enableShape = buildMockSignature(
      baseSession,
      false,
      1,
      undefined,
      'enable',
    )
    const useShape = buildMockSignature(baseSession, false, 1, undefined, 'use')
    const erc1271Shape = buildMockSignature(
      baseSession,
      false,
      1,
      undefined,
      'erc1271',
    )
    expect(enableShape).not.toBe(useShape)
    expect(enableShape).not.toBe(erc1271Shape)
    expect(useShape).not.toBe(erc1271Shape)
  })
})
