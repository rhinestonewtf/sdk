import { describe, it } from 'vitest'
import { UNSUPPORTED_TOKEN, USDC_BASE_SEPOLIA } from '../fixtures'
import { assertParity } from '../harness'
import { defineScenario } from '../scenario'
import { attempts, CUSTOM_DEADLINE, crossChain, fixtureAccount } from './shared'

const INVALID_API_KEY = 'invalid-parity-key'
const INVALID_JWT = {
  mode: 'experimental_jwt',
  accessToken: 'invalid-parity-jwt',
}

const quoteRejections = defineScenario({
  id: 'errors/quote-rejections',
  description:
    'Quotes the orchestrator rejects: unsupported chain and token, no route (testnet → mainnet, pinned to CCTP: unpinned, the strategies report their failures in a different order each run), two max-out requests, a custom deadline on a cross-chain route, and unsupported and invalid settlement-layer pins',
  goldenLayers: ['errors', 'quoteRequest', 'traffic'],
  goldenIgnore: [
    // The orchestrator's internal route strategies.
    '/errors/no-route/context/(resolvedLayers|strategyFailures)',
    // Relative to the run's start time.
    '/quoteRequest/custom-deadline-cross-chain/options/customDeadline',
  ],
  async run(ctx) {
    const { arbitrumSepolia, holesky, mainnet } = ctx.chains
    const account = await fixtureAccount(ctx, 'nexus')
    const tx = (overrides: Record<string, unknown>) => () =>
      account.prepareTransaction(crossChain(ctx, overrides))
    const token = (symbol: string, chainId: number) =>
      ctx.build.root.getTokenAddress(symbol, chainId)
    await attempts(ctx, [
      [
        'unsupported-chain',
        'prepare',
        tx({
          targetChain: holesky,
          tokenRequests: [{ address: UNSUPPORTED_TOKEN, amount: 1n }],
        }),
      ],
      [
        'unsupported-token',
        'prepare',
        tx({ tokenRequests: [{ address: UNSUPPORTED_TOKEN, amount: 1n }] }),
      ],
      [
        'no-route',
        'prepare',
        tx({
          targetChain: mainnet,
          tokenRequests: [{ address: token('USDC', mainnet.id), amount: 1n }],
          settlementLayers: ['CCTP'],
        }),
      ],
      [
        'multiple-max-out',
        'prepare',
        tx({
          tokenRequests: [
            { address: token('USDC', arbitrumSepolia.id) },
            { address: token('WETH', arbitrumSepolia.id) },
          ],
        }),
      ],
      [
        'custom-deadline-cross-chain',
        'prepare',
        tx({ customDeadline: CUSTOM_DEADLINE }),
      ],
      [
        'settlement-layer-unsupported',
        'prepare',
        tx({ settlementLayers: ['RELAY'] }),
      ],
      [
        'settlement-layer-invalid',
        'prepare',
        tx({ settlementLayers: ['SAME_CHAIN'] }),
      ],
    ])
  },
})

const sendZeroBalance = defineScenario({
  id: 'errors/send-zero-balance',
  description:
    'sendTransaction from an empty account without auxiliary funds: the quote is rejected (ZERO_BALANCE) and nothing is submitted',
  goldenLayers: ['errors', 'quoteRequest', 'traffic'],
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'nexus')
    await attempts(ctx, [
      [
        'send',
        'submit',
        () =>
          account.sendTransaction(
            crossChain(ctx, { auxiliaryFunds: undefined }),
          ),
      ],
    ])
  },
})

