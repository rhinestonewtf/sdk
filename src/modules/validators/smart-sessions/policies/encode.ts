import {
  encodeAbiParameters,
  encodePacked,
  type Hex,
  isHex,
  padHex,
  toHex,
  zeroHash,
} from 'viem'
import type {
  ArgPolicyExpression,
  ResolvedPolicy,
  SessionPolicy,
  UniversalActionPolicyParamCondition,
  UniversalActionPolicyParamRule,
} from '../types'
import {
  DEFAULT_POLICY_ADDRESSES,
  INTENT_EXECUTION_POLICY_ADDRESS,
  INTENT_EXECUTION_POLICY_ADDRESS_DEV,
  type ResolvedPolicyAddresses,
} from './addresses'

interface EncodedRule {
  readonly condition: number
  readonly offset: bigint
  readonly isLimited: boolean
  readonly ref: Hex
  readonly usage: { readonly limit: bigint; readonly used: bigint }
}

type SixteenRules = [
  EncodedRule,
  EncodedRule,
  EncodedRule,
  EncodedRule,
  EncodedRule,
  EncodedRule,
  EncodedRule,
  EncodedRule,
  EncodedRule,
  EncodedRule,
  EncodedRule,
  EncodedRule,
  EncodedRule,
  EncodedRule,
  EncodedRule,
  EncodedRule,
]

const conditionIds: Readonly<
  Record<UniversalActionPolicyParamCondition, number>
> = {
  equal: 0,
  greaterThan: 1,
  lessThan: 2,
  greaterThanOrEqual: 3,
  lessThanOrEqual: 4,
  notEqual: 5,
  inRange: 6,
}

function encodeRule(rule: UniversalActionPolicyParamRule): EncodedRule {
  return {
    condition: conditionIds[rule.condition],
    offset: rule.calldataOffset,
    isLimited: rule.usageLimit !== undefined,
    ref: isHex(rule.referenceValue)
      ? padHex(rule.referenceValue)
      : toHex(rule.referenceValue, { size: 32 }),
    usage: { limit: rule.usageLimit ?? 0n, used: 0n },
  }
}

function compileExpression(expression: ArgPolicyExpression): {
  readonly rules: readonly EncodedRule[]
  readonly packedNodes: readonly bigint[]
  readonly rootNodeIndex: number
} {
  const rules: EncodedRule[] = []
  const nodes: bigint[] = []
  const walk = (node: ArgPolicyExpression): number => {
    if (node.type === 'rule') {
      const ruleIndex = rules.push(encodeRule(node.rule)) - 1
      const nodeIndex = nodes.length
      nodes.push(BigInt(ruleIndex) << 2n)
      return nodeIndex
    }
    if (node.type === 'not') {
      const child = walk(node.child)
      const nodeIndex = nodes.length
      nodes.push(1n | (BigInt(child) << 10n))
      return nodeIndex
    }
    const left = walk(node.left)
    const right = walk(node.right)
    const nodeIndex = nodes.length
    nodes.push(
      (node.type === 'and' ? 2n : 3n) |
        (BigInt(left) << 10n) |
        (BigInt(right) << 18n),
    )
    return nodeIndex
  }
  const rootNodeIndex = walk(expression)
  if (rules.length > 128) {
    throw new Error(
      `ArgPolicy expression has ${rules.length} rules, max is 128`,
    )
  }
  if (nodes.length > 256) {
    throw new Error(
      `ArgPolicy expression has ${nodes.length} nodes, max is 256`,
    )
  }
  return { rules, packedNodes: nodes, rootNodeIndex }
}

