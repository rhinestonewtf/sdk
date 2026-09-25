// The EVM transactions the sponsorship approval vectors are derived from.
//
// Kept to viem imports and plain data so the file can be copied unchanged into
// a checkout of the released v2 line, where the same transactions calibrate the
// EVM vectors: the approval input they produce there must equal the vector's.
// The non-EVM chain descriptors are injected because the two lines publish them
// from different entry points.
import { encodeFunctionData, erc20Abi, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, mainnet } from 'viem/chains'

export const owner = privateKeyToAccount(`0x${'a1'.repeat(32)}`)
export const eoaOwner = privateKeyToAccount(`0x${'a2'.repeat(32)}`)
const payee = '0x00000000000000000000000000000000000000b0'

const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const USDC_MAINNET = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const USDC_ARBITRUM = '0xaf88d065e77c8cc2239327c5edb3a432268e5831'
const WETH_MAINNET = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

const transfer = (to: Hex, amount: bigint) => ({
  to: USDC_BASE as Hex,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amount],
  }),
})

const nexus = {
  account: { type: 'nexus', version: '1.2.1' },
  owners: { type: 'ecdsa', accounts: [owner] },
} as const

// An existing account named by its address, so the request carries no factory
// call and the vector stays readable. One case keeps the undeployed shape.
const existing = {
  ...nexus,
  initData: { address: '0x00000000000000000000000000000000000000a0' },
} as const

export interface EvmVectorCase {
  readonly id: string
  /** The account's EVM configuration (the v2 account config). */
  readonly account: Record<string, unknown>
  /** Whether the account already has code, which drops its setup operations. */
  readonly deployed: boolean
  readonly transaction: Record<string, unknown>
}

