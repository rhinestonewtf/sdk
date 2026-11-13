import { baseSepolia, optimismSepolia } from 'viem/chains'
import type { FixtureUse } from './preflight'

// What each funded scenario may spend from a fixture per side. The scenarios
// and the funding plan both read this table.

const USDC_AMOUNT = 50_000n
const ETH_AMOUNT = 10_000_000_000_000n

// Fee allowances are about twice the fees measured on prod testnets
// (2026-11): Across 0.012–0.019 USDC, same-chain with 1% of fees 0.003 USDC,
// Across ETH 0.000006 ETH.
const SPEND = {
  acrossUnsponsored: USDC_AMOUNT + 40_000n,
  // Sponsored Across spends exactly the requested amount.
  acrossSponsored: USDC_AMOUNT,
  sameChainWithFees: USDC_AMOUNT + 20_000n,
  // Sponsored intent-executor routes (CCTP, same-chain) may round up a unit.
  sponsored: USDC_AMOUNT + 100n,
  // The wrap covers the amount plus the fee.
  ethUnsponsored: ETH_AMOUNT + 15_000_000_000_000n,
  // The EOA's own approve, wrap and unwrap transactions on Base Sepolia.
  eoaGas: 5_000_000_000_000n,
} as const

const base = baseSepolia.id
const op = optimismSepolia.id

const FUNDED_USES: Record<string, FixtureUse[]> = {
  'funded/across-owner-destination-call': [
    {
      fixture: 'nexus-main',
      chainId: base,
      token: 'USDC',
      perSide: SPEND.acrossUnsponsored,
    },
  ],
  'funded/across-session-source-call': [
    {
      fixture: 'nexus-main',
      chainId: op,
      token: 'USDC',
      perSide: SPEND.acrossSponsored,
    },
  ],
  'funded/same-chain-fees': [
    {
      fixture: 'nexus-main',
      chainId: base,
      token: 'USDC',
      perSide: SPEND.sameChainWithFees,
    },
  ],
  'funded/same-chain-passkey-sponsored': [
    {
      fixture: 'kernel-passkey',
      chainId: base,
      token: 'USDC',
      perSide: SPEND.sponsored,
    },
  ],
  'funded/cctp-safe': [
    {
      fixture: 'safe-multisig',
      chainId: base,
      token: 'USDC',
      perSide: SPEND.sponsored,
    },
  ],
  'funded/across-safe-return': [
    {
      fixture: 'safe-multisig',
      chainId: op,
      token: 'USDC',
      perSide: SPEND.acrossUnsponsored,
    },
  ],
  'funded/eoa-permit': [
    {
      fixture: 'eoa',
      chainId: base,
      token: 'USDC',
      perSide: SPEND.acrossSponsored,
    },
    { fixture: 'eoa', chainId: base, token: 'ETH', perSide: SPEND.eoaGas },
  ],
  'funded/eoa-permit2': [
    {
      fixture: 'eoa',
      chainId: op,
      token: 'USDC',
      perSide: SPEND.acrossSponsored,
    },
  ],
  'funded/eoa-wrap': [
    {
      fixture: 'eoa',
      chainId: base,
      token: 'ETH',
      perSide: SPEND.ethUnsponsored + SPEND.eoaGas,
    },
  ],
}

function usesFor(scenarioId: string): FixtureUse[] {
  return FUNDED_USES[scenarioId] ?? []
}

export { ETH_AMOUNT, FUNDED_USES, SPEND, USDC_AMOUNT, usesFor }
