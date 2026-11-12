import { chainReader } from './chain'
import {
  FAUCET_CHAIN,
  FIXTURES,
  type FixtureToken,
  FUNDED_CHAINS,
  type FundedChainId,
  tokenAddress,
} from './fixtures'
import {
  formatAmount,
  shortfalls,
  standingRequirements,
  topUpLine,
} from './preflight'
import { FUNDED_USES } from './spend'

// Prints every funded fixture's balances, what a run needs and the faucet
// sends that cover any shortfall. Reads only; it never sends anything.
//
//   bun run parity:funding            (PARITY_REPEAT defaults to 3)
//
// Runs under vite-node: Bun applies tsconfig's `ox` type redirect at runtime.

async function main() {
  const repeat = Number(process.env.PARITY_REPEAT || '3')
  const requirements = standingRequirements(FUNDED_USES, repeat)
  const needOf = (
    fixture: string,
    chainId: FundedChainId,
    token: FixtureToken,
  ) =>
    requirements.find(
      (entry) =>
        entry.fixture === fixture &&
        entry.chainId === chainId &&
        entry.token === token,
    )?.required ?? 0n

  console.info(`Funded parity fixtures (PARITY_REPEAT=${repeat})\n`)
  for (const spec of Object.values(FIXTURES)) {
    console.info(
      `${spec.name}  ${spec.address}  ${spec.description}${spec.funded ? '' : ' (must hold nothing)'}`,
    )
    for (const chain of FUNDED_CHAINS) {
      const chainId = chain.id as FundedChainId
      const cells: string[] = []
      for (const token of ['USDC', 'ETH'] as const) {
        const balance = await chainReader.balance(
          chainId,
          spec.address,
          token === 'ETH' ? 'ETH' : tokenAddress(chainId, token),
        )
        const need = needOf(spec.name, chainId, token)
        cells.push(
          `${token} ${formatAmount(balance, token)}${need > 0n ? ` (needs ${formatAmount(need, token)})` : ''}`,
        )
      }
      console.info(`  ${FAUCET_CHAIN[chainId].padEnd(17)} ${cells.join('  ')}`)
    }
  }

  const balances = await Promise.all(
    requirements.map(async (requirement) => ({
      ...requirement,
      balance: await chainReader.balance(
        requirement.chainId,
        requirement.address,
        requirement.token === 'ETH'
          ? 'ETH'
          : tokenAddress(requirement.chainId, requirement.token),
      ),
    })),
  )
  const short = shortfalls(balances)
  if (short.length === 0) {
    console.info(`\nNo top-up needed for PARITY_REPEAT=${repeat}.`)
    return
  }
  console.info('\nTop up through the faucet:')
  for (const entry of short) console.info(topUpLine(entry))
  process.exitCode = 1
}

await main()
