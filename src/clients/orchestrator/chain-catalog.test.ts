import { describe, expect, test } from 'vitest'
import { ChainCatalog, parseChains } from './chain-catalog'
import type { WireChainsResponse } from './wire'

const A = '0x1111111111111111111111111111111111111111'
const B = '0x2222222222222222222222222222222222222222'

const chain = (settlement?: unknown) => ({
  name: 'Base',
  testnet: false,
  supportedTokens: [],
  ...(settlement === undefined ? {} : { settlement }),
})

const parse = (entries: Record<string, unknown>) =>
  parseChains(entries as unknown as WireChainsResponse)

describe('parseChains settlement', () => {
  test('keeps a well-formed block', () => {
    const settlement = {
      cctp: { domain: 6, tokenMessenger: A, usdc: B },
      oft: { adapter: A, eid: 30184, token: B },
      eco: { portal: A, provers: [A, B], stablecoins: [B] },
      lz: {
        multiCall: A,
        transferDelegate: B,
        stargateUsdc: { pool: A, token: B, eid: 30184 },
        cctp: { domain: 6, token: B, feeReceiver: A, feeless: true },
      },
      fees: { appFeeCollector: A, paymaster: B },
    }
    expect(
      parse({ 'eip155:8453': chain(settlement) })[8453].settlement,
    ).toEqual(settlement)
  })

  test('drops each malformed block and keeps the rest', () => {
    const parsed = parse({
      'eip155:8453': chain({
        cctp: { domain: 6, tokenMessenger: 'nope', usdc: B },
        oft: { adapter: A, eid: -1, token: B },
        eco: { portal: A, provers: [], stablecoins: [B] },
        lz: {
          multiCall: A,
          transferDelegate: B,
          stargateUsdc: { pool: A, token: B },
          cctp: { domain: '6', token: B, feeReceiver: A },
        },
        swapper: { swapper: A, proxy: B },
        fees: { appFeeCollector: A, paymaster: 'nope' },
      }),
    })
    // swapper is not a layer block the SDK reads, so it is not kept either.
    expect(parsed[8453].settlement).toEqual({
      lz: { multiCall: A, transferDelegate: B },
    })
  })

  test('only a literal true marks an LZ CCTP destination feeless', () => {
    const parsed = parse({
      'eip155:8453': chain({
        lz: {
          multiCall: A,
          transferDelegate: B,
          cctp: { domain: 6, token: B, feeReceiver: A, feeless: 'true' },
        },
      }),
    })
    expect(parsed[8453].settlement?.lz?.cctp).toEqual({
      domain: 6,
      token: B,
      feeReceiver: A,
    })
  })

  test.each([
    ['absent', undefined],
    ['not an object', 'x'],
    ['all blocks malformed', { cctp: { domain: 6 } }],
  ])('omits settlement when %s', (_, settlement) => {
    const parsed = parse({ 'eip155:8453': chain(settlement) })
    expect(parsed[8453]).toBeDefined()
    expect('settlement' in parsed[8453]).toBe(false)
  })
})

test('drops a mixed-case address with a bad checksum, keeps lowercase', () => {
  const usdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
  const badChecksum = '0x833589FCD6eDb6E08f4c7C32D4f71b54bdA02913'
  const oft = (token: string) => ({ adapter: A, eid: 30184, token })
  const parsed = parse({
    'eip155:8453': chain({ oft: oft(badChecksum) }),
    'eip155:10': chain({ oft: oft(usdc.toLowerCase()) }),
    'eip155:1': chain({ oft: oft(usdc) }),
  })
  expect(parsed[8453].settlement).toBeUndefined()
  expect(parsed[10].settlement?.oft?.token).toBe(usdc.toLowerCase())
  expect(parsed[1].settlement?.oft?.token).toBe(usdc)
})

test('drops a fees block with a bad checksum or a missing address', () => {
  const good = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
  const badChecksum = '0x833589FCD6eDb6E08f4c7C32D4f71b54bdA02913'
  const parsed = parse({
    'eip155:8453': chain({
      fees: { appFeeCollector: badChecksum, paymaster: A },
    }),
    'eip155:10': chain({ fees: { appFeeCollector: A } }),
    'eip155:1': chain({ fees: { appFeeCollector: good, paymaster: A } }),
  })
  expect(parsed[8453].settlement).toBeUndefined()
  expect(parsed[10].settlement).toBeUndefined()
  expect(parsed[1].settlement).toEqual({
    fees: { appFeeCollector: good, paymaster: A },
  })
})

describe('ChainCatalog.getSettlementCatalog', () => {
  test('keys served blocks by chain id and omits chains without one', () => {
    const catalog = new ChainCatalog(
      parse({
        'eip155:8453': chain({ oft: { adapter: A, eid: 30184, token: B } }),
        'eip155:10': chain(),
      }),
    )
    expect(catalog.getSettlementCatalog()).toEqual({
      8453: { oft: { adapter: A, eid: 30184, token: B } },
    })
  })
})
