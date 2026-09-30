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
      swapper: { swapper: A, proxy: B },
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
        fees: { appFeeCollector: A, paymaster: B },
      }),
    })
    expect(parsed[8453].settlement).toEqual({
      lz: { multiCall: A, transferDelegate: B },
      fees: { appFeeCollector: A, paymaster: B },
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

describe('ChainCatalog.getSettlementCatalog', () => {
  test('keys served blocks by chain id and omits chains without one', () => {
    const catalog = new ChainCatalog(
      parse({
        'eip155:8453': chain({ swapper: { swapper: A, proxy: B } }),
        'eip155:10': chain(),
      }),
    )
    expect(catalog.getSettlementCatalog()).toEqual({
      8453: { swapper: { swapper: A, proxy: B } },
    })
  })
})
