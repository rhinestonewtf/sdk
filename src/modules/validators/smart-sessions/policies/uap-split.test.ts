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
import { arbitrum, base, plasma } from 'viem/chains'
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
import { getSessionDetails } from '../authorization'
import { getPermissionId } from '../digest'
import { resolveSessionData, toSession } from '../resolve'
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
import { DEFAULT_POLICY_ADDRESSES, resolvePolicyAddresses } from './addresses'
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

test('every session encodes and digests as pinned', async () => {
  const table: Record<string, unknown> = {}
  for (const [name, { definition, settlement }] of Object.entries(SESSIONS)) {
    table[name] = await fingerprint(definition, settlement)
  }
  expect(table).toMatchInlineSnapshot(`
    {
      "all": {
        "digest": "0xb2825b21ac5f61a9c31c5057d098c101d7e8a8b208cb05bd64db282d330d12c4",
        "permissionId": "0x548528b2c77ba4b4426768e7878732b3ee450cb8ef3c506bb6f12d2d13a2b721",
        "policies": "0xd251375c511f47c792cba21960d379319b8680cfbedf9dd5256dfbffd188f9ff",
      },
      "all, fees": {
        "digest": "0xb78c32a0175dae3e8b2e260fd631770aab59322bf6e247f61630d237608525a9",
        "permissionId": "0xb1dcccc7db6e9d006070223dddb4181e8f124299574fc55b8a2aca894b1c464b",
        "policies": "0x150950e4d8c51f276c18f538691d471149ac1ee83f747347db6fadc6a19e77a4",
      },
      "cctp": {
        "digest": "0xd159f9c7c5384e326fcbfc75684190aa5576cc9709c7e40606db940a405ff1df",
        "permissionId": "0x083fa8b0455939fdc4cb862961590729263fa11c8dd0c257b28a76e2ade3db8f",
        "policies": "0x11397c742e3b9e87919e93a933d6a5feca7a3f9505fc4ed695dab1097dede19b",
      },
      "eco": {
        "digest": "0x20c8257b14d47f9e2d2c14f06b250fe1bdf40022eba9380f772db6117339332c",
        "permissionId": "0x5ca6be716418d5fa4a0db9d935adb512d59b45949e7edb6761d4253185be04aa",
        "policies": "0x3558833171472947313e9138df1c6f17c83116c6f1b4af32a8046a0672b7d7fb",
      },
      "lz": {
        "digest": "0x75cc1ed8e6518c90ee384e0ba4876d09d3ee822d456678cc71452f3cbc0109cb",
        "permissionId": "0x6bac50fcbac5e194f4ab25791cb74a7d90150649bc6af3be90ef3f8d75e19a17",
        "policies": "0xb571399eb3683e5ea3bf51292a4b6e9a74c74bcdad67a50e22d7cba665fadad1",
      },
      "lz, fees": {
        "digest": "0x6d80a74f0b5c011d84e4931869bf3ff53bf505d3165518b89a362dac86315dda",
        "permissionId": "0xc5cf2aa6d8d4b3c7dd37d94fd7b70643a4d80545220c816e5f21425efa78e25b",
        "policies": "0x8e37afc2fdd17399c29d6a6be6a2fd84c287e4f7f0957219404f3d5d5c51ce85",
      },
      "oft": {
        "digest": "0x04961e8b22a1f67943a6fd864be1be423d68ec1efadee8e0e175575c87358b58",
        "permissionId": "0xb3eaab8a4785292a996b184364ded2805e8afa3d2050db1d4474f70eea3a02ec",
        "policies": "0x0f72d37970432604e6f428d486feb5b28e23bc0dde1b3307168dc9b1bfe89a8b",
      },
      "raw actions": {
        "digest": "0x336beb6a24ded8a118e1a94307e9b6a8c41cc809b01a9556beb4570d954f7ab0",
        "permissionId": "0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4",
        "policies": "0x85ba9cbc3aec5e67fc5d5d8a13bc8f6f7f1990de99158c93d3423aa63665d4e0",
      },
      "same chain": {
        "digest": "0xc957cb68b8085b4c79011a19564576ea8bb32f291616505a298c862446f2bd6e",
        "permissionId": "0xc4aba8867c622a0c677287b1053670346a049ca7139f92278b0b71f8483bdc98",
        "policies": "0xf3cecbcc6394d24b8eedf40003fca6558e768bbeece71bd5690a1cd594c0d83f",
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
    DEFAULT_POLICY_ADDRESSES.timeFrame,
    ONE_TIME_USE,
  ])
})
