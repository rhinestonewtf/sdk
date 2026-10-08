import fc from 'fast-check'
import {
  type Address,
  type Chain,
  type Hex,
  keccak256,
  maxUint256,
  size,
  slice,
  toHex,
} from 'viem'
import { arbitrum, avalanche, base, linea, plasma } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../../test/consts'
import { admits, install } from '../../../../../test/utils/installed-policies'
import {
  ACCOUNT,
  ARB,
  cctp,
  context,
  execute,
  lz,
  PLASMA,
  SONEIUM,
  stargate,
  USDC_PLASMA,
} from '../../../../../test/utils/lz-calldata'
import {
  type RuleUsage,
  satisfiesRules,
} from '../../../../../test/utils/policy-rules'
import { propertyParameters } from '../../../../../test/utils/property'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { PERMIT2_CLAIM_POLICY_ADDRESS } from '../../policies/claim/permit2'
import { getSessionDetails } from '../authorization'
import { getPermissionId } from '../digest'
import {
  resolveSessionData,
  sessionPolicyAddresses,
  toSession,
} from '../resolve'
import { LZ_EXECUTE_SELECTOR, scopeLz } from '../settlement/lz'
import type { SettlementCatalog } from '../settlement/types'
import type {
  ArgPolicyExpression,
  CrossChainPermissionInput,
  ResolvedPolicy,
  ScopedAction,
  SessionDefinition,
  SessionPolicy,
  UniversalActionPolicyParamRule,
} from '../types'
import {
  ARG_POLICY_ADDRESS,
  DEFAULT_POLICY_ADDRESSES,
  INTENT_EXECUTION_POLICY_ADDRESS,
  INTENT_EXECUTION_POLICY_ADDRESS_DEV,
  resolvePolicyAddresses,
  SPENDING_LIMITS_POLICY_ADDRESS,
  SUDO_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
  UNIVERSAL_ACTION_POLICY_COPIES,
  UNIVERSAL_ACTION_POLICY_COPY_CHAINS,
  USAGE_LIMIT_POLICY_ADDRESS,
  VALUE_LIMIT_POLICY_ADDRESS,
} from './addresses'
import { encodeActionPolicies, encodeSessionPolicy } from './encode'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address
const SESSION_ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
const FEES = {
  appFeeCollector: '0x5555555555555555555555555555555555555555',
  paymaster: '0x6666666666666666666666666666666666666666',
} as const
const WITH_FEES: SettlementCatalog = {
  ...SETTLEMENT_CATALOG,
  [base.id]: { ...SETTLEMENT_CATALOG[base.id], fees: FEES },
  [arbitrum.id]: { ...SETTLEMENT_CATALOG[arbitrum.id], fees: FEES },
}
const OFT_ARB = SETTLEMENT_CATALOG[arbitrum.id].oft!
const OFT_PLASMA = SETTLEMENT_CATALOG[plasma.id].oft!
const VALID_UNTIL = new Date(2_000_000_000_000)
const UNICHAIN = 130
const USDC_UNICHAIN = '0x078D782b760474a361dDA0AF3839290b0EF57AD6' as Address
const KINDS = {
  universalAction: [DEFAULT_POLICY_ADDRESSES.universalAction],
  argPolicy: DEFAULT_POLICY_ADDRESSES.argPolicy,
}

function permitSession(
  permit: Partial<CrossChainPermissionInput>,
  chain: Chain = base,
): SessionDefinition {
  return {
    chain,
    owners: { type: 'ecdsa', accounts: [accountA] },
    account: SESSION_ACCOUNT,
    oneTimeUse: { id: 7n },
    policyAddresses: { oneTimeUseId: ONE_TIME_USE },
    crossChainPermits: [
      {
        validUntil: VALID_UNTIL,
        from: { chain: base, token: USDC, maxAmount: 100_000_000n },
        to: { chain: arbitrum, token: USDC_ARB },
        ...permit,
      },
    ],
  } as SessionDefinition
}

const andOf = (n: number, limitedAt: number[] = []) => {
  const leaves = Array.from({ length: n }, (_, i) => ({
    type: 'rule' as const,
    rule: {
      condition: 'lessThanOrEqual' as const,
      calldataOffset: BigInt(32 * i),
      referenceValue: BigInt(1000 + i),
      ...(limitedAt.includes(i) ? { usageLimit: 5000n } : {}),
    },
  }))
  return leaves
    .slice(1)
    .reduce<ArgPolicyExpression>(
      (left, right) => ({ type: 'and', left, right }),
      leaves[0],
    )
}

