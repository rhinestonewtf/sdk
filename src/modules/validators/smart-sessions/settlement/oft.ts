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
import type { SettlementContext } from './types'

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

/** EVM chains the USDT0 mesh routes between: its adapter, eid and token. */
export const OFT_CHAINS: Readonly<
  Record<
    number,
    { readonly adapter: Address; readonly eid: number; readonly token: Address }
  >
> = {
  1: {
    adapter: '0x6c96de32cea08842dcc4058c14d3aaad7fa41dee',
    eid: 30101,
    token: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  10: {
    adapter: '0xF03b4d9AC1D5d1E7c4cEf54C2A313b9fe051A0aD',
    eid: 30111,
    token: '0x01bFF41798a0BcF287b996046Ca68b395DbC1071',
  },
  130: {
    adapter: '0xc07bE8994D035631c36fb4a89C918CeFB2f03EC3',
    eid: 30320,
    token: '0x9151434b16b9763660705744891fA906F660EcC5',
  },
  137: {
    adapter: '0x6BA10300f0DC58B7a1e4c0e41f5daBb7D7829e13',
    eid: 30109,
    token: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
  196: {
    adapter: '0x94bcca6bdfd6a61817ab0e960bfede4984505554',
    eid: 30274,
    token: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
  },
  9745: {
    adapter: '0x02ca37966753bDdDf11216B73B16C1dE756A7CF9',
    eid: 30383,
    token: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
  },
  42161: {
    adapter: '0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92',
    eid: 30110,
    token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
  57073: {
    adapter: '0x1cB6De532588fCA4a21B7209DE7C456AF8434A65',
    eid: 30339,
    token: '0x0200C29006150606B650577BBE7B6248F58470c1',
  },
}

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

function oftChain(chainId: number) {
  const chain = OFT_CHAINS[chainId]
  if (chain === undefined) {
    throw new Error(`crossChainPermits: OFT does not route to chain ${chainId}`)
  }
  return chain
}

/** The mesh moves only USDT0, so any other token names a route it cannot take. */
function requireUsdt0(chainId: number, token: Address, leg: 'from' | 'to') {
  if (!isAddressEqual(token, oftChain(chainId).token)) {
    throw new Error(
      `crossChainPermits: OFT moves only USDT0; the \`${leg}\` token on chain ${chainId} is ${token}`,
    )
  }
}

export function oftAdapter(chainId: number): Address {
  return oftChain(chainId).adapter
}

/** The send call, pinned to the permit's destinations, refund and cap. */
export function scopeOft(ctx: SettlementContext): ScopedAction {
  if (ctx.sourceTokens.length !== 1) {
    throw new Error(
      'crossChainPermits: OFT sends one token (USDT0) per chain; give exactly one `from` token on this chain',
    )
  }
  requireUsdt0(ctx.chainId, ctx.sourceTokens[0], 'from')
  if (!ctx.account) {
    throw new Error(
      'crossChainPermits: OFT refunds its LayerZero fee to the account, so the session definition needs `account`',
    )
  }
  const rules: UniversalActionPolicyParamRule[] = [
    pinValue(SEND.sendParamPointer, 0x80n),
    pinValue(SEND.extraOptionsPointer, 0xe0n),
    pinValue(SEND.composeMsgPointer, 0x100n),
    pinValue(SEND.oftCmdPointer, 0x120n),
    pinValue(SEND.extraOptionsLength, 0n),
    pinValue(SEND.composeMsgLength, 0n),
    pinValue(SEND.oftCmdLength, 0n),
    // The fee is native only; any excess goes back to the refund address.
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
    requireUsdt0(leg.chainId, leg.token, 'to')
    const legRules = [pinValue(SEND.dstEid, BigInt(oftChain(leg.chainId).eid))]
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
