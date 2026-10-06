import {
  type Address,
  type Hex,
  keccak256,
  maxUint256,
  pad,
  size,
  slice,
  toHex,
} from 'viem'
import { describe, expect, test } from 'vitest'
import {
  ACCOUNT,
  ARB,
  BASE,
  cctp,
  context,
  execute,
  lz,
  multiCallReverts,
  OTHER,
  PLASMA,
  SONEIUM,
  stargate,
  USDC_PLASMA,
} from '../../../../../test/utils/lz-calldata'
import { scopeLzV0 } from '../../../../../test/utils/lz-scope-v0'
import {
  satisfiesRules as holds,
  type RuleUsage,
} from '../../../../../test/utils/policy-rules'
import { encodeSessionPolicy } from '../policies/encode'
import type { ArgPolicyExpression, ScopedAction } from '../types'
import { scopeLz } from './lz'
import type { SettlementCatalog, SettlementContext } from './types'

const OP = 10
const ETH = 1
const UNICHAIN = 130
const USDC_UNICHAIN = '0x078D782b760474a361dDA0AF3839290b0EF57AD6' as Address

const usdc = (chainId: number): Address =>
  chainId === UNICHAIN
    ? USDC_UNICHAIN
    : chainId === PLASMA
      ? USDC_PLASMA
      : lz(chainId).stargateUsdc!.token

const legs = (chainIds: number[], open = false) =>
  chainIds.map((chainId) => ({
    chainId,
    token: usdc(chainId),
    recipient: open ? undefined : ACCOUNT,
  }))

/** Whether a CCTP route from Base reaches the chain. */
const cctpReaches = (chainId: number) =>
  lz(BASE).cctp !== undefined && lz(chainId).cctp !== undefined

interface Batch {
  readonly data: Hex
  readonly calls: number
}

const taxi = (chainId: number, to: Address, amount?: bigint): Batch => ({
  data: execute(
    stargate('taxi', { eid: lz(chainId).stargateUsdc!.eid, to, amount }),
  ),
  calls: 4,
})

/** The API's CCTP batch into a chain, as LZ serves it. */
function burn(
  chainId: number,
  o: Parameters<typeof cctp>[0] = {},
): Batch | undefined {
  const served = lz(chainId).cctp
  if (!served) return undefined
  const feeless = served.feeless === true
  return {
    data: execute(cctp({ domain: served.domain, ...o }, feeless)),
    calls: feeless ? 4 : 5,
  }
}

/** Every batch the policy still admits into a chain. */
function admitted(chainId: number, to: Address): Batch[] {
  const out: Batch[] = []
  const cctpBatch = burn(chainId, { to })
  if (cctpBatch) out.push(cctpBatch)
  if (lz(chainId).stargateUsdc && !cctpReaches(chainId)) {
    out.push(taxi(chainId, to))
  }
  return out
}

/** The Stargate TAXI batch into a chain CCTP reaches, which it now refuses. */
const taxiIntoCctp = (chainId: number, to: Address): Batch[] =>
  lz(chainId).stargateUsdc && cctpReaches(chainId) ? [taxi(chainId, to)] : []

/** The Stargate BUS batch into a chain, which it refuses everywhere. */
function bus(chainId: number, to: Address): Hex[] {
  const eid = lz(chainId).stargateUsdc?.eid
  return eid === undefined ? [] : [execute(stargate('bus', { eid, to }))]
}

/**
 * The context with Stargate dropped from every leg CCTP reaches: the old
 * policy compiled from it decides each batch as the live one should.
 */
function withoutTaxiIntoCctp(ctx: SettlementContext): SettlementContext {
  const settlement: Record<number, SettlementCatalog[number]> = {}
  for (const [id, block] of Object.entries(ctx.settlement)) {
    const chainId = Number(id)
    if (chainId === ctx.chainId || !block.lz || !cctpReaches(chainId)) {
      settlement[chainId] = block
      continue
    }
    const { stargateUsdc: _, ...rest } = block.lz
    settlement[chainId] = { ...block, lz: rest }
  }
  return { ...ctx, settlement }
}

const PERMITS: Record<
  string,
  { ctx: Partial<SettlementContext>; to: number[]; recipient?: Address }
