import { assertNoSecrets } from './secrets'

export type StableValue =
  | null
  | boolean
  | number
  | string
  | StableValue[]
  | { [key: string]: StableValue }

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

function childPath(path: string, segment: string | number): string {
  return `${path}/${escapePointerSegment(String(segment))}`
}

function tagged(type: string, value?: StableValue): StableValue {
  return value === undefined
    ? { $characterizationType: type }
    : { $characterizationType: type, value }
}

export function toStableValue(value: unknown): StableValue {
  const active = new WeakSet<object>()

  function convert(current: unknown, path: string): StableValue {
    if (current === null) return null
    if (current === undefined) return tagged('undefined')

    switch (typeof current) {
      case 'boolean':
      case 'string':
        return current
      case 'number':
        if (!Number.isFinite(current)) {
          throw new TypeError(
            `Cannot serialize non-finite number at ${path || '/'}`,
          )
        }
        return Object.is(current, -0) ? tagged('number', '-0') : current
      case 'bigint':
        return tagged('bigint', current.toString(10))
      case 'function':
      case 'symbol':
        throw new TypeError(
          `Cannot serialize ${typeof current} at ${path || '/'}`,
        )
      default:
        break
    }

    if (active.has(current)) {
      throw new TypeError(`Cannot serialize cyclic value at ${path || '/'}`)
    }
    active.add(current)

    try {
      if (current instanceof Date) {
        if (Number.isNaN(current.getTime())) {
          throw new TypeError(`Cannot serialize invalid Date at ${path || '/'}`)
        }
        return tagged('date', current.toISOString())
      }

      if (current instanceof Map) {
        const entries = Array.from(
          current.entries(),
          ([key, mapValue], index) => {
            const entryPath = childPath(path, index)
            const stableKey = convert(key, childPath(entryPath, 'key'))
            const stableMapValue = convert(
              mapValue,
              childPath(entryPath, 'value'),
            )
            return {
              key: stableKey,
              value: stableMapValue,
              sortKey: `${JSON.stringify(stableKey)}\u0000${JSON.stringify(stableMapValue)}`,
            }
          },
        )
          .sort((left, right) => {
            if (left.sortKey === right.sortKey) return 0
            return left.sortKey < right.sortKey ? -1 : 1
          })
          .map(({ key, value: mapValue }) => ({ key, value: mapValue }))

        return tagged('map', entries)
      }

      if (Array.isArray(current)) {
        return Array.from(current, (item, index) =>
          convert(item, childPath(path, index)),
        )
      }

      const prototype = Object.getPrototypeOf(current)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(
          `Cannot serialize ${current.constructor?.name ?? 'non-plain object'} at ${path || '/'}`,
        )
      }

      const output: { [key: string]: StableValue } = {}
      for (const key of Object.keys(current).sort()) {
        output[key] = convert(
          (current as Record<string, unknown>)[key],
          childPath(path, key),
        )
      }
      return output
    } finally {
      active.delete(current)
    }
  }

  return convert(value, '')
}

export function stableStringify(value: unknown, space = 2): string {
  return JSON.stringify(toStableValue(value), null, space)
}

export function serializeArtifact(value: unknown, space = 2): string {
  assertNoSecrets(value)
  return `${stableStringify(value, space)}\n`
}
