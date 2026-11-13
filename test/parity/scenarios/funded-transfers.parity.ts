import { baseSepolia, optimismSepolia } from 'viem/chains'
import { describe } from 'vitest'
import {
  FIXTURES,
  NOOP_CALL,
  SESSION_CHAIN,
  sessionConfig,
  TOKENS,
} from '../funded/fixtures'
import { USDC_AMOUNT } from '../funded/spend'
import { parityTest } from '../harness'
import type { ScenarioContext } from '../scenario'
import { defineScenario } from '../scenario'
import { execute, FUNDED_LAYERS, fixtureAccount } from './funded'

// Smart-account transfers, in an order that brings principal back: Nexus
// Base → OP and back, Nexus → Kernel and back, Safe Base → OP and back.
// Nothing goes to Arbitrum Sepolia: Across relayers there hold about 0.04
// USDC, and fills beyond that fail.

const usdc = (chainId: keyof typeof TOKENS) => TOKENS[chainId].USDC

const acrossOwnerDestinationCall = defineScenario({
  id: 'funded/across-owner-destination-call',
  description:
    'Nexus owner: 0.05 USDC Base Sepolia → OP Sepolia over Across (Permit2) with a destination call, unsponsored, with a quoter filter',
  funded: true,
  goldenLayers: FUNDED_LAYERS,
  steady: [
    { kind: 'deployed', fixture: 'nexus-main', chainId: baseSepolia.id },
    { kind: 'deployed', fixture: 'nexus-main', chainId: optimismSepolia.id },
    {
      kind: 'permit2',
      fixture: 'nexus-main',
      chainId: baseSepolia.id,
      token: 'USDC',
    },
  ],
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'nexus-main')
    await execute(ctx, account, {
      sourceChains: [baseSepolia],
      targetChain: optimismSepolia,
      settlementLayers: ['ACROSS'],
      calls: [NOOP_CALL],
      tokenRequests: [
        { address: usdc(optimismSepolia.id), amount: USDC_AMOUNT },
      ],
      quoters: { exclude: ['0x'] },
    })
  },
})

// Plain sessions sign the claim through ERC-1271 (signature mode 1), which
// cannot enable the session in the same intent on testnets
// (InvalidContractSignature); the first warm-up enables it with execution
// verification, and a second one restores the unlimited Permit2 approval.
async function sessionSourceCall(
  ctx: ScenarioContext,
  verifyExecutions: boolean,
) {
  const account = await fixtureAccount(ctx, 'nexus-main')
  const session = sessionConfig('plain')
  const details = await ctx.step('session-details', 'other', () =>
    account.experimental_getSessionDetails([session]),
  )
  const userSignature = await ctx.step('enable-signature', 'other', () =>
    account.experimental_signEnableSession(details),
  )
  await execute(ctx, account, {
    sourceChains: [optimismSepolia],
    targetChain: baseSepolia,
    settlementLayers: ['ACROSS'],
    sourceCalls: { [SESSION_CHAIN.plain]: [NOOP_CALL] },
    tokenRequests: [{ address: usdc(baseSepolia.id), amount: USDC_AMOUNT }],
    sponsored: true,
    signers: {
      type: 'experimental_session',
      session,
      ...(verifyExecutions ? { verifyExecutions } : {}),
      // Used only until the session is enabled.
      enableData: {
        userSignature,
        hashesAndChainIds: (details as { hashesAndChainIds: unknown })
          .hashesAndChainIds,
        sessionToEnableIndex: 0,
      },
    },
  })
}

const acrossSessionSourceCall = defineScenario({
  id: 'funded/across-session-source-call',
  description:
    'Nexus session (no actions, ERC-1271 signature mode): 0.05 USDC OP Sepolia → Base Sepolia over Across with a source call, sponsored',
  funded: true,
  goldenLayers: FUNDED_LAYERS,
  steady: [
    { kind: 'deployed', fixture: 'nexus-main', chainId: optimismSepolia.id },
    { kind: 'session', fixture: 'nexus-main', session: 'plain' },
    {
      kind: 'permit2',
      fixture: 'nexus-main',
      chainId: optimismSepolia.id,
      token: 'USDC',
    },
  ],
  warmUp: (ctx) => sessionSourceCall(ctx, true),
  run: (ctx) => sessionSourceCall(ctx, false),
})