> = {
  'cctp, base -> arbitrum': {
    ctx: { destinations: legs([ARB]) },
    to: [ARB],
  },
  'cctp only, base -> unichain': {
    ctx: { destinations: legs([UNICHAIN]) },
    to: [UNICHAIN],
  },
  'feeless cctp, base -> plasma': {
    ctx: { destinations: legs([PLASMA]) },
    to: [PLASMA],
  },
  'stargate only, base -> soneium': {
    ctx: { destinations: legs([SONEIUM]) },
    to: [SONEIUM],
  },
  'cctp and feeless cctp, base -> arbitrum + plasma': {
    ctx: { destinations: legs([ARB, PLASMA]) },
    to: [ARB, PLASMA],
  },
  'all three layouts, base -> soneium + arbitrum + plasma': {
    ctx: { destinations: legs([SONEIUM, ARB, PLASMA]) },
    to: [SONEIUM, ARB, PLASMA],
  },
  'three destinations, base -> arbitrum + optimism + ethereum': {
    ctx: { destinations: legs([ARB, OP, ETH]) },
    to: [ARB, OP, ETH],
  },
  "recipient 'any', base -> soneium + arbitrum + plasma": {
    ctx: { destinations: legs([SONEIUM, ARB, PLASMA], true) },
    to: [SONEIUM, ARB, PLASMA],
    recipient: OTHER,
  },
  'uncapped, base -> soneium + arbitrum': {
    ctx: { destinations: legs([SONEIUM, ARB]), cap: undefined },
    to: [SONEIUM, ARB],
  },
}

const MAX = 2n ** 256n
const ATTACKER = BigInt(pad(OTHER))

/** The calldata with the 32 bytes at byte `at` replaced. */
function setWord(data: Hex, at: number, value: bigint): Hex {
  const word = toHex(value % MAX, { size: 32 }).slice(2)
  return `${data.slice(0, 2 + 2 * at)}${word}${data.slice(2 + 2 * (at + 32))}` as Hex
}

/**
 * Every single-word mutation: on the outer ABI grid and on the grid nested call
 * arguments sit on (4 bytes further), plus the selector.
 */
function* mutations(data: Hex): Generator<[string, Hex]> {
  yield ['selector', `0xdeadbeef${data.slice(10)}` as Hex]
  const length = size(data)
  for (const grid of [4, 8]) {
    for (let at = grid; at + 32 <= length; at += 32) {
      const word = BigInt(slice(data, at, at + 32))
      for (const [name, value] of [
        ['+1', word + 1n],
        ['0', 0n],
        ['attacker', ATTACKER],
        ['max', maxUint256],
      ] as const) {
        if (value % MAX === word) continue
        yield [`word @${at} ${name}`, setWord(data, at, value)]
      }
    }
  }
}

/** `execute`'s argument words, 32 bytes each (the last may be shorter). */
const words = (data: Hex): Hex[] => {
  const out: Hex[] = []
  for (let at = 4; at < size(data); at += 32) {
    out.push(slice(data, at, Math.min(at + 32, size(data))))
  }
  return out
}

/**
 * Seeded word splices of `a` with `b`: each word where they differ is taken
 * from `b` with even odds, so the hybrids mix two routes' pins.
 */
function* splices(a: Hex, b: Hex, count: number): Generator<Hex> {
  let seed = 1
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed / 2 ** 31
  }
  const wa = words(a)
  const wb = words(b)
  const differ = wa.flatMap((w, i) =>
    wb[i] !== undefined && wb[i] !== w && size(wb[i]) === size(w) ? [i] : [],
  )
  for (let n = 0; n < count; n++) {
    const ws = [...wa]
    for (const i of differ) if (random() < 0.5) ws[i] = wb[i]
    yield `${slice(a, 0, 4)}${ws.map((w) => w.slice(2)).join('')}` as Hex
  }
}

const rules = (e: ArgPolicyExpression): number =>
  e.type === 'rule'
    ? 1
    : e.type === 'not'
      ? rules(e.child)
      : rules(e.left) + rules(e.right)

const initData = (action: ScopedAction) =>
  encodeSessionPolicy(action.policies![0], 'production').initData as Hex

function measure(action: ScopedAction) {
  const policy = action.policies![0]
  const data = initData(action)
  return {
    rules: policy.type === 'arg-policy' ? rules(policy.expression) : 0,
    bytes: size(data),
    nonZeroWords: (data.slice(2).match(/.{1,64}/g) ?? []).filter((w) =>
      /[^0]/.test(w),
    ).length,
  }
}