/** Sessions whose encoding must not move while no extra deployment is configured. */
const SESSIONS: Record<
  string,
  { definition: SessionDefinition; settlement?: SettlementCatalog }
> = {
  cctp: { definition: permitSession({ settlementLayers: ['CCTP'] }) },
  eco: {
    definition: permitSession({ settlementLayers: ['ECO_IE'], maxFeeBps: 50 }),
  },
  lz: { definition: permitSession({ settlementLayers: ['LZ'] }) },
  'lz, fees': {
    definition: permitSession({ settlementLayers: ['LZ'], allowFees: true }),
    settlement: WITH_FEES,
  },
  oft: {
    definition: permitSession(
      {
        from: { chain: arbitrum, token: OFT_ARB.token, maxAmount: 100n },
        to: { chain: plasma, token: OFT_PLASMA.token },
        settlementLayers: ['OFT'],
      },
      arbitrum,
    ),
  },
  'same chain': {
    definition: permitSession({
      from: { chain: base, token: USDC, maxAmount: 100n },
      to: { chain: base, token: USDC, recipient: OTHER },
      allowRecipientNotAccount: true,
      settlementLayers: ['SAME_CHAIN_IE'],
    } as Partial<CrossChainPermissionInput>),
  },
  all: {
    definition: permitSession({ settlementLayers: 'all', maxFeeBps: 50 }),
  },
  'all, fees': {
    definition: permitSession({
      settlementLayers: 'all',
      maxFeeBps: 50,
      allowFees: true,
    }),
    settlement: WITH_FEES,
  },
  'raw actions': {
    definition: {
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      actions: [
        {
          target: OTHER,
          selector: '0x12345678',
          policies: [
            {
              type: 'arg-policy',
              valueLimitPerUse: 7n,
              expression: andOf(40, [3, 20, 39]),
            },
          ],
        },
        {
          target: OTHER,
          selector: '0x87654321',
          policies: [
            {
              type: 'universal-action',
              rules: [
                {
                  condition: 'equal',
                  calldataOffset: 0n,
                  referenceValue: 1n,
                },
              ],
            },
            { type: 'arg-policy', expression: andOf(3) },
          ],
        },
      ],
    } as SessionDefinition,
  },
}

/** Everything a session commits to: its actions' policies and the digests signed. */
async function fingerprint(
  definition: SessionDefinition,
  settlement: SettlementCatalog = SETTLEMENT_CATALOG,
) {
  const session = toSession(definition, { settlement })
  const details = await getSessionDetails({
    account: SESSION_ACCOUNT,
    sessions: [session],
    environment: 'production',
    readNonce: async () => 0n,
  })
  const policies = session.actions.flatMap((a) =>
    a.actionPolicies.map((p) => `${p.policy}:${p.initData}`),
  )
  return {
    permissionId: getPermissionId(session),
    policies: keccak256(toHex(policies.join(','))),
    digest: details.hashesAndChainIds[0].sessionDigest,
  }
}

const withCopies = (
  definition: SessionDefinition,
  universalActionCopies: readonly Address[],
): SessionDefinition => ({
  ...definition,
  policyAddresses: { ...definition.policyAddresses, universalActionCopies },
})

