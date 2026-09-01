import type { Abi, Address, Chain } from 'viem'
import { base, optimism, plasma } from 'viem/chains'
import type { OwnerSet, SessionDefinition } from '../../src/index'
import { fynd, toSession, zeroEx } from '../../src/smart-sessions'
import { accountA } from '../consts'

const USDT0: Address = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb'
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const ACCOUNT: Address = '0x1111111111111111111111111111111111111111'
const SETTLER: Address = '0x7F2194E8d4D5B5F889b17aeCe891F89Da74F5384'

const owners: OwnerSet = { type: 'ecdsa', accounts: [accountA] }

type SwapOn<TChain extends Chain> = NonNullable<
  SessionDefinition<readonly Abi[], TChain>['swap']
>

/** Build a swap session on a fixed chain, so each case is one readable line. */
function swapSession<const TChain extends Chain>(chain: TChain) {
  return (swap: SwapOn<TChain>) => toSession({ chain, owners, swap })
}

/** Vary only `via`, holding a valid scope constant. */
function venuesOn<const TChain extends Chain>(chain: TChain) {
  return (via: SwapOn<TChain>['via']) =>
    swapSession(chain)({
      sell: { token: USDT0, maxTotal: 1_000_000n },
      buy: { token: USDC },
      to: ACCOUNT,
      via,
    } as SwapOn<TChain>)
}

const onPlasma = swapSession(plasma)
const plasmaVenues = venuesOn(plasma)
const optimismVenues = venuesOn(optimism)
const baseVenues = venuesOn(base)

// --- Venues are narrowed by the session's chain -----------------------------

plasmaVenues([fynd(), zeroEx({ settler: SETTLER })])
baseVenues([fynd()])
optimismVenues([zeroEx({ settler: SETTLER })])

// @ts-expect-error fynd has no TychoRouter on Optimism — 0x only there.
optimismVenues([fynd()])

// --- The 0x settler options are exclusive, and neither is optional ----------

// @ts-expect-error zeroEx needs either a pinned settler or anySettler.
plasmaVenues([zeroEx({})])

// @ts-expect-error anySettler drops the pin, so maxSpend is mandatory.
plasmaVenues([zeroEx({ anySettler: true })])

// @ts-expect-error a pinned settler and anySettler are mutually exclusive.
plasmaVenues([zeroEx({ settler: SETTLER, anySettler: true, maxSpend: 1n })])

// @ts-expect-error venues come from the builders, not raw router addresses.
plasmaVenues(['0x8f9b3b0451efff0ae8100428aee35fa3cbc0b769'])

plasmaVenues([zeroEx({ anySettler: true, maxSpend: 1_000_000n })])

// --- Scope field typing -----------------------------------------------------

const sell = { token: USDT0, maxTotal: 1_000_000n }
const buy = { token: USDC }

onPlasma({ sell, buy, to: ACCOUNT, via: [fynd()] })

// maxTotal is optional when every venue pins its callee.
onPlasma({ sell: { token: USDT0 }, buy, to: ACCOUNT, via: [fynd()] })

onPlasma({
  // @ts-expect-error maxTotal is a token amount, not a number.
  sell: { token: USDT0, maxTotal: 1000 },
  buy,
  to: ACCOUNT,
  via: [fynd()],
})

// @ts-expect-error the swap output recipient is required.
onPlasma({ sell, buy, via: [fynd()] })

// @ts-expect-error a swap scope must name a buy token.
onPlasma({ sell, to: ACCOUNT, via: [fynd()] })

// @ts-expect-error a swap scope must name a sell token.
onPlasma({ buy, to: ACCOUNT, via: [fynd()] })