/** The frozen policy's size and initData hash, or its rule count if too large. */
function frozen(action: ScopedAction) {
  try {
    return { ...measure(action), hash: keccak256(initData(action)) }
  } catch {
    const policy = action.policies![0]
    return {
      rules: policy.type === 'arg-policy' ? rules(policy.expression) : 0,
    }
  }
}

describe.each(Object.entries(PERMITS))(
  'LZ policy against its pre-RHI-8045 compilation: %s',
  (_, permit) => {
    const ctx = context(permit.ctx)
    const old = scopeLzV0(ctx)
    const current = scopeLz(ctx)
    // The old policy as it decides with no Stargate into legs CCTP reaches.
    const reference = scopeLzV0(withoutTaxiIntoCctp(ctx))
    const to = permit.recipient ?? ACCOUNT
    const valid = permit.to.flatMap((chainId) => admitted(chainId, to))
    const refusedTaxi = permit.to.flatMap((chainId) =>
      taxiIntoCctp(chainId, to),
    )
    const buses = permit.to.flatMap((chainId) => bus(chainId, to))

    /**
     * The live verdict: the reference's, and never looser than the old one,
     * except for a batch LZMultiCall reverts on-chain anyway.
     */
    const expectDecided = (data: Hex, name: string) => {
      const now = holds(current, data)
      const reverts = () => {
        try {
          return multiCallReverts(data, ACCOUNT)
        } catch {
          return false
        }
      }
      if (now && !(holds(reference, data) && holds(old, data))) {
        expect(reverts(), `widened: ${name}`).toBe(true)
      } else {
        expect(now, name).toBe(holds(reference, data))
      }
      return now
    }

    test('accepts every batch it still admits, as the old policy did', () => {
      expect(valid.length).toBeGreaterThan(0)
      for (const { data } of valid) {
        expect(holds(old, data)).toBe(true)
        expect(holds(current, data)).toBe(true)
      }
    })

    test.runIf(refusedTaxi.length > 0)(
      'refuses Stargate into a leg CCTP reaches, which the old policy accepted',
      () => {
        for (const { data } of refusedTaxi) {
          expect(holds(old, data)).toBe(true)
          expect(holds(current, data)).toBe(false)
        }
      },
    )

    test.runIf(buses.length > 0)(
      'refuses the BUS batch the old policy accepted',
      () => {
        for (const data of buses) {
          expect(holds(old, data)).toBe(true)
          expect(holds(current, data)).toBe(false)
        }
      },
    )

    test('decides every single-word mutation as before', () => {
      let refused = 0
      for (const { data } of valid) {
        for (const [name, mutated] of mutations(data)) {
          if (!expectDecided(mutated, name)) refused++
        }
      }
      // The pins bind: most mutations are refused, so the check is not vacuous.
      expect(refused).toBeGreaterThan(0)
    })

    // Batches into other legs too, so each layout has a same-length partner
    // whose pins it can borrow.
    const foreign = [
      taxi(SONEIUM, to),
      ...[ARB, OP, PLASMA].flatMap((chainId) => burn(chainId, { to }) ?? []),
    ]
    const pool = [...valid, ...refusedTaxi, ...foreign].filter(
      (batch, i, all) => all.findIndex((b) => b.data === batch.data) === i,
    )
    const pairs = pool.flatMap((a) =>
      pool.flatMap((b) => (a !== b && a.calls === b.calls ? [[a, b]] : [])),
    )
    test('decides every splice of two same-length batches as before', () => {
      let refused = 0
      for (const [a, b] of pairs) {
        let n = 0
        for (const spliced of splices(a.data, b.data, 200)) {
          if (!expectDecided(spliced, `splice ${n++}`)) refused++
        }
      }
      expect(refused).toBeGreaterThan(0)
    })

    test('decides every two-call sequence as before, counters shared', () => {
      const [first] = permit.to
      const over = [
        burn(first, { to, fee: 10_000_000n }),
        burn(first, { to, pull: 5n, fee: 2_000_000n }),
      ].flatMap((b) => (b ? [b] : []))
      const smallTaxi = lz(first).stargateUsdc
        ? [taxi(first, to, 1n)]
        : ([] as Batch[])
      const batches = [...valid, ...refusedTaxi, ...over, ...smallTaxi].map(
        (b) => b.data,
      )
      for (const a of batches) {
        for (const b of batches) {
          const now: RuleUsage = new Map()
          const ref: RuleUsage = new Map()
          const before: RuleUsage = new Map()
          // Once the old policy ran a call the live one refuses, their
          // counters part; until then the live one is never looser.
          let agreed = true
          for (const [step, data] of [a, b].entries()) {
            const verdict = holds(current, data, now)
            expect(verdict, `step ${step}`).toBe(holds(reference, data, ref))
            const was = holds(old, data, before)
            if (agreed && verdict) expect(was, `step ${step}`).toBe(true)
            agreed &&= was === verdict
          }
        }
      }
    })
  },
)