// The permit sessions opt out of the copies they now default to on these chains.
test('every session encodes and digests as pinned', async () => {
  const table: Record<string, unknown> = {}
  for (const [name, { definition, settlement }] of Object.entries(SESSIONS)) {
    table[name] = await fingerprint(
      definition.crossChainPermits ? withCopies(definition, []) : definition,
      settlement,
    )
  }
  expect(table).toMatchInlineSnapshot(`
    {
      "all": {
        "digest": "0xe0eb23bbe50f6919edc5bb48483b6f1ee0e9422371581b268c412449b5e07625",
        "permissionId": "0xb99b0492b73da1e4468b0f19512c30b381a2246895d717d3acdf2e64930b6d41",
        "policies": "0xd2552d404de73db84a4de3f6f6d36ef52c2821c38a3a73826432a7128365cb76",
      },
      "all, fees": {
        "digest": "0x26b5950d2cd863316ed060408a9e36e0757717379c2e624ea1425584a46cbce1",
        "permissionId": "0xf2fe0eea7cf0d6a3e70384274c4ca74462a999f81eb9e05ad78aa1aace951830",
        "policies": "0xd58538f1c650015c1cd3d75459ffba8f7f9adbbc0b485107fba352df825d48bc",
      },
      "cctp": {
        "digest": "0xbcf49e09fae55a5dc848ba66c2e8303eb131db0b6219c8dfaf7b95ba876aead9",
        "permissionId": "0x0975fa95bc679c082401ee181ef35a129af507979e58d6d4ad716ef030ccef07",
        "policies": "0x2ab9ade793b20d478100f2df69835bcd8b7d9185650d970633ff330a40efb922",
      },
      "eco": {
        "digest": "0x150a312637659285ac76c10e00f4aef91b9fdb432409a5f66ad7fc55d1134ea9",
        "permissionId": "0xf8ec15dd943461b1754a79c0d20fbca3cfa4c5fcf6c6b1772e26fa7aec1f55ba",
        "policies": "0x8728a20443a98219ebcce0f8fa72c410edca5097a0bcbc8060967ba86dc4ebf5",
      },
      "lz": {
        "digest": "0x130b1725cb7d5a38070128d401a8f4183478f679bf3278e4865ab120d0485073",
        "permissionId": "0xde50e777e0894a4cc1802d989953aeb92db17b9a33180d92370e72661bfd3645",
        "policies": "0xecabecc6ab4f59165bf791e77413a7c550ab22f19d629a365f0e0a847dfed147",
      },
      "lz, fees": {
        "digest": "0x487af7b59b85efd7aeae889f58b05e2a95ee55ee2f55acb19e6a5ffa03f1cfef",
        "permissionId": "0x303b17546df104bf6ee4569232169dc69b8439f9a1b40a49194abcca4dcff08c",
        "policies": "0xf94a053d0e46d1092430014445ba5df94d0b9fc97ea9b30c07cfdb3edbaf3659",
      },
      "oft": {
        "digest": "0x4c6f8f304bd53cde35404de5503a7b0fbd684686819048be9162763eea41e02f",
        "permissionId": "0xc88b273d427b7070fb92507f35c919a2b9d30d12e924ad9642c80da284330f70",
        "policies": "0xa9a7b87aec716fbd7650033e4d877d051bc46eab3da5930e91f258892ef412f7",
      },
      "raw actions": {
        "digest": "0x336beb6a24ded8a118e1a94307e9b6a8c41cc809b01a9556beb4570d954f7ab0",
        "permissionId": "0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4",
        "policies": "0x85ba9cbc3aec5e67fc5d5d8a13bc8f6f7f1990de99158c93d3423aa63665d4e0",
      },
      "same chain": {
        "digest": "0xbb7a3a38639df519d5e786358080791484a53d889db57c8422555a071f16505e",
        "permissionId": "0x66d7c7732e8bf6cedeee9b46a2f05aa4277132e12f9e153775b64ad2cf329192",
        "policies": "0x4ea09cd4d6e422a25068d9c4692c0d57d34c544001d0e77ec53024fc3e129406",
      },
    }
  `)
})

const usdcOf = (chainId: number): Address =>
  chainId === UNICHAIN
    ? USDC_UNICHAIN
    : chainId === PLASMA
      ? USDC_PLASMA
      : lz(chainId).stargateUsdc!.token

/** LZ permits whose execute ArgPolicy is a pure AND of rules. */
const LZ_PERMITS: Record<string, number> = {
  'cctp, base -> arbitrum': ARB,
  'cctp only, base -> unichain': UNICHAIN,
  'feeless cctp, base -> plasma': PLASMA,
  'stargate only, base -> soneium': SONEIUM,
}

function lzAction(chainId: number): ScopedAction {
  return scopeLz(
    context({
      destinations: [{ chainId, token: usdcOf(chainId), recipient: ACCOUNT }],
    }),
  )
}

/** The batches LZ serves into a chain. */
function served(chainId: number, o: { fee?: bigint; pull?: bigint } = {}) {
  const out: Hex[] = []
  const route = lz(chainId).cctp
  if (route) {
    out.push(
      execute(
        cctp(
          { domain: route.domain, to: ACCOUNT, ...o },
          route.feeless === true,
        ),
      ),
    )
  } else {
    out.push(
      execute(
        stargate('taxi', {
          eid: lz(chainId).stargateUsdc!.eid,
          to: ACCOUNT,
          amount: o.pull,
        }),
      ),
    )
  }
  return out
}

const MAX = 2n ** 256n

