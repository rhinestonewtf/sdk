import {
  type Address,
  type Hex,
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
  cctp,
  context,
  execute,
  lz,
  OTHER,
  PLASMA,
  stargate,
} from '../../../../../test/utils/lz-calldata'
import { scopeLzV0 } from '../../../../../test/utils/lz-scope-v0'
import { satisfiesRules as holds } from '../../../../../test/utils/policy-rules'
import { encodeSessionPolicy } from '../policies/encode'
import type { ScopedAction } from '../types'
import { scopeLz } from './lz'
import type { SettlementContext } from './types'

const OP = 10
const ETH = 1
const UNICHAIN = 130
const USDC_UNICHAIN = '0x078D782b760474a361dDA0AF3839290b0EF57AD6' as Address
const USDC_PLASMA = '0x2d661C89D812261039AF9764eceaAee884f5F67F' as Address

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

/** Every batch the API can quote into a chain, as LZ serves it. */
function batches(chainId: number, to: Address): Hex[] {
  const served = lz(chainId)
  const out: Hex[] = []
  if (served.stargateUsdc) {
    const eid = served.stargateUsdc.eid
    out.push(execute(stargate('taxi', { eid, to })))
    out.push(execute(stargate('bus', { eid, to })))
  }
  if (served.cctp) {
    const feeless = served.cctp.feeless === true
    out.push(execute(cctp({ domain: served.cctp.domain, to }, feeless)))
  }
  return out
}

const PERMITS: Record<
  string,
  { ctx: Partial<SettlementContext>; to: number[]; recipient?: Address }
> = {
  'stargate + cctp, base -> arbitrum': {
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
  'all three layouts, base -> arbitrum + plasma': {
    ctx: { destinations: legs([ARB, PLASMA]) },
    to: [ARB, PLASMA],
  },
  'three destinations, base -> arbitrum + optimism + ethereum': {
    ctx: { destinations: legs([ARB, OP, ETH]) },
    to: [ARB, OP, ETH],
  },
  "recipient 'any', base -> arbitrum + plasma": {
    ctx: { destinations: legs([ARB, PLASMA], true) },
    to: [ARB, PLASMA],
    recipient: OTHER,
  },
  'uncapped, base -> arbitrum': {
    ctx: { destinations: legs([ARB]), cap: undefined },
    to: [ARB],
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

const initDataSize = (action: ScopedAction) =>
  size(encodeSessionPolicy(action.policies![0], 'production').initData)

describe.each(Object.entries(PERMITS))(
  'LZ policy against its pre-RHI-8045 compilation: %s',
  (_, permit) => {
    const ctx = context(permit.ctx)
    const old = scopeLzV0(ctx)
    const current = scopeLz(ctx)
    const valid = permit.to.flatMap((chainId) =>
      batches(chainId, permit.recipient ?? ACCOUNT),
    )

    test('accepts every batch the old policy accepted', () => {
      expect(valid.length).toBeGreaterThan(0)
      for (const data of valid) {
        expect(holds(old, data)).toBe(true)
        expect(holds(current, data)).toBe(true)
      }
    })

    test('decides every single-word mutation the way the old policy did', () => {
      let refused = 0
      for (const data of valid) {
        for (const [name, mutated] of mutations(data)) {
          const before = holds(old, mutated)
          if (!before) refused++
          expect(holds(current, mutated), name).toBe(before)
        }
      }
      // The pins bind: most mutations are refused, so the check is not vacuous.
      expect(refused).toBeGreaterThan(0)
    })

    test('compiles to no more initData than before', () => {
      expect(initDataSize(current)).toBeLessThanOrEqual(initDataSize(old))
    })
  },
)
