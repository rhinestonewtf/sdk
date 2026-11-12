import { describe, it } from 'vitest'
import { DORMANT_ACCOUNT, FIXED_INTENTS } from '../fixtures'
import { assertParity } from '../harness'
import { defineScenario } from '../scenario'
import { accountConfig, attempts, fixtureAccount } from './shared'

const intentStatus = defineScenario({
  id: 'reads/intent-status',
  description:
    'Status of fixed past intents: completed same-chain, failed cross-chain and failed same-chain (completed cross-chain is in seed/reads)',
  goldenLayers: ['reads', 'traffic'],
  async run(ctx) {
    const sdk = ctx.sdk()
    await attempts(ctx, [
      [
        'status-completed-same-chain',
        'read',
        () => sdk.getIntentStatus(FIXED_INTENTS.completedSameChain),
      ],
      [
        'status-failed-cross-chain',
        'read',
        () => sdk.getIntentStatus(FIXED_INTENTS.failedCrossChain),
      ],
      [
        'status-failed-same-chain',
        'read',
        () => sdk.getIntentStatus(FIXED_INTENTS.failedSameChain),
      ],
    ])
  },
})

const portfolio = defineScenario({
  id: 'reads/portfolio',
  description:
    'Portfolios: the empty default account on mainnets, the empty Safe and EOA on testnets, and a dormant account with a testnet balance',
  goldenLayers: ['reads', 'traffic'],
  // We don't control the dormant account; its token list stays golden.
  goldenIgnore: ['/reads/portfolio-dormant/result/**/(locked|unlocked)'],
  async run(ctx) {
    const sdk = ctx.sdk()
    const nexus = await fixtureAccount(ctx, 'nexus', sdk)
    const safe = await fixtureAccount(ctx, 'safe', sdk)
    const eoa = await fixtureAccount(ctx, 'eoa', sdk)
    // initData.address reads an existing account under fixture owners.
    const dormant = await sdk.createAccount({
      ...accountConfig(ctx, 'nexus'),
      initData: { address: DORMANT_ACCOUNT },
    })
    await attempts(ctx, [
      ['portfolio-mainnets', 'read', () => nexus.getPortfolio(false)],
      ['portfolio-safe', 'read', () => safe.getPortfolio(true)],
      ['portfolio-eoa', 'read', () => eoa.getPortfolio(true)],
      ['portfolio-dormant', 'read', () => dormant.getPortfolio(true)],
    ])
  },
})

const splits = defineScenario({
  id: 'reads/splits',
  description:
    'Intent splits: two tokens, the native token, another chain and a CCTP settlement-layer filter',
  goldenLayers: ['reads', 'traffic'],
  // Results follow live liquidity; the request parameters stay golden.
  goldenIgnore: ['/reads/*/result'],
  async run(ctx) {
    const sdk = ctx.sdk()
    const { arbitrumSepolia, baseSepolia } = ctx.chains
    const token = (symbol: string, chainId: number) =>
      ctx.build.root.getTokenAddress(symbol, chainId)
    await attempts(ctx, [
      [
        'splits-multi-token',
        'read',
        () =>
          sdk.splitIntents({
            chain: arbitrumSepolia,
            tokens: {
              [token('USDC', arbitrumSepolia.id)]: 1_000_000n,
              [token('WETH', arbitrumSepolia.id)]: 1_000_000_000_000n,
            },
          }),
      ],
      [
        'splits-native-token',
        'read',
        () =>
          sdk.splitIntents({
            chain: arbitrumSepolia,
            tokens: { [token('ETH', arbitrumSepolia.id)]: 1_000_000_000_000n },
          }),
      ],
      [
        'splits-other-chain',
        'read',
        () =>
          sdk.splitIntents({
            chain: baseSepolia,
            tokens: { [token('USDC', baseSepolia.id)]: 2_000_000n },
          }),
      ],
      [
        'splits-settlement-layers',
        'read',
        () =>
          sdk.splitIntents({
            chain: arbitrumSepolia,
            tokens: { [token('USDC', arbitrumSepolia.id)]: 1_000_000n },
            settlementLayers: ['CCTP'],
          }),
      ],
    ])
  },
})

describe.sequential('parity: reads', () => {
  for (const scenario of [intentStatus, portfolio, splits]) {
    it(scenario.id, () => assertParity(scenario))
  }
})