/** Every single-word mutation on the outer and the nested argument grid. */
function* mutations(data: Hex): Generator<Hex> {
  yield `0xdeadbeef${data.slice(10)}` as Hex
  const length = size(data)
  for (const grid of [4, 8]) {
    for (let at = grid; at + 32 <= length; at += 32) {
      const word = BigInt(slice(data, at, at + 32))
      for (const value of [word + 1n, 0n, BigInt(OTHER), MAX - 1n]) {
        if (value % MAX === word) continue
        const hex = toHex(value % MAX, { size: 32 }).slice(2)
        yield `${data.slice(0, 2 + 2 * at)}${hex}${data.slice(2 + 2 * (at + 32))}` as Hex
      }
    }
  }
}

describe.each(Object.entries(LZ_PERMITS))(
  'the installed-policy evaluator agrees with the rule evaluator: %s',
  (_, chainId) => {
    const action = lzAction(chainId)
    const resolved = action.policies!.map((p) =>
      encodeSessionPolicy(p, 'production'),
    )

    test('on every served batch and single-word mutation', () => {
      let refused = 0
      for (const data of served(chainId)) {
        expect(admits(install(resolved, KINDS), data)).toBe(true)
        for (const mutated of mutations(data)) {
          const verdict = admits(install(resolved, KINDS), mutated)
          expect(verdict).toBe(satisfiesRules(action, mutated))
          if (!verdict) refused++
        }
      }
      expect(refused).toBeGreaterThan(0)
    })

    test('on two-call sequences sharing the cap', () => {
      const batches = [
        ...served(chainId),
        ...served(chainId, { fee: 10_000_000n }),
        ...served(chainId, { pull: 5n, fee: 2_000_000n }),
      ]
      let capped = 0
      for (const a of batches) {
        for (const b of batches) {
          const installed = install(resolved, KINDS)
          const usage: RuleUsage = new Map()
          const verdicts = [a, b].map((data) => {
            const verdict = admits(installed, data)
            expect(verdict).toBe(satisfiesRules(action, data, usage))
            return verdict
          })
          if (
            verdicts[0] &&
            !verdicts[1] &&
            admits(install(resolved, KINDS), b)
          )
            capped++
        }
      }
      // The cap binds across calls, so the sequences are not vacuous.
      expect(capped).toBeGreaterThan(0)
    })
  },
)

const COPIES: Address[] = [
  '0x00000000000000000000000000000000000000c1',
  '0x00000000000000000000000000000000000000c2',
  '0x00000000000000000000000000000000000000c3',
]
const SPLIT = resolvePolicyAddresses({ universalActionCopies: COPIES })
const UNIVERSAL = [SPLIT.universalAction, ...COPIES]
const SPLIT_KINDS = {
  universalAction: UNIVERSAL,
  argPolicy: SPLIT.argPolicy,
}

type Rule = UniversalActionPolicyParamRule

const leaves = (e: ArgPolicyExpression): Rule[] => {
  if (e.type === 'rule') return [e.rule]
  if (e.type !== 'and') throw new Error('not a pure AND')
  return [...leaves(e.left), ...leaves(e.right)]
}

const sixteens = (rules: readonly Rule[]): Rule[][] =>
  Array.from({ length: Math.ceil(rules.length / 16) }, (_, i) =>
    rules.slice(16 * i, 16 * (i + 1)),
  )

/** UniversalActionPolicy configs, chunk `i` at `addresses[i]`. */
const configs = (
  chunks: readonly Rule[][],
  valueLimitPerUse: bigint | undefined,
  addresses: readonly Address[] = UNIVERSAL,
): ResolvedPolicy[] =>
  chunks.map((rules, i) => ({
    ...encodeSessionPolicy(
      {
        type: 'universal-action',
        valueLimitPerUse,
        rules: rules as [Rule, ...Rule[]],
      },
      'production',
    ),
    policy: addresses[i],
  }))

interface Call {
  readonly data: Hex
  readonly value: bigint
}

/** Each sequence's verdicts, every one starting from unused counters. */
const decide = (
  policies: readonly ResolvedPolicy[],
  sequences: readonly (readonly Call[])[],
  options?: { rollback: boolean },
) => {
  const installed = install(policies, SPLIT_KINDS)
  return sequences.map((calls) => {
    installed.used.clear()
    return calls.map((c) => admits(installed, c.data, c.value, options))
  })
}

/** Seeded word splices of `a` with `b`, mixing two routes' pins. */
function* splices(a: Hex, b: Hex, count: number): Generator<Hex> {
  let seed = 1
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed / 2 ** 31
  }
  for (let n = 0; n < count; n++) {
    let out = a.slice(0, 10)
    for (let at = 10; at < a.length; at += 64) {
      const wa = a.slice(at, at + 64)
      const wb = b.slice(at, at + 64)
      out += wb.length === wa.length && random() < 0.5 ? wb : wa
    }
    yield out as Hex
  }
}

