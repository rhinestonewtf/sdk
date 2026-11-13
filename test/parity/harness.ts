import { afterAll, expect, inject, it } from 'vitest'
import { loadConfig } from './config'
import { acquireFundedLock } from './funded/lock'
import { formatSummary, writeReport } from './report'
import { runParity } from './runner'
import type { Scenario } from './scenario'

// Fails before any scenario runs when the API key or other config is invalid.
const config = loadConfig()

let releaseLock: (() => void) | undefined

// Taken by the first funded scenario of a file and held until the file ends;
// a second funded run on this machine refuses before any preflight.
function holdFundedLock(): void {
  releaseLock ??= acquireFundedLock()
}

afterAll(() => {
  releaseLock?.()
  releaseLock = undefined
})

async function assertParity(scenario: Scenario): Promise<void> {
  const results = await runParity(scenario, { config })
  if (JSON.stringify(results).includes(config.apiKey)) {
    throw new Error(`The API key leaked into the ${scenario.id} recordings`)
  }
  const file = writeReport(inject('parityRunDir'), results)
  const summary = formatSummary(results)
  console.info(`${summary}\n  report: ${file}\n`)
  const failed = results.filter((result) => result.verdict !== 'match')
  expect(failed.length, summary).toBe(0)
}

const UNFUNDED_TIMEOUT_MS = 300_000
// A side: quote, sign, submit, wait and settle, with room for slow claims.
const FUNDED_SIDE_BUDGET_MS = 5 * 60_000

function scenarioTimeout(scenario: Scenario): number {
  if (!scenario.funded) return UNFUNDED_TIMEOUT_MS
  return (
    (2 * config.repeat + 1) * (FUNDED_SIDE_BUDGET_MS + config.settleTimeoutMs)
  )
}

const fundedSkipReason =
  config.env !== 'prod'
    ? 'funded scenarios run only against prod'
    : !config.funded
      ? 'PARITY_FUNDED=0'
      : undefined

// Registers one scenario as a test. Funded scenarios are skipped on dev and
// with PARITY_FUNDED=0.
function parityTest(scenario: Scenario): void {
  const skip = scenario.funded && fundedSkipReason !== undefined
  const name = skip
    ? `${scenario.id} (skipped: ${fundedSkipReason})`
    : scenario.id
  it.skipIf(skip)(
    name,
    async () => {
      if (scenario.funded) holdFundedLock()
      await assertParity(scenario)
    },
    scenarioTimeout(scenario),
  )
}

export { assertParity, config, parityTest, scenarioTimeout }
