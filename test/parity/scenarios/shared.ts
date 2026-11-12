import type { SdkAccount, SdkInstance } from '../builds'
import type { StepKind } from '../context'
import { USDC_BASE_SEPOLIA } from '../fixtures'
import type { ScenarioContext } from '../scenario'

type FixtureKind =
  | 'nexus'
  | 'safe'
  | 'kernel'
  | 'startale'
  | 'multiOwner'
  | 'passkey'
  | 'eoa'
  | 'eip7702'
  | 'sessions'

// Account configs for the fixture accounts; none is ever funded.
function accountConfig(
  ctx: ScenarioContext,
  kind: FixtureKind,
): Record<string, unknown> {
  const ownerA = { type: 'ecdsa', accounts: [ctx.signer('ownerA')] }
  switch (kind) {
    case 'nexus':
      return { owners: ownerA }
    case 'safe':
    case 'kernel':
    case 'startale':
      return { account: { type: kind }, owners: ownerA }
    case 'multiOwner':
      return {
        owners: {
          type: 'ecdsa',
          accounts: [ctx.signer('ownerA'), ctx.signer('ownerB')],
          threshold: 2,
        },
      }
    case 'passkey':
      return { owners: { type: 'passkey', accounts: [ctx.passkey()] } }
    case 'eoa':
      return { account: { type: 'eoa' }, eoa: ctx.signer('ownerA') }
    case 'eip7702':
      return { eoa: ctx.signer('ownerA'), owners: ownerA }
    case 'sessions':
      return { owners: ownerA, experimental_sessions: { enabled: true } }
  }
}

function fixtureAccount(
  ctx: ScenarioContext,
  kind: FixtureKind,
  sdk: SdkInstance = ctx.sdk(),
): Promise<SdkAccount> {
  return sdk.createAccount(accountConfig(ctx, kind))
}

const AUXILIARY_USDC = 5_000_000n

// Base Sepolia → Arbitrum Sepolia, 0.1 USDC, backed by declared auxiliary
// funds so the empty fixture accounts still get a quote.
function crossChain(
  ctx: ScenarioContext,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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
    auxiliaryFunds: auxiliaryUsdc(ctx),
    ...overrides,
  }
}

function auxiliaryUsdc(ctx: ScenarioContext) {
  return {
    [ctx.chains.baseSepolia.id]: { [USDC_BASE_SEPOLIA]: AUXILIARY_USDC },
  }
}

type Attempt = [name: string, kind: StepKind, fn: () => Promise<unknown>]

// Runs every attempt even when an earlier one fails; each outcome is
// recorded by its step.
async function attempts(ctx: ScenarioContext, list: Attempt[]): Promise<void> {
  for (const [name, kind, fn] of list) {
    try {
      await ctx.step(name, kind, fn)
    } catch {
      // Recorded by the step.
    }
  }
}

// One value per process, so both builds send the same deadline within a run.
// The orchestrator accepts now + 120 s to now + 24 h.
const CUSTOM_DEADLINE = Math.floor(Date.now() / 1000) + 3600

export type { Attempt, FixtureKind }
export {
  accountConfig,
  attempts,
  auxiliaryUsdc,
  CUSTOM_DEADLINE,
  crossChain,
  fixtureAccount,
}
