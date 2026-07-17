import { assertNoSecrets } from './secrets'
import { type StableValue, toStableValue } from './serialization'

export type ComparisonDeltaKind =
  | 'value'
  | 'type'
  | 'array-length'
  | 'missing-actual'
  | 'unexpected-actual'

export interface ComparisonDelta {
  path: string
  kind: ComparisonDeltaKind
  expected?: StableValue
  actual?: StableValue
}

export interface ComparisonResult {
  equal: boolean
  deltas: ComparisonDelta[]
  truncated: boolean
}

export interface ComparisonOptions {
  maxDeltas?: number
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

function childPath(path: string, segment: string | number): string {
  return `${path}/${escapePointerSegment(String(segment))}`
}

function valueType(value: StableValue): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function isStableRecord(
  value: StableValue,
): value is Record<string, StableValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// An explicitly-`undefined` field and an absent field are wire-equivalent (JSON
// omits undefined), so treat them as equal. Serialization tags undefined as
// `{ $characterizationType: 'undefined' }` with no `value` key.
function isUndefinedMarker(value: StableValue): boolean {
  return (
    isStableRecord(value) &&
    value.$characterizationType === 'undefined' &&
    !Object.hasOwn(value, 'value')
  )
}

// A bigint and its decimal-string form are wire-equivalent (the orchestrator
// encodes numeric fields as strings). Comparing by decimal value still catches
// genuine value differences.
function canonicalScalar(value: StableValue): StableValue {
  if (
    isStableRecord(value) &&
    value.$characterizationType === 'bigint' &&
    typeof value.value === 'string'
  ) {
    return value.value
  }
  return value
}

export function compareObservations(
  expectedObservation: unknown,
  actualObservation: unknown,
  options: ComparisonOptions = {},
): ComparisonResult {
  assertNoSecrets(expectedObservation)
  assertNoSecrets(actualObservation)

  const expected = toStableValue(expectedObservation)
  const actual = toStableValue(actualObservation)
  const maxDeltas = options.maxDeltas ?? 100
  if (!Number.isInteger(maxDeltas) || maxDeltas < 1) {
    throw new Error('maxDeltas must be a positive integer')
  }

  const deltas: ComparisonDelta[] = []
  let truncated = false

  function add(delta: ComparisonDelta): boolean {
    if (deltas.length >= maxDeltas) {
      truncated = true
      return false
    }
    deltas.push(delta)
    return true
  }

  function compare(
    expectedInput: StableValue,
    actualInput: StableValue,
    path: string,
  ): void {
    const expectedValue = canonicalScalar(expectedInput)
    const actualValue = canonicalScalar(actualInput)
    const expectedType = valueType(expectedValue)
    const actualType = valueType(actualValue)
    if (expectedType !== actualType) {
      add({
        path: path || '/',
        kind: 'type',
        expected: expectedValue,
        actual: actualValue,
      })
      return
    }

    if (Array.isArray(expectedValue) && Array.isArray(actualValue)) {
      if (expectedValue.length !== actualValue.length) {
        add({
          path: path || '/',
          kind: 'array-length',
          expected: expectedValue.length,
          actual: actualValue.length,
        })
      }
      const sharedLength = Math.min(expectedValue.length, actualValue.length)
      for (let index = 0; index < sharedLength; index += 1) {
        compare(
          expectedValue[index],
          actualValue[index],
          childPath(path, index),
        )
      }
      for (let index = sharedLength; index < expectedValue.length; index += 1) {
        add({
          path: childPath(path, index),
          kind: 'missing-actual',
          expected: expectedValue[index],
        })
      }
      for (let index = sharedLength; index < actualValue.length; index += 1) {
        add({
          path: childPath(path, index),
          kind: 'unexpected-actual',
          actual: actualValue[index],
        })
      }
      return
    }

    if (isStableRecord(expectedValue) && isStableRecord(actualValue)) {
      const keys = Array.from(
        new Set([...Object.keys(expectedValue), ...Object.keys(actualValue)]),
      ).sort()
      for (const key of keys) {
        const hasExpected = Object.hasOwn(expectedValue, key)
        const hasActual = Object.hasOwn(actualValue, key)
        const keyPath = childPath(path, key)
        if (!hasActual) {
          if (isUndefinedMarker(expectedValue[key])) continue
          add({
            path: keyPath,
            kind: 'missing-actual',
            expected: expectedValue[key],
          })
        } else if (!hasExpected) {
          if (isUndefinedMarker(actualValue[key])) continue
          add({
            path: keyPath,
            kind: 'unexpected-actual',
            actual: actualValue[key],
          })
        } else {
          compare(expectedValue[key], actualValue[key], keyPath)
        }
      }
      return
    }

    if (!Object.is(expectedValue, actualValue)) {
      add({
        path: path || '/',
        kind: 'value',
        expected: expectedValue,
        actual: actualValue,
      })
    }
  }

  compare(expected, actual, '')
  return { equal: deltas.length === 0 && !truncated, deltas, truncated }
}