const STARGATE_FEE = 110_176_109_085_186n

describe.each(Object.entries(LZ_PERMITS))(
  'a pure-AND LZ ArgPolicy split across UniversalActionPolicy deployments: %s',
  (_, chainId) => {
    const action = lzAction(chainId)
    const arg = action.policies!.find((p) => p.type === 'arg-policy')!
    if (arg.type !== 'arg-policy') throw new Error('expected an ArgPolicy')
    const rules = leaves(arg.expression)
    const old = encodeActionPolicies(
      action.policies!,
      'production',
      DEFAULT_POLICY_ADDRESSES,
    )
    const split = encodeActionPolicies(action.policies!, 'production', SPLIT)

    const valid = [...served(chainId), ...served(chainId, { pull: 4_000_000n })]
    const pool = Object.values(LZ_PERMITS).flatMap((id) => [
      ...served(id),
      ...served(id, { fee: 10_000_000n }),
    ])
    const singles: Hex[] = [
      ...valid,
      ...served(chainId, { fee: 10_000_000n }),
      ...served(chainId, { pull: 5n, fee: 2_000_000n }),
      ...valid.flatMap((data) => [...mutations(data)]),
      ...pool.flatMap((a) =>
        pool.flatMap((b) =>
          a !== b && a.length === b.length ? [...splices(a, b, 50)] : [],
        ),
      ),
    ]
    const values = [0n, STARGATE_FEE]
    const one = singles.flatMap((data) =>
      values.map((value) => [{ data, value }]),
    )
    // A refused call first, then a call that spends the whole cap: a counter
    // the refusal moved would refuse the second.
    const call = (data: Hex): Call => ({ data, value: 0n })
    const full = served(chainId).map(call)
    const two: Call[][] = [
      ...[...valid, ...served(chainId, { pull: 5n, fee: 2_000_000n })].flatMap(
        (a) => valid.map((b) => [call(a), call(b)]),
      ),
      ...singles.flatMap((a) => full.map((b) => [call(a), b])),
    ]
    const sequences = [...one, ...two]
    const expected = decide(old, sequences)

    test('uses one deployment per 16 rules, in evaluation order', () => {
      expect(old).toEqual([encodeSessionPolicy(arg, 'production')])
      expect(rules.length).toBeGreaterThan(16)
      expect(split).toEqual(
        configs(sixteens(rules), arg.valueLimitPerUse ?? 0n),
      )
    })

    test('decides every call and sequence as the ArgPolicy does', () => {
      expect(decide(split, sequences)).toEqual(expected)
      const verdicts = expected.flat()
      expect(verdicts.filter(Boolean).length).toBeGreaterThan(0)
      expect(verdicts.filter((v) => !v).length).toBeGreaterThan(0)
      // Some second call is refused only because the first spent the cap.
      const capped = two.filter((calls, i) => {
        const [first, second] = expected[one.length + i]
        return first && !second && decide(old, [[calls[1]]])[0][0] === true
      })
      expect(capped.length).toBeGreaterThan(0)
    })

    test('is decided differently once a rule is dropped', () => {
      for (let k = 0; k < rules.length; k++) {
        const dropped = rules.filter((_, i) => i !== k)
        expect(
          decide(configs(sixteens(dropped), arg.valueLimitPerUse), sequences),
          `rule ${k}`,
        ).not.toEqual(expected)
      }
    }, 30_000)

    test('is decided differently when two chunks share a deployment', () => {
      const chunks = sixteens(rules)
      for (let i = 1; i < chunks.length; i++) {
        const addresses = [...UNIVERSAL]
        addresses[i] = addresses[i - 1]
        expect(
          decide(configs(chunks, arg.valueLimitPerUse, addresses), sequences),
        ).not.toEqual(expected)
      }
    })

    test('the last limited rule moved first only matters without the revert', () => {
      const limited = rules
        .map((r) => r.usageLimit !== undefined)
        .lastIndexOf(true)
      expect(limited).toBeGreaterThanOrEqual(16)
      const moved = [rules[limited], ...rules.filter((_, i) => i !== limited)]
      const reordered = configs(sixteens(moved), arg.valueLimitPerUse)
      expect(decide(reordered, sequences)).toEqual(expected)
      const noRevert = { rollback: false }
      const unreverted = decide(old, sequences, noRevert)
      expect(decide(split, sequences, noRevert)).toEqual(unreverted)
      expect(decide(reordered, sequences, noRevert)).not.toEqual(unreverted)
    })
  },
)

