import {
  type Address,
  type Chain,
  type Hex,
  keccak256,
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
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { getSessionDetails } from '../authorization'
import { getPermissionId } from '../digest'
import { toSession } from '../resolve'
import { scopeLz } from '../settlement/lz'
import type { SettlementCatalog } from '../settlement/types'
import type {
  ArgPolicyExpression,
  CrossChainPermissionInput,
  ScopedAction,
  SessionDefinition,
} from '../types'
import { DEFAULT_POLICY_ADDRESSES } from './addresses'
import { encodeSessionPolicy } from './encode'

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
