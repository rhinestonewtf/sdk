import { baseSepolia, optimismSepolia } from 'viem/chains'
import { describe } from 'vitest'
import { tokenRequirementsOf } from '../builds'
import { eoaActions } from '../funded/chain'
import { FIXTURES, NATIVE, TOKENS } from '../funded/fixtures'
import { ETH_AMOUNT, USDC_AMOUNT } from '../funded/spend'
import { parityTest } from '../harness'
import { defineScenario, HarnessError } from '../scenario'
import { execute, FUNDED_LAYERS, fixtureAccount } from './funded'

// The plain EOA fixture, Base Sepolia ↔ OP Sepolia over Across. Its own
// transactions (approvals, wrapping) happen between sides and are not
// recorded.

async function waitFor(
  check: () => Promise<boolean>,
  what: string,
  timeoutMs = 300_000,
): Promise<void> {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeoutMs)
      throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}

function permitTransaction() {
  return {
    sourceChains: [baseSepolia],
    targetChain: optimismSepolia,
    settlementLayers: ['ACROSS'],
    tokenRequests: [
      { address: TOKENS[optimismSepolia.id].USDC, amount: USDC_AMOUNT },
    ],
    sourceAssets: ['USDC'],
    sponsored: true,
  }
}

const eoaPermit = defineScenario({
  id: 'funded/eoa-permit',
  description:
    'EOA: 0.05 USDC Base Sepolia → OP Sepolia over Across, sponsored, approving Permit2 with an ERC-2612 permit signature',
  funded: true,
  goldenLayers: FUNDED_LAYERS,
  // Each side starts with no Permit2 allowance, so the quote offers a permit
  // again; the permit it signs grants an unlimited one. After executing one,
  // the orchestrator keeps assuming the allowance for a while, so the reset
  // waits until an (unrecorded) quote offers the permit again.
  async beforeSide({ sdk }) {
    const usdc = TOKENS[baseSepolia.id].USDC
    await eoaActions.setPermit2Allowance(baseSepolia.id, usdc, 0n)
    const account = await sdk.createAccount(FIXTURES.eoa.config())
    await waitFor(async () => {
      const prepared = await account.prepareTransaction(permitTransaction())
      return Object.keys(tokenRequirementsOf(prepared)).length > 0
    }, 'the orchestrator to offer a permit again')
  },
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'eoa')
    await execute(ctx, account, permitTransaction())
  },
})

const eoaPermit2 = defineScenario({
  id: 'funded/eoa-permit2',
  description:
    'EOA: 0.05 USDC OP Sepolia → Base Sepolia over Across, sponsored, with Permit2 already approved',
  funded: true,
  goldenLayers: FUNDED_LAYERS,
  // The warm-up approves Permit2 through the permit the quote offers.
  steady: [
    {
      kind: 'permit2',
      fixture: 'eoa',
      chainId: optimismSepolia.id,
      token: 'USDC',
    },
  ],
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'eoa')
    await execute(ctx, account, {
      sourceChains: [optimismSepolia],
      targetChain: baseSepolia,
      settlementLayers: ['ACROSS'],
      tokenRequests: [
        { address: TOKENS[baseSepolia.id].USDC, amount: USDC_AMOUNT },
      ],
      sourceAssets: ['USDC'],
      sponsored: true,
    })
  },
})

const eoaWrap = defineScenario({
  id: 'funded/eoa-wrap',
  description:
    'EOA: 0.00001 ETH Base Sepolia → OP Sepolia over Across, unsponsored, wrapping exactly the quoted ETH into WETH before submitting',
  funded: true,
  goldenLayers: FUNDED_LAYERS,
  // No WETH left over, so the quote asks for the same wrap every side.
  async beforeSide() {
    await eoaActions.unwrapAll(baseSepolia.id)
    await eoaActions.ensureMaxPermit2Allowance(
      baseSepolia.id,
      TOKENS[baseSepolia.id].WETH,
    )
  },
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'eoa')
    await execute(
      ctx,
      account,
      {
        sourceChains: [baseSepolia],
        targetChain: optimismSepolia,
        settlementLayers: ['ACROSS'],
        tokenRequests: [{ address: 'ETH', amount: ETH_AMOUNT }],
        sourceAssets: ['ETH'],
      },
      {
        async beforeSubmit(prepared) {
          const wrap = tokenRequirementsOf(prepared)[baseSepolia.id]?.[NATIVE]
          if (wrap?.type !== 'wrap' || wrap.amount === undefined) {
            throw new HarnessError('The quote asked for no ETH wrap')
          }
          await eoaActions.wrap(baseSepolia.id, BigInt(wrap.amount))
        },
      },
    )
  },
})

describe.sequential('parity: funded, EOA', () => {
  for (const scenario of [eoaPermit, eoaPermit2, eoaWrap]) {
    parityTest(scenario)
  }
})