/** A pure AND over `rules`, its shape drawn from `cuts`. */
function tree(
  rules: readonly Rule[],
  cuts: readonly number[],
): ArgPolicyExpression {
  if (rules.length === 1) return { type: 'rule', rule: rules[0] }
  const at = 1 + ((cuts[0] ?? 0) % (rules.length - 1))
  return {
    type: 'and',
    left: tree(rules.slice(0, at), cuts.slice(1)),
    right: tree(rules.slice(at), cuts.slice(1)),
  }
}

const CONDITIONS = [
  'equal',
  'greaterThan',
  'lessThan',
  'greaterThanOrEqual',
  'lessThanOrEqual',
  'notEqual',
  'inRange',
] as const

const ruleArb = fc
  .record({
    condition: fc.constantFrom(...CONDITIONS),
    word: fc.integer({ min: 0, max: 5 }),
    ref: fc.bigInt({ min: 0n, max: 4n }),
    max: fc.bigInt({ min: 0n, max: 4n }),
    limit: fc.option(fc.bigInt({ min: 0n, max: 8n }), { nil: undefined }),
  })
  .map(
    ({ condition, word, ref, max, limit }): Rule => ({
      condition,
      calldataOffset: BigInt(32 * word),
      referenceValue: condition === 'inRange' ? (ref << 128n) | max : ref,
      ...(limit === undefined ? {} : { usageLimit: limit }),
    }),
  )

const callArb = fc.record({
  data: fc
    .array(fc.bigInt({ min: 0n, max: 4n }), { minLength: 5, maxLength: 6 })
    .map(
      (words) =>
        `0x12345678${words.map((w) => toHex(w, { size: 32 }).slice(2)).join('')}` as Hex,
    ),
  value: fc.constantFrom(0n, 3n, 2n ** 255n),
})

test('any pure-AND ArgPolicy decides every call sequence as its split', () => {
  fc.assert(
    fc.property(
      fc.array(ruleArb, { minLength: 1, maxLength: 64 }),
      fc.array(fc.nat(), { maxLength: 64 }),
      fc.constantFrom(undefined, 0n, 3n, maxUint256),
      fc.array(fc.array(callArb, { minLength: 1, maxLength: 4 }), {
        minLength: 1,
        maxLength: 4,
      }),
      (rules, cuts, valueLimitPerUse, sequences) => {
        const policy: SessionPolicy = {
          type: 'arg-policy',
          valueLimitPerUse,
          expression: tree(rules, cuts),
        }
        const split = encodeActionPolicies([policy], 'production', SPLIT)
        expect(split.map((p) => p.policy)).toEqual(
          UNIVERSAL.slice(0, Math.ceil(rules.length / 16)),
        )
        expect(decide(split, sequences)).toEqual(
          decide([encodeSessionPolicy(policy, 'production')], sequences),
        )
      },
    ),
    propertyParameters(),
  )
})

