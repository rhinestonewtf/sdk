import { base, hyperEvm } from 'viem/chains'
import type { WireQuoteRequest } from '../../src/clients/orchestrator/wire'
import type { PerpMarket, PerpPosition } from '../../src/hypercore/index'
import {
  closePerp,
  getPerpMarkets,
  getPerpPosition,
  openPerp,
} from '../../src/hypercore/index'
import type {
  HyperCoreAction,
  HyperCoreOrderAction,
  Transaction,
} from '../../src/index'
import { hyperCorePerp } from '../../src/index'

type AssignableTo<Narrow, Wide> = [Narrow] extends [Wide] ? true : never

type WireHyperCoreAction = NonNullable<
  NonNullable<WireQuoteRequest['options']>['hyperCore']
>['action']

// `HyperCoreAction` is hand-written for its documentation and its `Hex`/`Address`
// field types, so nothing makes it track the generated wire shape except this.
// It catches the drift that matters — a field the orchestrator now requires, or
// an enum it has narrowed — because either makes ours stop assigning. It does
// not catch the wire growing a value we simply do not offer yet.
const actionMatchesWire: AssignableTo<HyperCoreAction, WireHyperCoreAction> =
  true

const account = '0x1111111111111111111111111111111111111111' as const

// One await, and the asset is named once — there is no market or position
// object for a caller to fetch, hold, or pair with the wrong asset.
const opened: Promise<HyperCoreOrderAction> = openPerp({
  asset: 'BTC',
  direction: 'long',
  notionalUsd: 100,
})

const closed: Promise<HyperCoreOrderAction> = closePerp({
  asset: 'BTC',
  account,
})

// Sizing an open is one or the other, never both and never neither.
// @ts-expect-error — `notionalUsd` and `size` are mutually exclusive
openPerp({ asset: 'BTC', direction: 'long', notionalUsd: 100, size: '0.001' })
// @ts-expect-error — one of them is required
openPerp({ asset: 'BTC', direction: 'long' })

// The reads are still reachable for what they are actually for.
const markets: Promise<PerpMarket[]> = getPerpMarkets()
const position: Promise<PerpPosition | null> = getPerpPosition(account, 'BTC')

// An action that delivers its own collateral.
const openTransaction: Transaction = {
  sourceChains: [base],
  targetChain: hyperCorePerp,
  tokenRequests: [
    {
      address: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
      amount: 25000000n,
    },
  ],
  hyperCore: { action: await opened },
}

// A close needs none, so it rides a transaction that requests no tokens — but
// still names a source chain, since HyperCore hosts no account of its own.
const closeTransaction: Transaction = {
  sourceChains: [hyperEvm],
  targetChain: hyperCorePerp,
  hyperCore: { action: await closed },
}

// Every action variant is expressible without the builders, and the `type`
// discriminant narrows to exactly one of them.
const rawActions: HyperCoreAction[] = [
  {
    type: 'order',
    orders: [
      {
        a: 0,
        b: true,
        p: '64572',
        s: '0.00155',
        r: false,
        t: { limit: { tif: 'Ioc' } },
        c: '0x1234567890abcdef1234567890abcdef',
      },
    ],
    grouping: 'na',
    builder: { b: '0x0000000000000000000000000000000000000002', f: 10 },
  },
  { type: 'cancel', cancels: [{ a: 0, o: 1 }] },
  {
    type: 'cancelByCloid',
    cancels: [{ asset: 0, cloid: '0x1234567890abcdef1234567890abcdef' }],
  },
  {
    type: 'modify',
    oid: 1,
    order: {
      a: 0,
      b: false,
      p: '64000',
      s: '0.001',
      r: true,
      t: { trigger: { isMarket: true, triggerPx: '63000', tpsl: 'sl' } },
    },
    a: true,
  },
  {
    type: 'batchModify',
    modifies: [
      {
        oid: '0x1234567890abcdef1234567890abcdef',
        order: {
          a: 0,
          b: true,
          p: '64000',
          s: '0.001',
          r: false,
          t: { limit: { tif: 'Gtc' } },
        },
      },
    ],
  },
  { type: 'updateLeverage', asset: 0, isCross: true, leverage: 5 },
  { type: 'updateIsolatedMargin', asset: 0, isBuy: true, ntli: 1000000 },
]

const noFalseAdditionalFlag: HyperCoreAction = {
  type: 'modify',
  oid: 1,
  order: {
    a: 0,
    b: true,
    p: '64000',
    s: '0.001',
    r: false,
    t: { limit: { tif: 'Ioc' } },
  },
  // @ts-expect-error — `a: false` is not a legal value; omit it for the default
  a: false,
}

void actionMatchesWire
void openTransaction
void markets
void position
void closeTransaction
void rawActions
void noFalseAdditionalFlag
