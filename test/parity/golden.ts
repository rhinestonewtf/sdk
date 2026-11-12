import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CanonicalLayers, Layer } from './canonical/types'
import { compare, type Diff } from './compare'
import { matchGlob } from './glob'
import { isTolerant } from './normalize'
import { stableStringify } from './serialize'

const GOLDEN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'goldens')

// Layers that never belong in a golden: they depend on liquidity or time.
const NEVER_GOLDEN: readonly Layer[] = ['cost']

// Tolerance-compared values are not deterministic; a golden pins only which
// rule covers them.
function goldenValue(
  value: unknown,
  path: string[],
  ignore: readonly string[],
): unknown {
  if (isTolerant(value)) return `<~${value.$tolerance.rule}>`
  if (Array.isArray(value)) {
    return value.map((entry, i) =>
      goldenValue(entry, [...path, String(i)], ignore),
    )
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      const next = [...path, key]
      if (ignore.some((pattern) => matchGlob(pattern, next))) continue
      out[key] = goldenValue(entry, next, ignore)
    }
    return out
  }
  return value
}

function goldenView(
  layers: CanonicalLayers,
  goldenLayers: readonly Layer[],
  ignore: readonly string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const layer of goldenLayers) {
    if (NEVER_GOLDEN.includes(layer)) {
      throw new Error(`Layer "${layer}" cannot be golden`)
    }
    out[layer] = goldenValue(layers[layer], [layer], ignore)
  }
  return JSON.parse(stableStringify(out))
}

function goldenFile(scenarioId: string, dir = GOLDEN_DIR): string {
  return join(dir, `${scenarioId.replace(/[^a-zA-Z0-9._-]+/g, '-')}.json`)
}

function readGolden(
  scenarioId: string,
  dir = GOLDEN_DIR,
): Record<string, unknown> | undefined {
  const file = goldenFile(scenarioId, dir)
  if (!existsSync(file)) return undefined
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeGolden(
  scenarioId: string,
  view: Record<string, unknown>,
  dir = GOLDEN_DIR,
): string {
  const file = goldenFile(scenarioId, dir)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, stableStringify(view))
  return file
}

type GoldenOutcome =
  | { status: 'match' }
  | { status: 'drift'; diffs: Diff[] }
  | { status: 'missing' }
  | { status: 'updated'; file: string }
  | { status: 'skipped'; reason: string }

function checkGolden(
  scenarioId: string,
  view: Record<string, unknown>,
  options: { update: boolean; dir?: string },
): GoldenOutcome {
  if (options.update) {
    return {
      status: 'updated',
      file: writeGolden(scenarioId, view, options.dir),
    }
  }
  const golden = readGolden(scenarioId, options.dir)
  if (!golden) return { status: 'missing' }
  const diffs: Diff[] = []
  const layers = [
    ...new Set([...Object.keys(golden), ...Object.keys(view)]),
  ].sort()
  for (const layer of layers) {
    diffs.push(...compare(layer as Layer, golden[layer], view[layer]))
  }
  return diffs.length === 0 ? { status: 'match' } : { status: 'drift', diffs }
}

export type { GoldenOutcome }
export { checkGolden, goldenFile, goldenView }