test('rule counts, initData and the frozen policy compile as pinned', () => {
  // A revert of the shared-pin factoring or of a route's narrowing moves the
  // live numbers; any change to the frozen copy's inputs moves its hash.
  const table = Object.fromEntries(
    Object.entries(PERMITS).map(([name, permit]) => {
      const ctx = context(permit.ctx)
      const old = scopeLzV0(ctx)
      return [name, { old: frozen(old), now: measure(scopeLz(ctx)) }]
    }),
  )
  expect(table).toMatchInlineSnapshot(`
    {
      "all three layouts, base -> soneium + arbitrum + plasma": {
        "now": {
          "bytes": 23520,
          "nonZeroWords": 375,
          "rules": 91,
        },
        "old": {
          "rules": 129,
        },
      },
      "cctp and feeless cctp, base -> arbitrum + plasma": {
        "now": {
          "bytes": 16864,
          "nonZeroWords": 272,
          "rules": 65,
        },
        "old": {
          "bytes": 32736,
          "hash": "0x7ecf7a58b84b223b79427b9f0ee31c91c97257969d2a992a254e06697bd1e0c7",
          "nonZeroWords": 505,
          "rules": 127,
        },
      },
      "cctp only, base -> unichain": {
        "now": {
          "bytes": 9440,
          "nonZeroWords": 155,
          "rules": 36,
        },
        "old": {
          "bytes": 11232,
          "hash": "0x09f51cbd6b6c0bed02a6843b16bfba22ea7a9e6afab344c98d0adb686bef92e7",
          "nonZeroWords": 178,
          "rules": 43,
        },
      },
      "cctp, base -> arbitrum": {
        "now": {
          "bytes": 9440,
          "nonZeroWords": 155,
          "rules": 36,
        },
        "old": {
          "bytes": 23776,
          "hash": "0x8f13ab97cea8150b61b9a555780205d77a0174af80341935e9f9598f53f02a09",
          "nonZeroWords": 368,
          "rules": 92,
        },
      },
      "feeless cctp, base -> plasma": {
        "now": {
          "bytes": 7904,
          "nonZeroWords": 128,
          "rules": 30,
        },
        "old": {
          "bytes": 9440,
          "hash": "0x8d49f2894f88ed4a6d1e472b9eb15cd23ac7b92d84deabd7d94440f7c291abf2",
          "nonZeroWords": 148,
          "rules": 36,
        },
      },
      "recipient 'any', base -> soneium + arbitrum + plasma": {
        "now": {
          "bytes": 22752,
          "nonZeroWords": 363,
          "rules": 88,
        },
        "old": {
          "bytes": 32224,
          "hash": "0xc260734cee7b7986e5e968f1a976022de391d6cccb86caa13fc7247b5f5544f8",
          "nonZeroWords": 497,
          "rules": 125,
        },
      },
      "stargate only, base -> soneium": {
        "now": {
          "bytes": 10208,
          "nonZeroWords": 162,
          "rules": 39,
        },
        "old": {
          "bytes": 13024,
          "hash": "0x51500e748c8a2af355e79f4c6928f8f9c1b8d2ac767efad567fbcb2d1add4d50",
          "nonZeroWords": 201,
          "rules": 50,
        },
      },
      "three destinations, base -> arbitrum + optimism + ethereum": {
        "now": {
          "bytes": 10464,
          "nonZeroWords": 170,
          "rules": 40,
        },
        "old": {
          "bytes": 25824,
          "hash": "0x1a584f3e2bbcfa8dfeb7d74077139a9b78a0f9edf6ff5f2b6f9cef6e918b39d6",
          "nonZeroWords": 399,
          "rules": 100,
        },
      },
      "uncapped, base -> soneium + arbitrum": {
        "now": {
          "bytes": 18656,
          "nonZeroWords": 292,
          "rules": 72,
        },
        "old": {
          "bytes": 23776,
          "hash": "0xf93ddc24687daeeb915550f4ba41e85881614eb4b5d896c378eb487d60c30ff1",
          "nonZeroWords": 362,
          "rules": 92,
        },
      },
    }
  `)
})
