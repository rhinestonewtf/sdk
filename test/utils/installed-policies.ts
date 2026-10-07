import { type Address, decodeAbiParameters, type Hex, size, slice } from 'viem'
import type { ResolvedPolicy } from '../../src/modules/validators/smart-sessions/types'

interface Rule {
  readonly condition: number
  readonly offset: bigint
  readonly isLimited: boolean
  readonly ref: Hex
  readonly limit: bigint
}

type Config =
  | {
      readonly kind: 'universal-action'
      readonly valueLimitPerUse: bigint
      readonly rules: readonly Rule[]
    }
  | {
      readonly kind: 'arg-policy'
      readonly valueLimitPerUse: bigint
      readonly rules: readonly Rule[]
      readonly root: number
      readonly nodes: readonly bigint[]
    }
  | { readonly kind: 'other' }

/** Which deployments hold which policy code. */
export interface PolicyKinds {
  readonly universalAction: readonly Address[]
  readonly argPolicy: Address
}

/**
 * One action's policies as SmartSession installs them: one list entry per
 * distinct address, in first-seen order, each holding the config its last
 * `initData` wrote, plus each limited rule's usage counter.
 */
export interface InstalledAction {
  readonly order: readonly string[]
  readonly configs: ReadonlyMap<string, Config>
  readonly used: Map<string, bigint>
}

const ruleComponents = [
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
] as const

type DecodedRule = {
  condition: number
  offset: bigint
  isLimited: boolean
  ref: Hex
  usage: { limit: bigint }
}
const toRule = (r: DecodedRule): Rule => ({
  condition: r.condition,
  offset: r.offset,
  isLimited: r.isLimited,
  ref: r.ref,
  limit: r.usage.limit,
})

function decode(policy: ResolvedPolicy, kinds: PolicyKinds): Config {
  const address = policy.policy.toLowerCase()
  if (kinds.universalAction.some((a) => a.toLowerCase() === address)) {
    const [c] = decodeAbiParameters(
      [
        {
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
                  components: ruleComponents,
                },
              ],
            },
          ],
        },
      ],
      policy.initData,
    )
    return {
      kind: 'universal-action',
      valueLimitPerUse: c.valueLimitPerUse,
      rules: c.paramRules.rules
        .slice(0, Number(c.paramRules.length))
        .map(toRule),
    }
  }
  if (kinds.argPolicy.toLowerCase() === address) {
    const [c] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'valueLimitPerUse', type: 'uint256' },
            {
              name: 'paramRules',
              type: 'tuple',
              components: [
                { name: 'rootNodeIndex', type: 'uint8' },
                { name: 'rules', type: 'tuple[]', components: ruleComponents },
                { name: 'packedNodes', type: 'uint256[]' },
              ],
            },
          ],
        },
      ],
      policy.initData,
    )
    return {
      kind: 'arg-policy',
      valueLimitPerUse: c.valueLimitPerUse,
      rules: c.paramRules.rules.map(toRule),
      root: c.paramRules.rootNodeIndex,
      nodes: c.paramRules.packedNodes,
    }
  }
  return { kind: 'other' }
}

/** Installs an action's resolved policies the way SmartSession stores them. */
export function install(
  policies: readonly ResolvedPolicy[],
  kinds: PolicyKinds,
): InstalledAction {
  const order: string[] = []
  const configs = new Map<string, Config>()
  for (const policy of policies) {
    const address = policy.policy.toLowerCase()
    if (!order.includes(address)) order.push(address)
    configs.set(address, decode(policy, kinds))
  }
  return { order, configs, used: new Map() }
}

class Reverted extends Error {}

/**
 * Whether the installed action admits one call. Policies run in list order and
 * every one must pass; a refusal reverts the transaction, so no counter moves
 * unless the whole check passes. Policies other than UniversalActionPolicy and
 * ArgPolicy carry no argument rules and pass here.
 */
export function admits(
  action: InstalledAction,
  calldata: Hex,
  value = 0n,
): boolean {
  const used = new Map(action.used)
  const word = (offset: bigint): bigint => {
    const at = 4 + Number(offset)
    if (at + 32 > size(calldata)) throw new Reverted()
    return BigInt(slice(calldata, at, at + 32))
  }
  const check = (address: string, index: number, r: Rule): boolean => {
    const param = word(r.offset)
    const ref = BigInt(r.ref)
    const holds = [
      param === ref,
      param > ref,
      param < ref,
      param >= ref,
      param <= ref,
      param !== ref,
      param >= ref >> 128n && param <= (ref & (2n ** 128n - 1n)),
    ][r.condition]
    if (!holds) return false
    if (!r.isLimited) return true
    const key = `${address}:${index}`
    const prior = used.get(key) ?? 0n
    if (prior + param > r.limit) return false
    used.set(key, prior + param)
    return true
  }
  try {
    for (const address of action.order) {
      const config = action.configs.get(address) as Config
      if (config.kind === 'other') continue
      if (value > config.valueLimitPerUse) return false
      if (config.kind === 'universal-action') {
        if (config.rules.length === 0) return false
        if (!config.rules.every((r, i) => check(address, i, r))) return false
        continue
      }
      const node = (index: number): boolean => {
        const packed = config.nodes[index]
        const type = Number(packed & 3n)
        const left = Number((packed >> 10n) & 0xffn)
        if (type === 0) {
          const ruleIndex = Number((packed >> 2n) & 0xffn)
          return check(address, ruleIndex, config.rules[ruleIndex])
        }
        if (type === 1) return !node(left)
        const right = Number((packed >> 18n) & 0xffn)
        return type === 2
          ? node(left) && node(right)
          : node(left) || node(right)
      }
      if (!node(config.root)) return false
    }
  } catch (error) {
    if (error instanceof Reverted) return false
    throw error
  }
  for (const [key, amount] of used) action.used.set(key, amount)
  return true
}