const sameChainFees = defineScenario({
  id: 'funded/same-chain-fees',
  description:
    'Nexus owner: 0.05 USDC on Base Sepolia to the Kernel fixture, unsponsored, with app and protocol fees',
  funded: true,
  goldenLayers: FUNDED_LAYERS,
  steady: [
    { kind: 'deployed', fixture: 'nexus-main', chainId: baseSepolia.id },
  ],
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'nexus-main')
    await execute(ctx, account, {
      chain: baseSepolia,
      recipient: FIXTURES['kernel-passkey'].address,
      tokenRequests: [{ address: usdc(baseSepolia.id), amount: USDC_AMOUNT }],
      appFees: { feeBps: 50 },
      protocolFees: { feeBps: 50 },
    })
  },
})

const sameChainPasskeySponsored = defineScenario({
  id: 'funded/same-chain-passkey-sponsored',
  description:
    'Kernel 3.3 with a software passkey: 0.05 USDC on Base Sepolia back to the Nexus fixture, sponsored including a protocol fee',
  funded: true,
  goldenLayers: FUNDED_LAYERS,
  steady: [
    { kind: 'deployed', fixture: 'kernel-passkey', chainId: baseSepolia.id },
  ],
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'kernel-passkey')
    await execute(ctx, account, {
      chain: baseSepolia,
      recipient: FIXTURES['nexus-main'].address,
      tokenRequests: [{ address: usdc(baseSepolia.id), amount: USDC_AMOUNT }],
      sponsored: { gas: true, bridging: true, swaps: true, protocolFees: true },
      protocolFees: { feeBps: 50 },
    })
  },
})

const cctpSafe = defineScenario({
  id: 'funded/cctp-safe',
  description:
    'Safe 2-of-3: 0.05 USDC Base Sepolia → OP Sepolia over CCTP, sponsored per category',
  funded: true,
  goldenLayers: FUNDED_LAYERS,
  steady: [
    { kind: 'deployed', fixture: 'safe-multisig', chainId: baseSepolia.id },
  ],
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'safe-multisig')
    await execute(ctx, account, {
      sourceChains: [baseSepolia],
      targetChain: optimismSepolia,
      settlementLayers: ['CCTP'],
      tokenRequests: [
        { address: usdc(optimismSepolia.id), amount: USDC_AMOUNT },
      ],
      sponsored: { gas: true, bridging: true, swaps: true },
    })
  },
})

const acrossSafeReturn = defineScenario({
  id: 'funded/across-safe-return',
  description:
    'Safe 2-of-3: 0.05 USDC OP Sepolia → Base Sepolia over Across (Permit2), unsponsored, with source assets',
  funded: true,
  goldenLayers: FUNDED_LAYERS,
  steady: [
    { kind: 'deployed', fixture: 'safe-multisig', chainId: optimismSepolia.id },
    {
      kind: 'permit2',
      fixture: 'safe-multisig',
      chainId: optimismSepolia.id,
      token: 'USDC',
    },
  ],
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'safe-multisig')
    await execute(ctx, account, {
      sourceChains: [optimismSepolia],
      targetChain: baseSepolia,
      settlementLayers: ['ACROSS'],
      tokenRequests: [{ address: usdc(baseSepolia.id), amount: USDC_AMOUNT }],
      sourceAssets: { [optimismSepolia.id]: ['USDC'] },
    })
  },
})

describe.sequential('parity: funded, transfers', () => {
  for (const scenario of [
    acrossOwnerDestinationCall,
    acrossSessionSourceCall,
    sameChainFees,
    sameChainPasskeySponsored,
    cctpSafe,
    acrossSafeReturn,
  ]) {
    parityTest(scenario)
  }
})
