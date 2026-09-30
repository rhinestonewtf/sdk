// The EVM transactions the singular sponsorship approval vectors are derived
// from, prepared through the public facade. Plain data plus viem chains, so
// each case reads as the transaction an integrator writes.
import { encodeFunctionData, erc20Abi, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, mainnet } from 'viem/chains'

export const owner = privateKeyToAccount(`0x${'a1'.repeat(32)}`)
export const eoaOwner = privateKeyToAccount(`0x${'a2'.repeat(32)}`)
const payee = '0x00000000000000000000000000000000000000b0'

const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const USDC_MAINNET = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const USDC_ARBITRUM = '0xaf88d065e77c8cc2239327c5edb3a432268e5831'

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
// call and the vector stays readable. The undeployed cases keep the factory.
const existing = {
  ...nexus,
  initData: { address: '0x00000000000000000000000000000000000000a0' },
} as const

export interface EvmVectorCase {
  readonly id: string
  readonly account: Record<string, unknown>
  /** Whether the account already has code, which drops its setup operations. */
  readonly deployed: boolean
  /** A `prepareTransaction` input, or `deploy` for a sponsored deployment. */
  readonly transaction: Record<string, unknown> | 'deploy'
}

export function evmCases(chains: {
  readonly solanaMainnet: unknown
  readonly tronMainnet: unknown
  readonly stellarMainnet: unknown
  readonly hyperCorePerp: unknown
}): readonly EvmVectorCase[] {
  return [
    {
      id: 'evm-same-chain-exact-out',
      account: existing,
      deployed: true,
      transaction: {
        source: { token: USDC_BASE },
        destination: {
          chain: base,
          token: USDC_BASE,
          amount: 1_000_000n,
          calls: [transfer(payee, 1_000_000n)],
        },
        sponsored: true,
      },
    },
    {
      // The same transaction naming its source chain: the same approval input.
      id: 'evm-same-chain-explicit-source',
      account: existing,
      deployed: true,
      transaction: {
        source: { chain: base, token: USDC_BASE },
        destination: {
          chain: base,
          token: USDC_BASE,
          amount: 1_000_000n,
          calls: [transfer(payee, 1_000_000n)],
        },
        sponsored: true,
      },
    },
    {
      id: 'evm-max-output',
      account: existing,
      deployed: true,
      transaction: {
        source: { chain: mainnet, token: USDC_MAINNET, maxAmount: 5_000_000n },
        destination: { chain: base, token: USDC_BASE },
        sponsored: { gas: true, bridging: true, swaps: false },
      },
    },
    {
      id: 'evm-cross-chain-source-calls',
      account: existing,
      deployed: true,
      transaction: {
        source: {
          chain: arbitrum,
          token: USDC_ARBITRUM,
          maxAmount: 3_000_000n,
          auxiliaryFunds: 500_000n,
          calls: [
            {
              to: USDC_ARBITRUM,
              data: '0x095ea7b3',
              provides: [{ token: USDC_ARBITRUM, amount: 250_000n }],
            },
          ],
        },
        destination: { chain: base, token: USDC_BASE, amount: 2_000_000n },
        sponsored: { gas: true, bridging: true, swaps: true },
      },
    },
    {
      id: 'evm-sponsored-source-free-calls',
      account: existing,
      deployed: true,
      transaction: {
        destination: {
          chain: base,
          calls: [transfer(payee, 1n)],
          gasLimit: 150_000n,
        },
        sponsored: true,
      },
    },
    {
      id: 'evm-explicit-false-sponsorship',
      account: existing,
      deployed: true,
      transaction: {
        source: { token: USDC_BASE },
        destination: { chain: base, calls: [transfer(payee, 1n)] },
        sponsored: {
          gas: false,
          bridging: false,
          swaps: false,
          protocolFees: false,
        },
      },
    },
    {
      id: 'evm-sponsored-deploy',
      account: nexus,
      deployed: false,
      transaction: 'deploy',
    },
    {
      id: 'evm-undeployed-erc7579',
      account: nexus,
      deployed: false,
      transaction: {
        source: { token: USDC_BASE },
        destination: { chain: base, token: USDC_BASE, amount: 1_000_000n },
        sponsored: true,
      },
    },
    {
      id: 'evm-eoa',
      account: { account: { type: 'eoa' }, eoa: eoaOwner },
      deployed: true,
      transaction: {
        source: { token: USDC_BASE },
        destination: { chain: base, token: USDC_BASE, amount: 1_000_000n },
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
    {
      id: 'evm-eoa-delegation',
      account: { ...nexus, eoa: eoaOwner },
      deployed: true,
      transaction: {
        source: { token: USDC_BASE },
        destination: { chain: base, calls: [transfer(payee, 1n)] },
        eip7702InitSignature: `0x${'22'.repeat(65)}`,
        sponsored: true,
      },
    },
    {
      id: 'evm-fees-deadline-venues',
      account: existing,
      deployed: true,
      transaction: {
        source: { token: USDC_BASE },
        destination: { chain: base, token: USDC_BASE, amount: 1_000_000n },
        appFees: { feeBps: 25 },
        protocolFees: { feeBps: 5 },
        customDeadline: 1_900_000_000,
        settlementLayers: { include: ['ACROSS'] },
        quoters: { exclude: ['bebop'] },
        sponsored: {
          gas: true,
          bridging: false,
          swaps: true,
          protocolFees: true,
        },
      },
    },
    {
      id: 'evm-bare-recipient',
      account: existing,
      deployed: true,
      transaction: {
        source: { chain: mainnet, token: USDC_MAINNET },
        destination: {
          chain: base,
          token: USDC_BASE,
          amount: 1_000_000n,
          recipient: payee,
        },
        sponsored: true,
      },
    },
    {
      id: 'evm-typed-recipient',
      account: existing,
      deployed: true,
      transaction: {
        source: { chain: mainnet, token: USDC_MAINNET },
        destination: {
          chain: base,
          token: USDC_BASE,
          amount: 1_000_000n,
          recipient: {
            account: { type: 'nexus', version: '1.2.1' },
            owners: { type: 'ecdsa', accounts: [eoaOwner] },
          },
        },
        sponsored: true,
      },
    },
    {
      id: 'evm-hypercore-action',
      account: existing,
      deployed: true,
      transaction: {
        source: { chain: arbitrum, token: USDC_ARBITRUM },
        destination: {
          chain: chains.hyperCorePerp,
          token: '0x2000000000000000000000000000000000000000',
          amount: 10_000_000n,
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
        },
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
    {
      id: 'evm-to-solana',
      account: existing,
      deployed: true,
      transaction: {
        source: { chain: base, token: USDC_BASE },
        destination: {
          chain: chains.solanaMainnet,
          token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: 1_000_000n,
          recipient: 'DfBX7Po1bmnXt4GuEF3Eg5UYUHAjs9m5n8nbb9WUqgw2',
        },
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
    {
      id: 'evm-to-tron',
      account: existing,
      deployed: true,
      transaction: {
        source: { chain: base, token: USDC_BASE },
        destination: {
          chain: chains.tronMainnet,
          token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          amount: 1_000_000n,
          recipient: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
        },
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
    {
      id: 'evm-to-stellar',
      account: existing,
      deployed: true,
      transaction: {
        source: { chain: base, token: USDC_BASE },
        destination: {
          chain: chains.stellarMainnet,
          token: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
          amount: 1_000_000n,
          recipient: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        },
        sponsored: { gas: true, bridging: false, swaps: false },
      },
    },
  ]
}
