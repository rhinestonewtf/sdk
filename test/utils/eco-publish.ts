import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  pad,
} from 'viem'
import { ecoPortalAbi } from '../../src/modules/validators/smart-sessions/settlement/eco'
import { SETTLEMENT_CATALOG } from './settlement-catalog'

export const ECO_PORTAL = SETTLEMENT_CATALOG[8453].eco!.portal
export const ECO_ACCOUNT =
  '0x1111111111111111111111111111111111111111' as Address
export const HYPER_PROVER =
  '0xec004Ab4870c4e177c66949329dCdb503CE41022' as Address
const USDC_BASE = SETTLEMENT_CATALOG[8453].eco!.stablecoins[0]
const USDC_ARB = SETTLEMENT_CATALOG[42161].eco!.stablecoins[0]

/** Eco's `Route`, which the destination re-encodes to recompute the intent hash. */
export const routeAbi = [
  {
    type: 'tuple',
    components: [
      { name: 'salt', type: 'bytes32' },
      { name: 'deadline', type: 'uint64' },
      { name: 'portal', type: 'address' },
      { name: 'nativeAmount', type: 'uint256' },
      {
        name: 'tokens',
        type: 'tuple[]',
        components: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'data', type: 'bytes' },
          { name: 'value', type: 'uint256' },
        ],
      },
    ],
  },
] as const

export type PublishOverrides = Partial<{
  destination: bigint
  portal: Address
  routeNative: bigint
  routeDeadline: bigint
  routeToken: Address
  delivered: bigint
  recipient: Address
  callTarget: Address
  callData: Hex
  extraCall: boolean
  extraToken: boolean
  prover: Address
  creator: Address
  rewardToken: Address
  reward: bigint
  rewardNative: bigint
  deadline: bigint
  allowPartial: boolean
}>

/** A publishAndFund call shaped exactly as the orchestrator forwards Eco's. */
export function publish(o: PublishOverrides = {}): Hex {
  const delivered = o.delivered ?? 99n
  const token = o.routeToken ?? USDC_ARB
  const call = {
    target: o.callTarget ?? token,
    data:
      o.callData ??
      encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [o.recipient ?? ECO_ACCOUNT, delivered],
      }),
    value: 0n,
  }
  const route = encodeAbiParameters(routeAbi, [
    {
      salt: pad('0x42'),
      deadline: o.routeDeadline ?? 1_900_000_000n,
      portal: o.portal ?? ECO_PORTAL,
      nativeAmount: o.routeNative ?? 0n,
      tokens: o.extraToken
        ? [
            { token, amount: delivered },
            { token, amount: delivered },
          ]
        : [{ token, amount: delivered }],
      calls: o.extraCall ? [call, call] : [call],
    },
  ])
  return encodeFunctionData({
    abi: ecoPortalAbi,
    functionName: 'publishAndFund',
    args: [
      o.destination ?? 42161n,
      route,
      {
        deadline: o.deadline ?? 1_900_000_000n,
        creator: o.creator ?? ECO_ACCOUNT,
        prover: o.prover ?? HYPER_PROVER,
        nativeAmount: o.rewardNative ?? 0n,
        tokens: [
          { token: o.rewardToken ?? USDC_BASE, amount: o.reward ?? 100n },
        ],
      },
      o.allowPartial ?? false,
    ],
  })
}