export function encodeSessionPolicy(
  policy: SessionPolicy,
  environment: 'production' | 'development',
  addresses: ResolvedPolicyAddresses = DEFAULT_POLICY_ADDRESSES,
): ResolvedPolicy {
  switch (policy.type) {
    case 'sudo':
      return { policy: addresses.sudo, initData: '0x' }
    case 'intent-execution':
      return {
        policy:
          environment === 'development'
            ? INTENT_EXECUTION_POLICY_ADDRESS_DEV
            : INTENT_EXECUTION_POLICY_ADDRESS,
        initData: '0x',
      }
    case 'universal-action': {
      const rules = Array.from(
        { length: 16 },
        (): EncodedRule => ({
          condition: 0,
          offset: 0n,
          isLimited: false,
          ref: zeroHash,
          usage: { limit: 0n, used: 0n },
        }),
      ) as SixteenRules
      if (policy.rules.length > rules.length) {
        throw new Error('Universal action policy supports at most 16 rules')
      }
      policy.rules.forEach((rule, index) => {
        rules[index] = encodeRule(rule)
      })
      return {
        policy: addresses.universalAction,
        initData: encodeAbiParameters(
          [
            {
              name: 'ActionConfig',
              type: 'tuple',
              components: [
                { name: 'valueLimitPerUse', type: 'uint256' },
                {
                  name: 'paramRules',
                  type: 'tuple',
                  components: [
                    { name: 'length', type: 'uint256' },
                    {
                      name: 'rules',
                      type: 'tuple[16]',
                      components: [
                        { name: 'condition', type: 'uint8' },
                        { name: 'offset', type: 'uint64' },
                        { name: 'isLimited', type: 'bool' },
                        { name: 'ref', type: 'bytes32' },
                        {
                          name: 'usage',
                          type: 'tuple',
                          components: [
                            { name: 'limit', type: 'uint256' },
                            { name: 'used', type: 'uint256' },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          [
            {
              valueLimitPerUse: policy.valueLimitPerUse ?? 0n,
              paramRules: { length: BigInt(policy.rules.length), rules },
            },
          ],
        ),
      }
    }
    case 'arg-policy': {
      const compiled = compileExpression(policy.expression)
      return {
        policy: addresses.argPolicy,
        initData: encodeAbiParameters(
          [
            {
              name: 'ActionConfig',
              type: 'tuple',
              components: [
                { name: 'valueLimitPerUse', type: 'uint256' },
                {
                  name: 'paramRules',
                  type: 'tuple',
                  components: [
                    { name: 'rootNodeIndex', type: 'uint8' },
                    {
                      name: 'rules',
                      type: 'tuple[]',
                      components: [
                        { name: 'condition', type: 'uint8' },
                        { name: 'offset', type: 'uint64' },
                        { name: 'isLimited', type: 'bool' },
                        { name: 'ref', type: 'bytes32' },
                        {
                          name: 'usage',
                          type: 'tuple',
                          components: [
                            { name: 'limit', type: 'uint256' },
                            { name: 'used', type: 'uint256' },
                          ],
                        },
                      ],
                    },
                    { name: 'packedNodes', type: 'uint256[]' },
                  ],
                },
              ],
            },
          ],
          [
            {
              valueLimitPerUse: policy.valueLimitPerUse ?? 0n,
              paramRules: compiled,
            },
          ],
        ),
      }
    }
    case 'spending-limits':
      return {
        policy: addresses.spendingLimits,
        initData: encodeAbiParameters(
          [{ type: 'address[]' }, { type: 'uint256[]' }],
          [
            policy.limits.map(({ token }) => token),
            policy.limits.map(({ amount }) => amount),
          ],
        ),
      }
    case 'time-frame':
      return {
        policy: addresses.timeFrame,
        initData: encodePacked(
          ['uint48', 'uint48'],
          [
            Math.floor(policy.validUntil / 1000),
            Math.floor(policy.validAfter / 1000),
          ],
        ),
      }
    case 'usage-limit':
      return {
        policy: addresses.usageLimit,
        initData: encodePacked(['uint128'], [policy.limit]),
      }
    case 'value-limit':
      return {
        policy: addresses.valueLimit,
        initData: encodeAbiParameters([{ type: 'uint256' }], [policy.limit]),
      }
  }
}
