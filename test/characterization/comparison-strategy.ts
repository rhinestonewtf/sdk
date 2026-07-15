import { type ComparisonResult, compareObservations } from './compare'
import { type StableValue, toStableValue } from './serialization'
import type { CharacterizationScenario } from './types'

const HEX = /^0x[0-9a-fA-F]*$/u

export function compareScenarioValues(
  scenario: CharacterizationScenario,
  reference: unknown,
  candidate: unknown,
): ComparisonResult {
  if (scenario.comparison !== 'isolated-state') {
    return compareObservations(reference, candidate)
  }
  return compareObservations(
    projectIsolatedObservation(reference),
    projectIsolatedObservation(candidate),
  )
}

export function projectIsolatedObservation(value: unknown): StableValue {
  const stable = toStableValue(value)
  const accountAddress = readAccountAddress(stable)

  function project(current: StableValue, path: readonly string[]): StableValue {
    if (typeof current === 'string') {
      if (accountAddress && current.toLowerCase() === accountAddress) {
        return { $characterizationIdentity: 'account' }
      }
      if (HEX.test(current) && isSubjectDependentArtifact(path)) {
        return {
          $characterizationArtifact: 'subject-dependent-hex',
          bytes: Math.max(0, (current.length - 2) / 2),
          usage: path.join('.'),
        }
      }
      return current
    }
    if (current === null || typeof current !== 'object') return current
    if (Array.isArray(current)) {
      return current.map((item, index) =>
        project(item, [...path, String(index)]),
      )
    }
    if (path.at(-1) === 'balance') return projectBalance(current, project, path)

    return Object.fromEntries(
      Object.entries(current).map(([key, child]) => [
        key,
        project(child, [...path, key]),
      ]),
    )
  }

  return project(stable, [])
}

function readAccountAddress(value: StableValue): string | undefined {
  if (!isRecord(value)) return undefined
  const sign = value.sign
  if (!isRecord(sign) || !isRecord(sign.account)) return undefined
  const address = sign.account.address
  return typeof address === 'string' ? address.toLowerCase() : undefined
}

function isSubjectDependentArtifact(path: readonly string[]): boolean {
  const normalized = path.map((part) => part.toLowerCase())
  const leaf = normalized.at(-1) ?? ''
  if (leaf.endsWith('prefix')) return false
  if (
    (normalized.includes('artifacts') ||
      normalized.includes('authorizations')) &&
    ['r', 's'].includes(leaf)
  ) {
    return true
  }
  return (
    leaf === 'payload' ||
    leaf.includes('signature') ||
    (normalized.includes('artifacts') &&
      [
        'bytes',
        'destination',
        'notarizedclaim',
        'preclaim',
        'targetexecution',
        'value',
      ].includes(leaf))
  )
}

function projectBalance(
  value: Record<string, StableValue>,
  project: (value: StableValue, path: readonly string[]) => StableValue,
  path: readonly string[],
): StableValue {
  const delta = taggedBigInt(value.delta)
  const projected = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['before', 'after'].includes(key))
      .map(([key, child]) => [key, project(child, [...path, key])]),
  )
  return {
    ...projected,
    changed: delta === undefined ? 'unknown' : delta !== 0n,
    direction:
      delta === undefined
        ? 'unknown'
        : delta === 0n
          ? 'zero'
          : delta > 0n
            ? 'increase'
            : 'decrease',
  }
}

function taggedBigInt(value: StableValue | undefined): bigint | undefined {
  if (
    !isRecord(value) ||
    value.$characterizationType !== 'bigint' ||
    typeof value.value !== 'string'
  ) {
    return undefined
  }
  return BigInt(value.value)
}

function isRecord(
  value: StableValue | undefined,
): value is Record<string, StableValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