describe('which ArgPolicies are split', () => {
  const and = andOf(35)
  const policy: SessionPolicy = { type: 'arg-policy', expression: and }

  test('none without copies, so the encoding is unchanged', () => {
    expect(
      encodeActionPolicies([policy], 'production', DEFAULT_POLICY_ADDRESSES),
    ).toEqual([encodeSessionPolicy(policy, 'production')])
  })

  test('none with fewer free deployments than chunks', () => {
    const two = resolvePolicyAddresses({ universalActionCopies: [COPIES[0]] })
    expect(encodeActionPolicies([policy], 'production', two)).toEqual([
      encodeSessionPolicy(policy, 'production'),
    ])
  })

  test('none whose expression has an OR or a NOT', () => {
    const small = andOf(3)
    const rule = leaves(andOf(1))[0]
    for (const expression of [
      { type: 'or', left: small, right: { type: 'rule', rule } },
      { type: 'and', left: small, right: { type: 'not', child: small } },
      { type: 'not', child: small },
    ] as ArgPolicyExpression[]) {
      const p: SessionPolicy = { type: 'arg-policy', expression }
      expect(encodeActionPolicies([p], 'production', SPLIT)).toEqual([
        encodeSessionPolicy(p, 'production'),
      ])
    }
  })

  test('a small one into one config on the canonical deployment', () => {
    const p: SessionPolicy = { type: 'arg-policy', expression: andOf(3) }
    expect(encodeActionPolicies([p], 'production', SPLIT)).toEqual(
      configs([leaves(andOf(3))], undefined),
    )
  })

  test('around the deployments the action already uses, in place', () => {
    const uni: SessionPolicy = {
      type: 'universal-action',
      rules: [{ condition: 'equal', calldataOffset: 0n, referenceValue: 1n }],
    }
    const usage: SessionPolicy = { type: 'usage-limit', limit: 2n }
    const encoded = encodeActionPolicies(
      [uni, policy, usage],
      'production',
      SPLIT,
    )
    expect(encoded).toEqual([
      encodeSessionPolicy(uni, 'production'),
      ...configs(sixteens(leaves(and)), undefined, COPIES),
      encodeSessionPolicy(usage, 'production'),
    ])
  })

  test('refuses copies that repeat a deployment', () => {
    expect(() =>
      resolvePolicyAddresses({
        universalActionCopies: [COPIES[0], COPIES[0].toUpperCase() as Address],
      }),
    ).toThrow('repeats')
    expect(() =>
      resolvePolicyAddresses({
        universalActionCopies: [DEFAULT_POLICY_ADDRESSES.universalAction],
      }),
    ).toThrow('repeats')
  })

  test('refuses a copy that is any other policy the SDK uses', () => {
    const OVERRIDE = '0x00000000000000000000000000000000000000d1' as Address
    const others: Address[] = [
      SUDO_POLICY_ADDRESS,
      ARG_POLICY_ADDRESS,
      SPENDING_LIMITS_POLICY_ADDRESS,
      TIME_FRAME_POLICY_ADDRESS,
      USAGE_LIMIT_POLICY_ADDRESS,
      VALUE_LIMIT_POLICY_ADDRESS,
      INTENT_EXECUTION_POLICY_ADDRESS,
      INTENT_EXECUTION_POLICY_ADDRESS_DEV,
      PERMIT2_CLAIM_POLICY_ADDRESS,
      ONE_TIME_USE,
      OVERRIDE,
      // Every other default, so a policy added later is covered too.
      ...Object.entries(DEFAULT_POLICY_ADDRESSES).flatMap(([name, address]) =>
        name === 'universalAction' ? [] : [address],
      ),
    ]
    for (const other of others) {
      for (const copy of [other, other.toLowerCase() as Address]) {
        expect(
          () =>
            resolvePolicyAddresses({
              sudo: OVERRIDE,
              oneTimeUseId: ONE_TIME_USE,
              universalActionCopies: [COPIES[0], copy],
            }),
          other,
        ).toThrow('not a UniversalActionPolicy deployment')
      }
    }
  })

  test('accepts the default deployment as a copy of an overridden one', () => {
    const universalAction = '0x00000000000000000000000000000000000000d2'
    expect(
      resolvePolicyAddresses({
        universalAction,
        universalActionCopies: [DEFAULT_POLICY_ADDRESSES.universalAction],
      }).universalActionCopies,
    ).toEqual([DEFAULT_POLICY_ADDRESSES.universalAction])
  })
})

test("copies cannot rebuild a saltMode 'v1' session", () => {
  const definition = {
    ...SESSIONS['raw actions'].definition,
    saltMode: 'v1',
    policyAddresses: { universalActionCopies: COPIES },
  } as SessionDefinition
  expect(() => resolveSessionData(definition)).toThrow(
    "universalActionCopies cannot use saltMode 'v1'",
  )
  expect(() =>
    resolveSessionData({ ...definition, policyAddresses: {} }),
  ).not.toThrow()
})

test('an LZ session installs its execute policy across the copies', () => {
  const definition = {
    ...SESSIONS.lz.definition,
    policyAddresses: {
      oneTimeUseId: ONE_TIME_USE,
      universalActionCopies: COPIES,
    },
  }
  const execute = resolveSessionData(definition, {
    settlement: SETTLEMENT_CATALOG,
  }).actions.find((a) => a.actionTargetSelector === LZ_EXECUTE_SELECTOR)!
  expect(execute.actionPolicies.map((p) => p.policy)).toEqual([
    ...UNIVERSAL.slice(0, 3),
    ONE_TIME_USE,
  ])
})

