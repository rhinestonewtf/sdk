import {
  type Address,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  isAddressEqual,
  parseEther,
  slice,
  zeroHash,
} from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA, accountB } from '../../../test/consts'
import type { Session } from '../../types'
import type { ResolvedSessionSignerSet } from './smart-sessions'
import {
  ARG_POLICY_ADDRESS,
  buildMockSignature,
  DUMMY_PRECLAIMOP_SELECTOR,
  DUMMY_PRECLAIMOP_TARGET,
  getPermissionId,
  getPolicyData,
  getSessionData,
  INTENT_EXECUTION_POLICY_ADDRESS,
  packSignature,
  SMART_SESSION_EMISSARY_ADDRESS,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
  SPENDING_LIMITS_POLICY_ADDRESS,
  SUDO_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
  UNIVERSAL_ACTION_POLICY_ADDRESS,
  USAGE_LIMIT_POLICY_ADDRESS,
  VALUE_LIMIT_POLICY_ADDRESS,
} from './smart-sessions'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseSession: Session = {
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
}

const sessionWithAction: Session = {
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  actions: [
    {
      target: '0x1111111111111111111111111111111111111111' as Address,
      selector: '0xa9059cbb' as Hex,
      policies: [{ type: 'sudo' }],
    },
  ],
}

const dummySig = `0x${'00'.repeat(65)}` as Hex

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

  test('time-frame packs (validUntil, validAfter) as bytes16 || bytes16 in seconds (ms → s)', () => {
    const validUntil = 1_800_000_000_000
    const validAfter = 1_700_000_000_000
    const result = getPolicyData({ type: 'time-frame', validUntil, validAfter })
    expect(result.policy).toBe(TIME_FRAME_POLICY_ADDRESS)
    const expected = encodePacked(
      ['uint128', 'uint128'],
      [
        BigInt(Math.floor(validUntil / 1000)),
        BigInt(Math.floor(validAfter / 1000)),
      ],
    )
    expect(result.initData).toBe(expected)
    // 32 bytes total (matches deployed TimeFramePolicy's `bytes16 || bytes16` layout)
    expect((expected.length - 2) / 2).toBe(32)
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
  // Lazy import to avoid breaking module scope in this test file.
  const { decodeAbiParameters } = require('viem') as typeof import('viem')
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
    // Reference value left-padded to 32 bytes
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
    // Post-order: left leaf → right leaf → OR root
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
    // Right child slot must be zero — not used by NOT
    expect(notRoot.rightChild).toBe(0)
  })

  test('nested (A AND B) OR (NOT C) — node order is post-order, every parent points at earlier children', () => {
    const ruleA = {
      type: 'rule' as const,
      rule: {
        condition: 'equal' as const,
        calldataOffset: 4n,
        referenceValue: 1n,
      },
    }
    const ruleB = {
      type: 'rule' as const,
      rule: {
        condition: 'equal' as const,
        calldataOffset: 4n,
        referenceValue: 2n,
      },
    }
    const ruleC = {
      type: 'rule' as const,
      rule: {
        condition: 'equal' as const,
        calldataOffset: 4n,
        referenceValue: 3n,
      },
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
    // Every node's referenced child index must be strictly less than its own index
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
    // Build an expression with 3 distinct rule leaves so the third rule sits at index 2.
    const r = (v: bigint) =>
      ({
        type: 'rule' as const,
        rule: {
          condition: 'equal' as const,
          calldataOffset: 4n,
          referenceValue: v,
        },
      }) as const
    const result = getPolicyData({
      type: 'arg-policy',
      expression: {
        type: 'and',
        left: r(1n),
        right: { type: 'and', left: r(2n), right: r(3n) },
      },
    })
    const decoded = decodeArgPolicyInitData(result.initData)
    // Find a leaf with ruleIndex 2 and confirm it round-trips
    const leafIndices = decoded.paramRules.packedNodes
      .map(unpackNode)
      .filter((n: { nodeType: number }) => n.nodeType === 0)
      .map((n: { ruleIndex: number }) => n.ruleIndex)
    expect(leafIndices).toContain(2)
  })

  test('throws when expression compiles to >128 rules', () => {
    // Build a right-leaning AND chain of 129 rule leaves.
    const leaf = (v: bigint) =>
      ({
        type: 'rule' as const,
        rule: {
          condition: 'equal' as const,
          calldataOffset: 4n,
          referenceValue: v,
        },
      }) as const
    let expr: import('../../types').ArgPolicyExpression = leaf(0n)
    for (let i = 1; i < 129; i++) {
      expr = { type: 'and', left: leaf(BigInt(i)), right: expr }
    }
    expect(() =>
      getPolicyData({ type: 'arg-policy', expression: expr }),
    ).toThrow(/max is 128/)
  })
})

// ---------------------------------------------------------------------------
// B. getSessionData
// ---------------------------------------------------------------------------

describe('getSessionData', () => {
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

  test('ENS session owners are rejected', () => {
    const ensSession: Session = {
      chain: base,
      owners: {
        type: 'ens',
        accounts: [accountA],
        ownerExpirations: [281474976710655],
      },
    }
    expect(() => getSessionData(ensSession)).toThrow(
      'ENS owners are not supported for smart sessions',
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

  test('empty actions array → same sudoAction fallback as no actions', () => {
    // actions: [] is truthy but has no elements — must be treated the same as
    // actions: undefined so injectedActions are not appended.
    const sessionWithEmptyActions: Session = { ...baseSession, actions: [] }
    const data = getSessionData(sessionWithEmptyActions)
    expect(data.actions).toHaveLength(1)
    expect(data.actions[0].actionTarget).toBe(
      SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    )
  })

  test('multiple policies on one action', () => {
    const session: Session = {
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      actions: [
        {
          target: '0x2222222222222222222222222222222222222222' as Address,
          selector: '0x12345678' as Hex,
          policies: [{ type: 'sudo' }, { type: 'usage-limit', limit: 3n }],
        },
      ],
    }
    const data = getSessionData(session)
    expect(data.actions[0].actionPolicies).toHaveLength(2)
    expect(data.actions[0].actionPolicies[0].policy).toBe(SUDO_POLICY_ADDRESS)
    expect(data.actions[0].actionPolicies[1].policy).toBe(
      USAGE_LIMIT_POLICY_ADDRESS,
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
})

// ---------------------------------------------------------------------------
// C. getPermissionId
// ---------------------------------------------------------------------------

describe('getPermissionId', () => {
  test('deterministic — same session returns same id', () => {
    expect(getPermissionId(baseSession)).toBe(getPermissionId(baseSession))
  })

  test('different owners → different permissionId', () => {
    const sessionB: Session = {
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountB] },
    }
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
    const sessionB: Session = {
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountB] },
    }
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
})
