import { type Address, encodeFunctionData, type Hex, pad, parseAbi } from 'viem'
import type { SettlementContext } from '../../src/modules/validators/smart-sessions/settlement/types'
import { SETTLEMENT_CATALOG } from './settlement-catalog'

/** LZ Value Transfer API batches, as the API quotes them, for the LZ policy tests. */

export const abi = parseAbi([
  'function execute((address target,uint256 value,bytes data)[] calls, bytes32 quoteId)',
  'function delegateTransferFrom(address token,address from,address to,uint256 amount)',
  'function approve(address spender,uint256 amount)',
  'function transfer(address to,uint256 amount)',
  'function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd) sendParam,(uint256 nativeFee,uint256 lzTokenFee) fee,address refundAddress)',
  'function depositForBurn(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold)',
  'function sweep(address[] tokens,address recipient)',
])

export const ACCOUNT = '0x7a3f5c2e9b1d4e8f6a0c3b5d7e9f1a2b4c6d8e0f' as Address
export const OTHER = '0x2222222222222222222222222222222222222222' as Address
export const BASE = 8453
export const ARB = 42161
export const PLASMA = 9745
/** Stargate's only destination LZ serves without a CCTP route. */
export const SONEIUM = 1868
export const lz = (chainId: number) => SETTLEMENT_CATALOG[chainId].lz!
export const USDC_BASE = lz(BASE).stargateUsdc!.token
export const USDC_ARB = lz(ARB).stargateUsdc!.token
export const USDC_PLASMA =
  '0x2d661C89D812261039AF9764eceaAee884f5F67F' as Address
export const USDC_SONEIUM = lz(SONEIUM).stargateUsdc!.token
export const SONEIUM_EID = lz(SONEIUM).stargateUsdc!.eid
export const MC = lz(BASE).multiCall
export const TD = lz(BASE).transferDelegate
export const POOL = lz(BASE).stargateUsdc!.pool
export const FEE_RECEIVER = lz(BASE).cctp!.feeReceiver
export const TOKEN_MESSENGER =
  '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' as Address
export const QUOTE_ID =
  `0x${'00'.repeat(16)}01a0efa5cb93751ca4a9d25a2a4d407c` as Hex
export const CAP = 10_000_000n

export type Call = { target: Address; value: bigint; data: Hex }
export const call = (target: Address, data: Hex, value = 0n): Call => ({
  target,
  value,
  data,
})
export const fn = (functionName: string, args: readonly unknown[]) =>
  encodeFunctionData({ abi, functionName, args } as never)
export const execute = (calls: Call[], quoteId = QUOTE_ID) =>
  fn('execute', [calls, quoteId])

/** The API's Stargate calls, as quoted for base -> arbitrum (10 USDC, taxi). */
export function stargate(
  mode: 'taxi' | 'bus',
  o: Partial<{ eid: number; to: Address; amount: bigint }> = {},
): Call[] {
  const amount = o.amount ?? CAP
  return [
    call(TD, fn('delegateTransferFrom', [USDC_BASE, ACCOUNT, MC, amount])),
    call(USDC_BASE, fn('approve', [POOL, amount])),
    call(
      POOL,
      fn('send', [
        {
          dstEid: o.eid ?? 30110,
          to: pad(o.to ?? ACCOUNT),
          amountLD: amount,
          minAmountLD: 9_899_009n,
          extraOptions: mode === 'taxi' ? '0x0003' : '0x',
          composeMsg: '0x',
          oftCmd: mode === 'taxi' ? '0x' : '0x01',
        },
        { nativeFee: 110_176_109_085_186n, lzTokenFee: 0n },
        MC,
      ]),
      110_176_109_085_186n,
    ),
    call(MC, fn('sweep', [[USDC_BASE, `0x${'00'.repeat(20)}`], ACCOUNT])),
  ]
}

/** The API's CCTP calls; to Plasma it charges no relay fee. */
export function cctp(
  o: Partial<{
    domain: number
    to: Address
    fee: bigint
    pull: bigint
    receiver: Address
  }> = {},
  feeless = false,
): Call[] {
  const pull = o.pull ?? CAP
  const fee = o.fee ?? 14_061n
  const burned = feeless || fee >= pull ? pull : pull - fee
  return [
    call(TD, fn('delegateTransferFrom', [USDC_BASE, ACCOUNT, MC, pull])),
    ...(feeless
      ? []
      : [call(USDC_BASE, fn('transfer', [o.receiver ?? FEE_RECEIVER, fee]))]),
    call(USDC_BASE, fn('approve', [TOKEN_MESSENGER, burned])),
    call(
      TOKEN_MESSENGER,
      fn('depositForBurn', [
        burned,
        o.domain ?? (feeless ? 33 : 3),
        pad(o.to ?? ACCOUNT),
        USDC_BASE,
        pad('0x00'),
        1299n,
        1000,
      ]),
    ),
    call(MC, fn('sweep', [[USDC_BASE, `0x${'00'.repeat(20)}`], ACCOUNT])),
  ]
}

export function context(
  overrides: Partial<SettlementContext> = {},
): SettlementContext {
  return {
    chainId: BASE,
    settlement: SETTLEMENT_CATALOG,
    target: MC,
    account: ACCOUNT,
    sourceTokens: [USDC_BASE],
    destinations: [{ chainId: ARB, token: USDC_ARB, recipient: ACCOUNT }],
    cap: CAP,
    timeFrame: [],
    ...overrides,
  }
}
