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
        "digest": "0x8353aa4e92bcdd90db51d290144a2ed44558b4d4bc6d7021b1ba55800e36a52c",
        "permissionId": "0x6fc58e71ed4bf5f3409b466d6c90fafefe5efb1cef816d98a3d66ae29171196e",
        "policies": "0x9b17b4c1df34f443315f551d1d38e00d787ff02761350303b4dee50a7e2fd46d",
      },
      "all, fees": {
        "digest": "0xc405c2d94aa302d4a4b3837d181b92d452344bb1b3a6cc8623b19b369ed4b5cd",
        "permissionId": "0x26930db6b0b38c5b287f729b073727342ffb5a79fec256371da3c6031b7d47d5",
        "policies": "0xbd50c5e1d9cf3a227a7a6e02af331141340d8fbe61fdeea3d48a5f25023af5fb",
      },
      "cctp": {
        "digest": "0x268bb41e6059231718a68ead89c2e296d91554b5e67940015949ecf01586a21e",
        "permissionId": "0xb9be9af903902150898a7293b11d669f451cd20f2a88313defb2f281f30011aa",
        "policies": "0x23025509f108c5edea3b6af214f939dd6c379055fcaa28fadec515e13a6c9802",
      },
      "eco": {
        "digest": "0x9f1cf4e6684f3f02c104e10b0131a10431929e73457626de61fd5a8203e2bf9d",
        "permissionId": "0x64d5b09c11b93fe1aedc0cef9f04747cfb3e9c58dd2f8f4ac6877de5fc705f76",
        "policies": "0xdd8522a6c711ad210a9467c005c90fd5704c567282c2917e9f35126a7a861951",
      },
      "lz": {
        "digest": "0x9c449aaca124cee3d97ea05f989ae16d9f4ddb06d9b63061dc96df3e0c105ad6",
        "permissionId": "0xdcb30f15b1ff348422079202ec27ade215d83ba54f44eaff63b7dab61c1e2df4",
        "policies": "0x3829b0ef2fda8c6b2e8ad4eda31f6f459a3e1799d3a59e28c2dca914bc6a9a13",
      },
      "lz, fees": {
        "digest": "0xaf24552ebea6c804e83850c267dc763d2bbd175177991adad896fe7b2be25c46",
        "permissionId": "0x9a329600de42b3a03f942225e46cc86279e5817cdf81ab9b63fd9e9896d714e9",
        "policies": "0xd9ba9bb72c214267fc9930b3af10da9b15e554063f4b3b3b7b2ad96f218c1ef2",
      },
      "oft": {
        "digest": "0x1280c602a435f49276b8018ef09789b4662b3b7f997591b631c9d0295f8bfefc",
        "permissionId": "0x4a13d6f8e2baea79e5c3a297c46fff03babd06227b4f2511a10ea4736d10bfc6",
        "policies": "0xfe85155a99133b7d740d75aa48b4a791ec27d00aef9cdf90648f6b091acbec31",
      },
      "raw actions": {
        "digest": "0x336beb6a24ded8a118e1a94307e9b6a8c41cc809b01a9556beb4570d954f7ab0",
        "permissionId": "0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4",
        "policies": "0x85ba9cbc3aec5e67fc5d5d8a13bc8f6f7f1990de99158c93d3423aa63665d4e0",
      },
      "same chain": {
        "digest": "0x64e481c988c10d6169510d9524f3571a27f6fa365732dcfbc660081bc99bcad7",
        "permissionId": "0xe2c55653e3a81e99c67757776d94a597847837459641559b56577004fbf5e16a",
        "policies": "0x2728392e08651e982cf96a5f0e8fc1d7e471aa364f277e9f4892f98961cb9218",
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

  test('an overridden argPolicy does not, even at the canonical address', async () => {
    for (const argPolicy of [
      '0x00000000000000000000000000000000000000a9' as Address,
      DEFAULT_POLICY_ADDRESSES.argPolicy,
    ]) {
      await expectUnsplitByDefault({
        ...lzSession,
        policyAddresses: { ...lzSession.policyAddresses, argPolicy },
      })
    }
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
