import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { LAYERS } from './canonical/types'
import type { Diff } from './compare'
import { RULES } from './rules'
import type { BuildMeta, ExecutionRecord, ScenarioResult } from './runner'
import { stableStringify } from './serialize'

const MAX_VALUE = 160

function show(value: unknown): string {
  if (value === undefined) return '(absent)'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text
}

function diffLine(diff: Diff): string {
  return `      ${diff.path} [${diff.kind}]\n        baseline:  ${show(diff.a)}\n        candidate: ${show(diff.b)}`
}

function buildLine(role: string, meta: BuildMeta): string {
  const api =
    meta.apiVersions.length > 0
      ? meta.apiVersions.join(', ')
      : 'no orchestrator calls'
  return `  ${role}: ${meta.label} — ${api}`
}

function executionLine(record: ExecutionRecord): string {
  const id = record.intentId
    ? `${record.intentId.slice(0, 12)}…`
    : `submit ${record.submitStatus}`
  const trace = record.submitTraceId
    ? ` (submit trace ${record.submitTraceId})`
    : ''
  return `    ${record.role.padEnd(9)} ${record.step}: ${id} ${record.status}${record.settled ? '' : ' (not settled)'} ${Math.round(record.elapsedMs / 1000)}s${trace}`
}

function formatResult(result: ScenarioResult): string {
  const lines: string[] = []
  const fault = result.fault ? ` (fault: ${result.fault})` : ''
  const kind = result.error ? ` (${result.error.kind})` : ''
  lines.push(
    `${result.verdict === 'match' ? '✓' : '✗'} ${result.scenarioId} #${result.iteration + 1}: ${result.verdict}${kind}${fault}`,
  )
  if (result.error) lines.push(`  ${result.error.message}`)
  const funded = result.funded
  if (funded && funded.fixtures.length > 0) {
    lines.push('  fixtures at preflight (balance / required):')
    for (const entry of funded.fixtures)
      lines.push(
        `    ${entry.fixture} ${entry.chainId} ${entry.token}: ${entry.balance} / ${entry.required}`,
      )
  }
  if (funded?.warmUp) {
    lines.push(`  warm-up (${funded.warmUp.reasons.join('; ')}):`)
    for (const record of funded.warmUp.execution)
      lines.push(executionLine(record))
    for (const error of funded.warmUp.errors) lines.push(`    ✗ ${error}`)
  }
  if (result.execution && result.execution.length > 0) {
    lines.push('  execution:')
    for (const record of result.execution) lines.push(executionLine(record))
  }
  if (result.skippedSides) {
    lines.push(`  skipped: ${result.skippedSides.join(', ')}`)
  }
  lines.push(buildLine('baseline ', result.baseline))
  lines.push(buildLine('candidate', result.candidate))
  for (const layer of LAYERS) {
    const entry = result.layers[layer]
    lines.push(`    ${layer.padEnd(14)} ${entry.status}`)
    for (const diff of entry.diffs) lines.push(diffLine(diff))
  }
  if (result.harnessErrors.length > 0) {
    lines.push('  harness errors (the scenario or harness is broken):')
    for (const entry of result.harnessErrors)
      lines.push(`    ${entry.role} ${entry.step}: ${entry.message}`)
  }
  const accepted = LAYERS.flatMap((layer) => result.layers[layer].accepted)
  if (accepted.length > 0) {
    lines.push('  accepted differences:')
    for (const diff of accepted)
      lines.push(`    ${diff.layer}${diff.path} — ${diff.reason}`)
  }
  switch (result.golden.status) {
    case 'drift':
      lines.push('  golden drift (baseline no longer matches its golden):')
      for (const diff of result.golden.diffs) {
        lines.push(`    ${diff.layer}${diff.path} [${diff.kind}]`)
        lines.push(
          `        golden:   ${show(diff.a)}\n        baseline: ${show(diff.b)}`,
        )
      }
      break
    case 'missing':
      lines.push('  golden missing: run with PARITY_UPDATE_GOLDENS=1')
      break
    case 'updated':
      lines.push(`  golden updated: ${result.golden.file}`)
      break
    case 'skipped':
      lines.push(`  golden skipped: ${result.golden.reason}`)
      break
  }
  const hits = Object.entries(result.ruleHits.baseline)
    .map(([id, count]) => `${id}×${count}`)
    .join(', ')
  if (hits) lines.push(`  rules fired (baseline): ${hits}`)
  return lines.join('\n')
}

function formatSummary(results: ScenarioResult[]): string {
  return results.map(formatResult).join('\n\n')
}

function createRunDir(reportDir: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const dir = resolve(reportDir, stamp)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeReport(dir: string, results: ScenarioResult[]): string {
  mkdirSync(dir, { recursive: true })
  const scenarioId = results[0]?.scenarioId ?? 'empty'
  const file = join(dir, `${scenarioId.replace(/[^a-zA-Z0-9._-]+/g, '-')}.json`)
  const rules = Object.fromEntries(RULES.map((rule) => [rule.id, rule.reason]))
  writeFileSync(file, stableStringify({ results, rules }))
  return file
}

export { createRunDir, formatSummary, writeReport }
