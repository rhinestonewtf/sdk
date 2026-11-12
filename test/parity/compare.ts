import type { Layer } from './canonical/types'
import { toPointer } from './glob'
import { isTolerant, type TolerantValue } from './normalize'

type DiffKind = 'changed' | 'missing' | 'extra' | 'type' | 'out-of-tolerance'

interface Diff {
  layer: Layer
  path: string
  kind: DiffKind
  a: unknown
  b: unknown
}

function kindOf(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'array'
  if (isTolerant(value)) return 'tolerance'
  return typeof value
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  const text = String(value)
  return Number(text.endsWith('n') ? text.slice(0, -1) : text)
}

function withinTolerance(a: TolerantValue, b: TolerantValue): boolean {
  const spec = b.$tolerance
  const x = toNumber(a.$tolerance.value)
  const y = toNumber(b.$tolerance.value)
  if (Number.isNaN(x) || Number.isNaN(y))
    return a.$tolerance.value === b.$tolerance.value
  if (spec.presence && (x === 0) !== (y === 0)) return false
  const delta = Math.abs(x - y)
  const relative = (spec.relative ?? 0) * Math.max(Math.abs(x), Math.abs(y))
  return delta <= Math.max(relative, spec.absolute ?? 0)
}

// Deep structural diff; tolerance markers compare numerically.
function compare(
  layer: Layer,
  a: unknown,
  b: unknown,
  path: string[] = [],
): Diff[] {
  const at = (kind: DiffKind, x: unknown, y: unknown): Diff => ({
    layer,
    path: toPointer(path),
    kind,
    a: x,
    b: y,
  })
  const ka = kindOf(a)
  const kb = kindOf(b)
  if (ka === 'null' && kb === 'null') return []
  if (ka === 'null') return [at('extra', undefined, b)]
  if (kb === 'null') return [at('missing', a, undefined)]
  if (ka !== kb) return [at('type', a, b)]
  if (ka === 'tolerance') {
    const x = a as TolerantValue
    const y = b as TolerantValue
    return withinTolerance(x, y)
      ? []
      : [at('out-of-tolerance', x.$tolerance.value, y.$tolerance.value)]
  }
  if (ka === 'array') {
    const left = a as unknown[]
    const right = b as unknown[]
    const diffs: Diff[] = []
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      diffs.push(...compare(layer, left[i], right[i], [...path, String(i)]))
    }
    return diffs
  }
  if (ka === 'object') {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = [
      ...new Set([...Object.keys(left), ...Object.keys(right)]),
    ].sort()
    return keys.flatMap((key) =>
      compare(layer, left[key], right[key], [...path, key]),
    )
  }
  return a === b ? [] : [at('changed', a, b)]
}

export type { Diff, DiffKind }
export { compare }