const sdkValidation = defineScenario({
  id: 'errors/sdk-validation',
  description:
    'Errors the SDK raises before calling the orchestrator: unknown token symbol, source calls on a chain outside the sources, unsupported signer, missing EIP-7702 init signature and missing auth',
  goldenLayers: ['errors', 'traffic'],
  async run(ctx) {
    const { optimismSepolia } = ctx.chains
    const nexus = await fixtureAccount(ctx, 'nexus')
    const eip7702 = await fixtureAccount(ctx, 'eip7702')
    const tx = (overrides: Record<string, unknown>) => () =>
      nexus.prepareTransaction(crossChain(ctx, overrides))
    await attempts(ctx, [
      [
        'unknown-token-symbol',
        'prepare',
        tx({ tokenRequests: [{ address: 'USDT0', amount: 100_000n }] }),
      ],
      [
        'source-calls-unknown-chain',
        'prepare',
        tx({
          sourceCalls: {
            [optimismSepolia.id]: [{ to: USDC_BASE_SEPOLIA, data: '0x' }],
          },
        }),
      ],
      [
        'guardians-signer',
        'prepare',
        tx({
          signers: { type: 'guardians', guardians: [ctx.signer('ownerB')] },
        }),
      ],
      [
        'eip7702-missing-init-signature',
        'prepare',
        () => eip7702.prepareTransaction(crossChain(ctx)),
      ],
      ['missing-auth', 'other', async () => ctx.sdk({ apiKey: '' })],
    ])
  },
})

const auth = defineScenario({
  id: 'errors/auth',
  description:
    'An invalid API key on quote, status, portfolio and splits, and an invalid JWT on quote and app-fee balances',
  goldenLayers: ['errors', 'quoteRequest', 'traffic'],
  async run(ctx) {
    const badKey = ctx.sdk({ apiKey: INVALID_API_KEY })
    const badJwt = ctx.sdk({ auth: INVALID_JWT })
    const badKeyAccount = await fixtureAccount(ctx, 'nexus', badKey)
    const badJwtAccount = await fixtureAccount(ctx, 'nexus', badJwt)
    const { arbitrumSepolia } = ctx.chains
    await attempts(ctx, [
      [
        'invalid-key-prepare',
        'prepare',
        () => badKeyAccount.prepareTransaction(crossChain(ctx)),
      ],
      ['invalid-key-status', 'read', () => badKey.getIntentStatus(123n)],
      ['invalid-key-portfolio', 'read', () => badKeyAccount.getPortfolio(true)],
      [
        'invalid-key-splits',
        'read',
        () =>
          badKey.splitIntents({
            chain: arbitrumSepolia,
            tokens: {
              [ctx.build.root.getTokenAddress('USDC', arbitrumSepolia.id)]:
                1_000_000n,
            },
          }),
      ],
      [
        'invalid-jwt-prepare',
        'prepare',
        () => badJwtAccount.prepareTransaction(crossChain(ctx)),
      ],
      ['invalid-jwt-app-fees', 'read', () => badJwt.getAppFeeBalances()],
    ])
  },
})

const reads = defineScenario({
  id: 'errors/reads',
  description:
    'Read errors: malformed intent id, insufficient split liquidity, and splits for an unsupported token and an unsupported chain',
  goldenLayers: ['errors', 'reads', 'traffic'],
  goldenIgnore: ['/reads/*/result'],
  async run(ctx) {
    const sdk = ctx.sdk()
    const { arbitrumSepolia, holesky } = ctx.chains
    await attempts(ctx, [
      ['status-malformed-id', 'read', () => sdk.getIntentStatus(0n)],
      [
        'splits-insufficient-liquidity',
        'read',
        () =>
          sdk.splitIntents({
            chain: arbitrumSepolia,
            tokens: {
              [ctx.build.root.getTokenAddress('USDC', arbitrumSepolia.id)]:
                10_000_000_000_000_000n,
            },
          }),
      ],
      [
        'splits-unsupported-token',
        'read',
        () =>
          sdk.splitIntents({
            chain: arbitrumSepolia,
            tokens: { [UNSUPPORTED_TOKEN]: 1_000_000n },
          }),
      ],
      [
        'splits-unsupported-chain',
        'read',
        () =>
          sdk.splitIntents({
            chain: holesky,
            tokens: { [UNSUPPORTED_TOKEN]: 1_000_000n },
          }),
      ],
    ])
  },
})

describe.sequential('parity: errors', () => {
  for (const scenario of [
    quoteRejections,
    sendZeroBalance,
    sdkValidation,
    auth,
    reads,
  ]) {
    it(scenario.id, () => assertParity(scenario))
  }
})
