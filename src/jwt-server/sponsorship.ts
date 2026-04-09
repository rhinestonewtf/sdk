import type { Address, Hex } from 'viem'

type MaybeAsync<T> = T | Promise<T>

export interface SponsorshipFilter {
  chain?: (chain: { id: number }) => MaybeAsync<boolean>
  account?: (address: Address) => MaybeAsync<boolean>
  calls?: (
    calls: { to: Address; value: bigint; data: Hex }[],
  ) => MaybeAsync<boolean>
}

interface ParsedIntentInput {
  chain: { id: number }
  account: Address
  calls: { to: Address; value: bigint; data: Hex }[]
}

function parseIntentInput(intentInput: unknown): ParsedIntentInput {
  if (typeof intentInput !== 'object' || intentInput === null) {
    throw new Error('intentInput must be a non-null object')
  }

  const input = intentInput as Record<string, unknown>

  const chainId = input.destinationChainId
  if (typeof chainId !== 'number') {
    throw new Error('intentInput.destinationChainId must be a number')
  }

  const account = input.account
  if (typeof account !== 'object' || account === null) {
    throw new Error('intentInput.account must be a non-null object')
  }
  const address = (account as Record<string, unknown>).address
  if (typeof address !== 'string') {
    throw new Error('intentInput.account.address must be a string')
  }

  const executions = input.destinationExecutions
  if (!Array.isArray(executions)) {
    throw new Error('intentInput.destinationExecutions must be an array')
  }

  const calls = executions.map(
    (exec: { to: string; value: string | number; data: string }) => ({
      to: exec.to as Address,
      value: BigInt(exec.value),
      data: exec.data as Hex,
    }),
  )

  return {
    chain: { id: chainId },
    account: address as Address,
    calls,
  }
}

export async function shouldSponsor(
  intentInput: unknown,
  filters: SponsorshipFilter,
): Promise<boolean> {
  const parsed = parseIntentInput(intentInput)

  if (filters.chain && !(await filters.chain(parsed.chain))) {
    return false
  }
  if (filters.account && !(await filters.account(parsed.account))) {
    return false
  }
  if (filters.calls && !(await filters.calls(parsed.calls))) {
    return false
  }

  return true
}
