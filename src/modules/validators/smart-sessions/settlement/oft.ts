import {
  type Abi,
  type Address,
  isAddressEqual,
  maxUint256,
  pad,
  toFunctionSelector,
} from 'viem'
import {
  cumulativeCap,
  pin,
  pinValue,
  pinWord,
  swapAction,
} from '../swap/rules'
import type { ScopedAction, UniversalActionPolicyParamRule } from '../types'
import { SettlementLayerRefusal, served } from './served'
import type { SettlementCatalog, SettlementContext } from './types'

/**
 * OFT — USDT0 over LayerZero, `OFTAdapter.send` encoded by the orchestrator
 * with empty `extraOptions`, `composeMsg` and `oftCmd`.
 *
 * `send` takes a dynamic tuple, so its fields sit at fixed offsets only under
 * the canonical encoding. The head pointer, the three tail pointers and the
 * three tail lengths are pinned too: that fixes the layout, and the empty tails
 * rule out a LayerZero native drop (paid from the account's `msg.value`) or a
 * compose call on the destination.
 */

export const oftAbi = [
  {
    type: 'function',
    name: 'send',
    stateMutability: 'payable',
    inputs: [
      {
        name: '_sendParam',
        type: 'tuple',
        components: [
          { name: 'dstEid', type: 'uint32' },
          { name: 'to', type: 'bytes32' },
          { name: 'amountLD', type: 'uint256' },
          { name: 'minAmountLD', type: 'uint256' },
          { name: 'extraOptions', type: 'bytes' },
          { name: 'composeMsg', type: 'bytes' },
          { name: 'oftCmd', type: 'bytes' },
        ],
      },
      {
        name: '_fee',
        type: 'tuple',
        components: [
          { name: 'nativeFee', type: 'uint256' },
          { name: 'lzTokenFee', type: 'uint256' },
        ],
      },
      { name: '_refundAddress', type: 'address' },
    ],
    outputs: [],
  },
] as const satisfies Abi

export const OFT_SEND_SELECTOR = toFunctionSelector(oftAbi[0])

/** Offsets from the start of `send`'s args under the canonical encoding. */
export const SEND = {
  sendParamPointer: 0n,
  lzTokenFee: 64n,
  refundAddress: 96n,
  dstEid: 128n,
  to: 160n,
  amountLD: 192n,
  extraOptionsPointer: 256n,
  composeMsgPointer: 288n,
  oftCmdPointer: 320n,
  extraOptionsLength: 352n,
  composeMsgLength: 384n,
  oftCmdLength: 416n,
} as const

/** The mesh moves only USDT0, so any other token names a route it cannot take. */
function requireUsdt0(
  settlement: SettlementCatalog,
  chainId: number,
  token: Address,
  leg: 'from' | 'to',
) {
  if (!isAddressEqual(token, served(settlement, chainId, 'oft').token)) {
    throw new SettlementLayerRefusal(
      `crossChainPermits: OFT moves only USDT0; the \`${leg}\` token on chain ${chainId} is ${token}`,
    )
  }
}

/** The send call, pinned to the permit's destinations, refund and cap. */
export function scopeOft(ctx: SettlementContext): ScopedAction {
  if (ctx.sourceTokens.length !== 1) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: OFT sends one token (USDT0) per chain; give exactly one `from` token on this chain',
    )
  }
  requireUsdt0(ctx.settlement, ctx.chainId, ctx.sourceTokens[0], 'from')
  if (!ctx.account) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: OFT refunds its LayerZero fee to the account, so the session definition needs `account`',
    )
  }
  const rules: UniversalActionPolicyParamRule[] = [
    // Counts its own value against a limit of that value: one send per session.
    // The burning transaction admits every later op, and each send costs a
    // native fee no pin bounds.
    { ...pinValue(SEND.sendParamPointer, 0x80n), usageLimit: 0x80n },
    pinValue(SEND.extraOptionsPointer, 0xe0n),
    pinValue(SEND.composeMsgPointer, 0x100n),
    pinValue(SEND.oftCmdPointer, 0x120n),
    pinValue(SEND.extraOptionsLength, 0n),
    pinValue(SEND.composeMsgLength, 0n),
    pinValue(SEND.oftCmdLength, 0n),
    // The fee is native only.
    pinValue(SEND.lzTokenFee, 0n),
    pin(SEND.refundAddress, ctx.account),
    // A zero-amount send still costs the account the full LayerZero fee.
    {
      condition: 'greaterThan',
      calldataOffset: SEND.amountLD,
      referenceValue: 0n,
    },
  ]
  if (ctx.cap !== undefined) rules.push(cumulativeCap(SEND.amountLD, ctx.cap))
  const legs = ctx.destinations.map((leg) => {
    requireUsdt0(ctx.settlement, leg.chainId, leg.token, 'to')
    const legRules = [
      pinValue(
        SEND.dstEid,
        BigInt(served(ctx.settlement, leg.chainId, 'oft').eid),
      ),
    ]
    if (leg.recipient !== undefined) {
      legRules.push(pinWord(SEND.to, pad(leg.recipient)))
    }
    return legRules
  })
  // `msg.value` carries the LayerZero fee, whose size the session cannot know;
  // the refund pin returns any overpayment to the account.
  const action =
    legs.length === 1
      ? swapAction(
          ctx.target,
          OFT_SEND_SELECTOR,
          [...rules, ...legs[0]],
          [],
          maxUint256,
        )
      : swapAction(ctx.target, OFT_SEND_SELECTOR, rules, legs, maxUint256)
  return { ...action, policies: [...(action.policies ?? []), ...ctx.timeFrame] }
}
