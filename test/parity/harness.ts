import { expect, inject } from 'vitest'
import { loadConfig } from './config'
import { formatSummary, writeReport } from './report'
import { runParity } from './runner'
import type { Scenario } from './scenario'

// Fails before any scenario runs when the API key or other config is invalid.
const config = loadConfig()

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

export { assertParity, config }
