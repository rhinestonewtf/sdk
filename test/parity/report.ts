import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { LAYERS } from './canonical/types'
import type { Diff } from './compare'
import { RULES } from './rules'
import type { BuildMeta, ScenarioResult } from './runner'
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

function formatResult(result: ScenarioResult): string {
  const lines: string[] = []
  const fault = result.fault ? ` (fault: ${result.fault})` : ''
  lines.push(
    `${result.verdict === 'match' ? '✓' : '✗'} ${result.scenarioId} #${result.iteration + 1}: ${result.verdict}${fault}`,
  )
  lines.push(buildLine('baseline ', result.baseline))
  lines.push(buildLine('candidate', result.candidate))
  for (const layer of LAYERS) {
    const entry = result.layers[layer]
    lines.push(`    ${layer.padEnd(14)} ${entry.status}`)
    for (const diff of entry.diffs) lines.push(diffLine(diff))
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
