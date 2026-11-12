import { type Address, formatUnits } from 'viem'
import {
  FAUCET_CHAIN,
  FIXTURES,
  type FixtureName,
  type FixtureToken,
  type FundedChainId,
  PERMIT2,
  type SessionName,
  TOKENS,
  tokenAddress,
} from './fixtures'

// What a funded scenario spends from a fixture per side, at most: principal
// plus a fee allowance. Preflight requires it for every side the run may
// execute, so a short fixture fails before anything is submitted.
interface FixtureUse {
  fixture: FixtureName
  chainId: FundedChainId
  token: FixtureToken
  perSide: bigint
}

type SteadyCheck =
  | { kind: 'deployed'; fixture: FixtureName; chainId: FundedChainId }
  | { kind: 'session'; fixture: FixtureName; session: SessionName }
  | {
      kind: 'permit2'
      fixture: FixtureName
      chainId: FundedChainId
      token: 'USDC' | 'WETH'
    }

interface Requirement {
  fixture: FixtureName
  address: Address
  chainId: FundedChainId
  token: FixtureToken
  required: bigint
}

interface FixtureBalance extends Requirement {
  balance: bigint
}

interface BalanceReader {
  balance(
    chainId: FundedChainId,
    owner: Address,
    token: Address | 'ETH',
  ): Promise<bigint>
}

interface SteadyReader {
  hasCode(chainId: FundedChainId, address: Address): Promise<boolean>
  allowance(
    chainId: FundedChainId,
    owner: Address,
    token: Address,
    spender: Address,
  ): Promise<bigint>
  sessionEnabled(fixture: FixtureName, session: SessionName): Promise<boolean>
}

const DECIMALS: Record<FixtureToken, number> = { USDC: 6, ETH: 18 }
// Top-ups are rounded up to these steps.
const ROUNDING: Record<FixtureToken, bigint> = {
  USDC: 10_000n,
  ETH: 100_000_000_000_000n,
}

function requiredBalances(
  uses: readonly FixtureUse[],
  sides: number,
): Requirement[] {
  const byKey = new Map<string, Requirement>()
  for (const use of uses) {
    const key = `${use.fixture}:${use.chainId}:${use.token}`
    const entry = byKey.get(key) ?? {
      fixture: use.fixture,
      address: FIXTURES[use.fixture].address,
      chainId: use.chainId,
      token: use.token,
      required: 0n,
    }
    entry.required += use.perSide * BigInt(sides)
    byKey.set(key, entry)
  }
  return [...byKey.values()]
}

async function readBalances(
  requirements: readonly Requirement[],
  reader: BalanceReader,
): Promise<FixtureBalance[]> {
  return Promise.all(
    requirements.map(async (requirement) => ({
      ...requirement,
      balance: await reader.balance(
        requirement.chainId,
        requirement.address,
        requirement.token === 'ETH'
          ? 'ETH'
          : tokenAddress(requirement.chainId, requirement.token),
      ),
    })),
  )
}

function roundUp(amount: bigint, step: bigint): bigint {
  return ((amount + step - 1n) / step) * step
}

interface Shortfall {
  fixture: FixtureName
  address: Address
  chainId: FundedChainId
  token: FixtureToken
  amount: bigint
}

function shortfalls(balances: readonly FixtureBalance[]): Shortfall[] {
  return balances
    .filter((entry) => entry.balance < entry.required)
    .map((entry) => ({
      fixture: entry.fixture,
      address: entry.address,
      chainId: entry.chainId,
      token: entry.token,
      amount: roundUp(entry.required - entry.balance, ROUNDING[entry.token]),
    }))
}

function formatAmount(amount: bigint, token: FixtureToken): string {
  return formatUnits(amount, DECIMALS[token])
}

// The shared faucet's input format, one send per line.
function topUpLine(shortfall: Shortfall): string {
  return `chain=${FAUCET_CHAIN[shortfall.chainId]} token=${shortfall.token} amount=${formatAmount(shortfall.amount, shortfall.token)} recipient=${shortfall.address}`
}

async function checkSteady(
  checks: readonly SteadyCheck[],
  reader: SteadyReader,
): Promise<string[]> {
  const failures: string[] = []
  for (const check of checks) {
    const { address } = FIXTURES[check.fixture]
    switch (check.kind) {
      case 'deployed':
        if (!(await reader.hasCode(check.chainId, address))) {
          failures.push(`${check.fixture} is not deployed on ${check.chainId}`)
        }
        break
      case 'session':
        if (!(await reader.sessionEnabled(check.fixture, check.session))) {
          failures.push(
            `${check.fixture} session "${check.session}" is not enabled`,
          )
        }
        break
      case 'permit2': {
        const token = TOKENS[check.chainId][check.token]
        const allowance = await reader.allowance(
          check.chainId,
          address,
          token,
          PERMIT2,
        )
        if (allowance === 0n) {
          failures.push(
            `${check.fixture} has no Permit2 allowance for ${check.token} on ${check.chainId}`,
          )
        }
        break
      }
    }
  }
  return failures
}

// Each scenario checks its own need before it runs (every side plus a
// warm-up); paired flows refill a chain later in the run, so a fixture needs
// the largest single-scenario requirement per chain and token.
function standingRequirements(
  uses: Record<string, FixtureUse[]>,
  repeat: number,
): Requirement[] {
  const byKey = new Map<string, Requirement>()
  for (const scenarioUses of Object.values(uses)) {
    for (const requirement of requiredBalances(scenarioUses, 2 * repeat + 1)) {
      const key = `${requirement.fixture}:${requirement.chainId}:${requirement.token}`
      const current = byKey.get(key)
      if (!current || current.required < requirement.required)
        byKey.set(key, requirement)
    }
  }
  return [...byKey.values()]
}

export type {
  BalanceReader,
  FixtureBalance,
  FixtureUse,
  Requirement,
  Shortfall,
  SteadyCheck,
  SteadyReader,
}
export {
  checkSteady,
  formatAmount,
  readBalances,
  requiredBalances,
  shortfalls,
  standingRequirements,
  topUpLine,
}
