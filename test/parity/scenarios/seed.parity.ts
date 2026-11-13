import { describe, it } from 'vitest'
import type { SdkAccount } from '../builds'
import {
  FIXED_INTENT_ID,
  MISSING_INTENT_ID,
  USDC_BASE_SEPOLIA,
} from '../fixtures'
import { assertParity } from '../harness'
import { defineScenario, type ScenarioContext } from '../scenario'
import { PAYEE_ADDRESS } from './shared'

const INVALID_API_KEY = 'invalid-parity-key'

async function fixtureAccount(ctx: ScenarioContext): Promise<SdkAccount> {
  return ctx.sdk().createAccount({
    owners: { type: 'ecdsa', accounts: [ctx.signer('ownerA')] },
  })
}

function crossChainTransaction(
  ctx: ScenarioContext,
  withAuxiliaryFunds: boolean,
) {
  const { baseSepolia, arbitrumSepolia } = ctx.chains
  return {
    sourceChains: [baseSepolia],
    targetChain: arbitrumSepolia,
    tokenRequests: [
      {
        address: ctx.build.root.getTokenAddress('USDC', arbitrumSepolia.id),
        amount: 100_000n,
      },
    ],
    // Pinned settlement layers lack testnet capacity; the unpinned route is
    // stable. The payee keeps both API versions on the same CCTP plan
    // (`crossChainToPayee`).
    ...(withAuxiliaryFunds
      ? {
          recipient: PAYEE_ADDRESS,
          auxiliaryFunds: {
            [baseSepolia.id]: { [USDC_BASE_SEPOLIA]: 5_000_000n },
          },
        }
      : {}),
  }
}

const unfundedCrossChain = defineScenario({
  id: 'seed/unfunded-cross-chain',
  description:
    'Unfunded Base Sepolia → Arbitrum Sepolia USDC quote to a payee via auxiliary funds; sign; captured submit',
  goldenLayers: [
    'quoteRequest',
    'typedData',
    'signatures',
    'submitRequest',
    'traffic',
  ],
  async run(ctx) {
    const account = await fixtureAccount(ctx)
    await ctx.step('address', 'other', () => account.getAddress())
    const prepared = await ctx.step('prepare', 'prepare', () =>
      account.prepareTransaction(crossChainTransaction(ctx, true)),
    )
    await ctx.step('messages', 'messages', () =>
      account.getTransactionMessages(prepared),
    )
    const signed = await ctx.step('sign', 'sign', () =>
      account.signTransaction(prepared),
    )
    await ctx.step('submit', 'submit', () => account.submitTransaction(signed))
  },
})

const reads = defineScenario({
  id: 'seed/reads',
  description:
    'Intent status of a fixed intent, empty portfolio, splits and app-fee balances',
  goldenLayers: ['reads', 'traffic'],
  // Splits and app-fee balances follow liquidity and project activity.
  goldenIgnore: ['/reads/(splits|appFeeBalances)/result'],
  async run(ctx) {
    const sdk = ctx.sdk()
    const account = await fixtureAccount(ctx)
    await ctx.step('status', 'read', () => sdk.getIntentStatus(FIXED_INTENT_ID))
    await ctx.step('portfolio', 'read', () => account.getPortfolio(true))
    await ctx.step('splits', 'read', () =>
      sdk.splitIntents({
        chain: ctx.chains.arbitrumSepolia,
        tokens: {
          [ctx.build.root.getTokenAddress(
            'USDC',
            ctx.chains.arbitrumSepolia.id,
          )]: 1_000_000n,
        },
      }),
    )
    await ctx.step('appFeeBalances', 'read', () => sdk.getAppFeeBalances())
  },
})

const errors = defineScenario({
  id: 'seed/errors',
  description: 'ZERO_BALANCE quote, unknown intent id and invalid API key',
  goldenLayers: ['errors', 'quoteRequest', 'traffic'],
  async run(ctx) {
    const account = await fixtureAccount(ctx)
    const attempts: [string, 'prepare' | 'read', () => Promise<unknown>][] = [
      [
        'prepare-zero-balance',
        'prepare',
        () => account.prepareTransaction(crossChainTransaction(ctx, false)),
      ],
      [
        'status-not-found',
        'read',
        () => ctx.sdk().getIntentStatus(MISSING_INTENT_ID),
      ],
      [
        'app-fees-invalid-key',
        'read',
        () => ctx.sdk({ apiKey: INVALID_API_KEY }).getAppFeeBalances(),
      ],
    ]
    for (const [name, kind, fn] of attempts) {
      try {
        await ctx.step(name, kind, fn)
      } catch {
        // Recorded by the step; every attempt runs.
      }
    }
  },
})

describe.sequential('parity: seed', () => {
  for (const scenario of [unfundedCrossChain, reads, errors]) {
    it(scenario.id, () => assertParity(scenario))
  }
})
