import { baseSepolia, optimismSepolia } from 'viem/chains'
import { describe } from 'vitest'
import { FIXTURES, TOKENS } from '../funded/fixtures'
import type { FixtureUse } from '../funded/preflight'
import { parityTest } from '../harness'
import { defineScenario } from '../scenario'
import { fixtureAccount } from './funded'
import { attempts } from './shared'

// Reads and quotes against the funded fixtures' real balances; nothing is
// submitted. Balances move between runs, so goldens keep the shape only.

const PORTFOLIO_BALANCES: FixtureUse[] = [
  ...(['nexus-main', 'safe-multisig', 'kernel-passkey'] as const).flatMap(
    (fixture) =>
      [baseSepolia.id, optimismSepolia.id].map((chainId) => ({
        fixture,
        chainId,
        token: 'USDC' as const,
        perSide: 0n,
      })),
  ),
  ...[baseSepolia.id, optimismSepolia.id].flatMap((chainId) =>
    (['USDC', 'ETH'] as const).map((token) => ({
      fixture: 'eoa' as const,
      chainId,
      token,
      perSide: 0n,
    })),
  ),
]

const fundedPortfolio = defineScenario({
  id: 'funded/portfolio',
  description:
    'Testnet portfolios of the funded Nexus, Safe, Kernel and EOA fixtures (non-zero balances on several chains)',
  funded: true,
  execution: 'none',
  goldenLayers: ['reads', 'traffic'],
  // Amounts change with every funded run; which tokens and chains are listed
  // stays golden.
  goldenIgnore: ['/reads/*/result/**/(locked|unlocked|balance)'],
  // Shows the fixture balances in the report; requires nothing.
  fixtures: PORTFOLIO_BALANCES,
  async run(ctx) {
    const sdk = ctx.sdk()
    const accounts = {
      nexus: await fixtureAccount(ctx, 'nexus-main', sdk),
      safe: await fixtureAccount(ctx, 'safe-multisig', sdk),
      kernel: await fixtureAccount(ctx, 'kernel-passkey', sdk),
      eoa: await fixtureAccount(ctx, 'eoa', sdk),
    }
    await attempts(
      ctx,
      Object.entries(accounts).map(([name, account]) => [
        `portfolio-${name}`,
        'read',
        () => account.getPortfolio(true),
      ]),
    )
  },
})

// Requests more than the fixture holds: some balance exists, but not enough.
const insufficientBalance = defineScenario({
  id: 'funded/insufficient-balance',
  description:
    'Quotes for more than a funded fixture holds: a same-chain transfer above the Kernel balance and an Across transfer above the Nexus balance',
  funded: true,
  execution: 'none',
  goldenLayers: ['quoteRequest', 'errors', 'traffic'],
  // The amounts available or missing follow the fixtures' current balances.
  goldenIgnore: ['/errors/*/context/(availableAmount|remaining)'],
  async run(ctx) {
    const kernel = await fixtureAccount(ctx, 'kernel-passkey')
    const nexus = await fixtureAccount(ctx, 'nexus-main')
    await attempts(ctx, [
      [
        'same-chain',
        'prepare',
        () =>
          kernel.prepareTransaction({
            chain: baseSepolia,
            recipient: FIXTURES['nexus-main'].address,
            tokenRequests: [
              { address: TOKENS[baseSepolia.id].USDC, amount: 10_000_000n },
            ],
            sponsored: true,
          }),
      ],
      [
        'cross-chain',
        'prepare',
        () =>
          nexus.prepareTransaction({
            sourceChains: [baseSepolia],
            targetChain: optimismSepolia,
            settlementLayers: ['ACROSS'],
            tokenRequests: [
              {
                address: TOKENS[optimismSepolia.id].USDC,
                amount: 10_000_000n,
              },
            ],
            sponsored: true,
          }),
      ],
    ])
  },
})

describe.sequential('parity: funded, reads', () => {
  for (const scenario of [fundedPortfolio, insufficientBalance]) {
    parityTest(scenario)
  }
})
