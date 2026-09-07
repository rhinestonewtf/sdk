import { base, hyperEvm } from 'viem/chains'
import type { WireQuoteRequest } from '../../src/clients/orchestrator/wire'
import type { PerpMarket, PerpPosition } from '../../src/hypercore/index'
import { getPerpMarkets, getPerpPosition } from '../../src/hypercore/index'
import type {
  HyperCoreAction,
  RhinestoneAccountConfig,
  Transaction,
} from '../../src/index'
import { hyperCorePerp, RhinestoneSDK } from '../../src/index'

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

// Open: declarative, and the collateral rides the same transaction.
const openTransaction: Transaction = {
  sourceChains: [base],
  targetChain: hyperCorePerp,
  tokenRequests: [
    {
      address: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
      amount: 25000000n,
    },
  ],
  hyperCore: {
    openPerp: { asset: 'BTC', direction: 'long', notionalUsd: 100 },
  },
}

// Close: no tokens, no account address — `prepareTransaction` knows both. It
// still names a source chain, since HyperCore hosts no account of its own.
const closeTransaction: Transaction = {
  sourceChains: [hyperEvm],
  targetChain: hyperCorePerp,
  hyperCore: { closePerp: { asset: 'BTC' } },
}

// The escape hatch, for the action types the two above do not cover.
const rawTransaction: Transaction = {
  sourceChains: [hyperEvm],
  targetChain: hyperCorePerp,
  hyperCore: {
    action: { type: 'updateLeverage', asset: 0, isCross: true, leverage: 5 },
  },
}

// Exactly one of the three, never two.
const bothForms: Transaction = {
  sourceChains: [hyperEvm],
  targetChain: hyperCorePerp,
  hyperCore: {
    openPerp: { asset: 'BTC', direction: 'long', notionalUsd: 100 },
    // @ts-expect-error — `openPerp`, `closePerp` and `action` are exclusive
    closePerp: { asset: 'BTC' },
  },
}

// Sizing an open is one or the other, never both and never neither.
const bothSizes: Transaction = {
  sourceChains: [base],
  targetChain: hyperCorePerp,
  hyperCore: {
    openPerp: {
      asset: 'BTC',
      direction: 'long',
      notionalUsd: 100,
      // @ts-expect-error — `notionalUsd` and `size` are mutually exclusive
      size: '0.001',
    },
  },
}

const noSize: Transaction = {
  sourceChains: [base],
  targetChain: hyperCorePerp,
  hyperCore: {
    // @ts-expect-error — one of `notionalUsd` or `size` is required
    openPerp: { asset: 'BTC', direction: 'long' },
  },
}

// Where the reads reach Hyperliquid is SDK config, not a per-call argument.
const configured: RhinestoneAccountConfig & { hyperliquid?: unknown } = {
  account: { type: 'nexus', version: '1.2.0' },
  owners: { type: 'ecdsa', accounts: [] },
}
const sdk = new RhinestoneSDK({
  apiKey: 'test',
  hyperliquid: { apiUrl: 'https://api.hyperliquid-testnet.xyz' },
})

// The reads stay reachable for what they are actually for.
const markets: Promise<PerpMarket[]> = getPerpMarkets()
const position: Promise<PerpPosition | null> = getPerpPosition(account, 'BTC')

void actionMatchesWire
void openTransaction
void closeTransaction
void rawTransaction
void bothForms
void bothSizes
void noSize
void configured
void sdk
void markets
void position