export function evmCases(chains: {
  readonly solanaMainnet: unknown
  readonly tronMainnet: unknown
  readonly hyperCorePerp: unknown
}): readonly EvmVectorCase[] {
  return [
    {
      id: 'evm-same-chain-transfer',
      account: existing,
      deployed: true,
      transaction: {
        chain: base,
        calls: [transfer(payee, 1_000_000n)],
        tokenRequests: [{ address: USDC_BASE, amount: 1_000_000n }],
        sponsored: true,
      },
    },
    {
      id: 'evm-cross-chain-source-chains',
      account: existing,
      deployed: true,
      transaction: {
        sourceChains: [mainnet, arbitrum],
        targetChain: base,
        tokenRequests: [{ address: USDC_BASE, amount: 2_000_000n }],
        sponsored: { gas: true, bridging: true, swaps: false },
      },
    },
    {
      id: 'evm-source-chains-token-list',
      account: existing,
      deployed: true,
      transaction: {
        sourceChains: [mainnet, arbitrum],
        targetChain: base,
        sourceAssets: [USDC_MAINNET, USDC_ARBITRUM],
        tokenRequests: [{ address: USDC_BASE, amount: 2_000_000n }],
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
    {
      id: 'evm-source-assets-per-chain',
      account: existing,
      deployed: true,
      transaction: {
        sourceChains: [mainnet, arbitrum],
        targetChain: base,
        sourceAssets: {
          [mainnet.id]: [USDC_MAINNET, WETH_MAINNET],
          [arbitrum.id]: [USDC_ARBITRUM],
        },
        tokenRequests: [{ address: USDC_BASE, amount: 2_000_000n }],
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
    {
      id: 'evm-source-assets-capped',
      account: existing,
      deployed: true,
      transaction: {
        sourceChains: [mainnet],
        targetChain: base,
        sourceAssets: [
          { chain: mainnet, address: USDC_MAINNET, amount: 5_000_000n },
        ],
        tokenRequests: [{ address: USDC_BASE, amount: 2_000_000n }],
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
    {
      id: 'evm-source-assets-mixed',
      account: existing,
      deployed: true,
      transaction: {
        sourceChains: [mainnet, arbitrum],
        targetChain: base,
        sourceAssets: [
          { chain: mainnet, address: USDC_MAINNET },
          { chain: mainnet, address: WETH_MAINNET, amount: 10n ** 18n },
          { chain: arbitrum, address: USDC_ARBITRUM, amount: 3_000_000n },
        ],
        tokenRequests: [{ address: USDC_BASE, amount: 2_000_000n }],
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
    {
      id: 'evm-destination-calls-gas-limit',
      account: existing,
      deployed: true,
      transaction: {
        sourceChains: [mainnet],
        targetChain: base,
        calls: [transfer(payee, 1n), { to: payee, data: '0x', value: 7n }],
        gasLimit: 300_000n,
        tokenRequests: [{ address: USDC_BASE, amount: 1n }],
        sponsored: true,
      },
    },
    {
      id: 'evm-undeployed-erc7579',
      account: nexus,
      deployed: false,
      transaction: {
        sourceChains: [mainnet],
        targetChain: base,
        tokenRequests: [{ address: USDC_BASE, amount: 1_000_000n }],
        sponsored: true,
      },
    },
    {
      id: 'evm-eoa',
      account: { account: { type: 'eoa' }, eoa: eoaOwner },
      deployed: false,
      transaction: {
        sourceChains: [mainnet],
        targetChain: base,
        tokenRequests: [{ address: USDC_BASE, amount: 1_000_000n }],
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
    {
      id: 'evm-eip7702',
      account: { ...nexus, eoa: eoaOwner },
      deployed: false,
      transaction: {
        chain: base,
        calls: [{ to: payee, data: '0x' }],
        eip7702InitSignature: `0x${'22'.repeat(65)}`,
        sponsored: true,
      },
    },
    {
      id: 'evm-pre-claim-auxiliary-funds',
      account: existing,
      deployed: true,
      transaction: {
        sourceChains: [mainnet],
        targetChain: base,
        sourceCalls: {
          [mainnet.id]: [
            {
              to: payee,
              data: '0x1234',
              provides: [{ token: USDC_MAINNET, amount: 4_000_000n }],
            },
          ],
        },
        auxiliaryFunds: { [mainnet.id]: { [USDC_MAINNET]: 1_000_000n } },
        tokenRequests: [{ address: USDC_BASE, amount: 5_000_000n }],
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
    {
      id: 'evm-fees-deadline-venues',
      account: existing,
      deployed: true,
      transaction: {
        chain: base,
        calls: [transfer(payee, 1n)],
        appFees: { feeBps: 25 },
        protocolFees: { feeBps: 5 },
        customDeadline: 1_900_000_000,
        settlementLayers: { include: ['SAME_CHAIN'] },
        quoters: { exclude: ['ZEROX'] },
        sponsored: {
          gas: true,
          bridging: false,
          swaps: false,
          protocolFees: true,
        },
      },
    },
    {
      id: 'evm-explicit-recipient',
      account: existing,
      deployed: true,
      transaction: {
        sourceChains: [mainnet],
        targetChain: base,
        recipient: payee,
        tokenRequests: [{ address: USDC_BASE, amount: 1_000_000n }],
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
    {
      id: 'evm-smart-account-recipient',
      account: existing,
      deployed: true,
      transaction: {
        sourceChains: [mainnet],
        targetChain: base,
        recipient: {
          account: { type: 'nexus', version: '1.2.1' },
          owners: { type: 'ecdsa', accounts: [eoaOwner] },
          initData: { address: payee },
        },
        tokenRequests: [{ address: USDC_BASE, amount: 1_000_000n }],
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
    {
      id: 'evm-hypercore-action',
      account: existing,
      deployed: true,
      transaction: {
        sourceChains: [arbitrum],
        targetChain: chains.hyperCorePerp,
        tokenRequests: [
          {
            address: '0x2000000000000000000000000000000000000000',
            amount: 10_000_000n,
          },
        ],
        hyperCore: {
          action: {
            type: 'order',
            orders: [
              {
                a: 0,
                b: true,
                p: '65000',
                s: '0.001',
                r: false,
                t: { limit: { tif: 'Ioc' } },
              },
            ],
            grouping: 'na',
          },
        },
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
    {
      id: 'evm-to-solana',
      account: existing,
      deployed: true,
      transaction: {
        sourceChains: [base],
        targetChain: chains.solanaMainnet,
        recipient: 'DfBX7Po1bmnXt4GuEF3Eg5UYUHAjs9m5n8nbb9WUqgw2',
        tokenRequests: [
          {
            address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            amount: 1_000_000n,
          },
        ],
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
    {
      id: 'evm-to-tron',
      account: existing,
      deployed: true,
      transaction: {
        sourceChains: [base],
        targetChain: chains.tronMainnet,
        recipient: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
        tokenRequests: [
          {
            address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
            amount: 1_000_000n,
          },
        ],
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
  ]
}