describe('a settlement-scoped session defaults to the deployed copies', () => {
  const lzSession = SESSIONS.lz.definition
  const policies = (
    definition: SessionDefinition,
    settlement: SettlementCatalog = SETTLEMENT_CATALOG,
  ) =>
    resolveSessionData(definition, { settlement }).actions.flatMap((a) =>
      a.actionPolicies.map((p) => p.policy),
    )
  const usesDeployedCopies = (
    definition: SessionDefinition,
    settlement?: SettlementCatalog,
  ) =>
    policies(definition, settlement).some((p) =>
      UNIVERSAL_ACTION_POLICY_COPIES.includes(p),
    )
  // Splits once given the copies, so its unsplit default proves the guard held.
  const expectUnsplitByDefault = async (
    definition: SessionDefinition,
    settlement: SettlementCatalog = SETTLEMENT_CATALOG,
  ) => {
    expect(
      usesDeployedCopies(
        withCopies(definition, UNIVERSAL_ACTION_POLICY_COPIES),
        settlement,
      ),
    ).toBe(true)
    expect(usesDeployedCopies(definition, settlement)).toBe(false)
    expect(await fingerprint(definition, settlement)).toEqual(
      await fingerprint(withCopies(definition, []), settlement),
    )
  }

  test('an LZ session on Base splits onto them', async () => {
    expect(UNIVERSAL_ACTION_POLICY_COPY_CHAINS.has(base.id)).toBe(true)
    expect(usesDeployedCopies(lzSession)).toBe(true)
    expect(await fingerprint(lzSession)).toEqual(
      await fingerprint(withCopies(lzSession, UNIVERSAL_ACTION_POLICY_COPIES)),
    )
  })

  test('an LZ session on Avalanche, which has none yet, encodes as before', async () => {
    expect(UNIVERSAL_ACTION_POLICY_COPY_CHAINS.has(avalanche.id)).toBe(false)
    await expectUnsplitByDefault(
      permitSession(
        {
          from: {
            chain: avalanche,
            token: SETTLEMENT_CATALOG[avalanche.id].lz!.stargateUsdc!.token,
            maxAmount: 100_000_000n,
          },
          settlementLayers: ['LZ'],
        },
        avalanche,
      ),
    )
  })

  test('an LZ session on a chain outside the set encodes as before', async () => {
    expect(UNIVERSAL_ACTION_POLICY_COPY_CHAINS.has(linea.id)).toBe(false)
    await expectUnsplitByDefault(
      permitSession(
        {
          from: { chain: linea, token: USDC, maxAmount: 100_000_000n },
          settlementLayers: ['LZ'],
        },
        linea,
      ),
      { ...SETTLEMENT_CATALOG, [linea.id]: SETTLEMENT_CATALOG[base.id] },
    )
  })

  test('a session without a settlement-scoped permit does not', async () => {
    await expectUnsplitByDefault(SESSIONS['raw actions'].definition)
  })

  // A v1 session cannot hold oneTimeUse, which every splitting permit needs,
  // and a settlement-scoped one is refused, so only the resolved addresses show
  // the guard.
  test("a saltMode 'v1' session does not, and is refused", async () => {
    const { oneTimeUse: _, ...rest } = permitSession({
      from: { chain: base, token: USDC },
      settlementLayers: ['CCTP'],
      validUntil: undefined,
    })
    const latest = { ...rest, policyAddresses: {} }
    const v1 = { ...latest, saltMode: 'v1' } as SessionDefinition
    expect(sessionPolicyAddresses(latest)?.universalActionCopies).toEqual(
      UNIVERSAL_ACTION_POLICY_COPIES,
    )
    expect(sessionPolicyAddresses(v1)).toEqual({})
    await expect(fingerprint(v1)).rejects.toThrow(
      "a settlement-scoped session cannot use saltMode 'v1'",
    )
  })

  test('an explicit empty list opts out', () => {
    expect(usesDeployedCopies(withCopies(lzSession, []))).toBe(false)
  })

  test('an explicit list is used as given', () => {
    const used = policies(withCopies(lzSession, COPIES))
    expect(used).toEqual(expect.arrayContaining(COPIES.slice(0, 2)))
    expect(used.some((p) => UNIVERSAL_ACTION_POLICY_COPIES.includes(p))).toBe(
      false,
    )
  })

  test('an overridden universalAction does not', async () => {
    const universalAction = '0x00000000000000000000000000000000000000d2'
    await expectUnsplitByDefault({
      ...lzSession,
      policyAddresses: { ...lzSession.policyAddresses, universalAction },
    })
    expect(
      usesDeployedCopies({
        ...lzSession,
        policyAddresses: {
          ...lzSession.policyAddresses,
          universalAction:
            DEFAULT_POLICY_ADDRESSES.universalAction.toLowerCase() as Address,
        },
      }),
    ).toBe(true)
  })
})
