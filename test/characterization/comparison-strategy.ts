import { decodeFunctionData, type Hex } from 'viem'
import smartSessionEmissaryAbi from '../../src/modules/abi/smart-session-emissary'
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
  const referenceValue = toStableValue(reference)
  const candidateValue = toStableValue(candidate)
  const identities = pairedExecutionArgumentIdentities(
    referenceValue,
    candidateValue,
  )
  const projectSessionDisable = scenario.caseId === 'disable-session'
  return compareObservations(
    projectIsolatedObservation(
      referenceValue,
      identities.reference,
      projectSessionDisable,
    ),
    projectIsolatedObservation(
      candidateValue,
      identities.candidate,
      projectSessionDisable,
    ),
  )
}

export function projectIsolatedObservation(
  value: unknown,
  additionalIdentities: readonly string[] = [],
  projectSessionDisable = false,
): StableValue {
  const stable = toStableValue(value)
  const accountAddress = readAccountAddress(stable)
  const recipientAddress = readAddress(stable, [
    'sign',
    'prepared',
    'intentInput',
    'recipient',
    'address',
  ])
  const balanceAddress = readAddress(stable, [
    'execution',
    'balance',
    'address',
  ])

  function project(current: StableValue, path: readonly string[]): StableValue {
    if (typeof current === 'string') {
      const normalized = current.toLowerCase()
      if (accountAddress && normalized === accountAddress) {
        return { $characterizationIdentity: 'account' }
      }
      if (recipientAddress && normalized === recipientAddress) {
        return { $characterizationIdentity: 'recipient' }
      }
      if (balanceAddress && normalized === balanceAddress) {
        return { $characterizationIdentity: 'balance-target' }
      }
      if (HEX.test(current) && isDestinationExecutionData(path)) {
        if (projectSessionDisable) {
          const disableCall = projectSessionDisableCall(current)
          if (disableCall) return disableCall
        }
        return canonicalizeHexIdentities(current, [
          accountAddress,
          recipientAddress,
          balanceAddress,
          ...additionalIdentities,
        ])
      }
      if (HEX.test(current) && isSubjectDependentArtifact(path)) {
        return {
          $characterizationArtifact: 'subject-dependent-hex',
          usage: path.join('.'),
        }
      }
      if (path.at(-1)?.toLowerCase() === 'preclaimprefix') {
        return current.slice(0, 4)
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

function projectSessionDisableCall(data: string): StableValue | undefined {
  try {
    const decoded = decodeFunctionData({
      abi: smartSessionEmissaryAbi,
      data: data as Hex,
    })
    if (decoded.functionName !== 'removeConfig') return undefined
    const [, config, disableData] = decoded.args
    return toStableValue({
      $characterizationCall: 'smart-session-disable',
      account: { $characterizationIdentity: 'account' },
      config: {
        scope: config.scope,
        resetPeriod: config.resetPeriod,
        allocator: config.allocator,
        permissionId: { $characterizationIdentity: 'session-permission' },
      },
      disableData: {
        allocatorSig: disableData.allocatorSig,
        userSig: disableData.userSig,
        expires: { $characterizationNormalized: 'timestamp' },
        session: {
          chainDigestIndex: disableData.session.chainDigestIndex,
          hashesAndChainIds: disableData.session.hashesAndChainIds.map(
            ({ chainId }) => ({
              chainId,
              sessionDigest: {
                $characterizationIdentity: 'session-disable-digest',
              },
            }),
          ),
        },
      },
    })
  } catch {
    return undefined
  }
}

function pairedExecutionArgumentIdentities(
  reference: StableValue,
  candidate: StableValue,
): {
  readonly reference: readonly string[]
  readonly candidate: readonly string[]
} {
  const referenceExecutions = readDestinationExecutions(reference)
  const candidateExecutions = readDestinationExecutions(candidate)
  const referenceIdentities: string[] = []
  const candidateIdentities: string[] = []
  for (
    let index = 0;
    index < Math.min(referenceExecutions.length, candidateExecutions.length);
    index += 1
  ) {
    const referenceData = readExecutionData(referenceExecutions[index])
    const candidateData = readExecutionData(candidateExecutions[index])
    if (
      !referenceData ||
      !candidateData ||
      referenceData.length !== candidateData.length ||
      referenceData.slice(0, 10).toLowerCase() !==
        candidateData.slice(0, 10).toLowerCase()
    ) {
      continue
    }
    const referenceAddress = readFirstAbiAddress(referenceData)
    const candidateAddress = readFirstAbiAddress(candidateData)
    if (
      referenceAddress &&
      candidateAddress &&
      referenceAddress !== candidateAddress
    ) {
      referenceIdentities.push(referenceAddress)
      candidateIdentities.push(candidateAddress)
    }
  }
  return { reference: referenceIdentities, candidate: candidateIdentities }
}

function readDestinationExecutions(value: StableValue): readonly StableValue[] {
  const executions = readValue(value, [
    'sign',
    'prepared',
    'intentInput',
    'destinationExecutions',
  ])
  return Array.isArray(executions) ? executions : []
}

function readExecutionData(value: StableValue | undefined): string | undefined {
  return isRecord(value) && typeof value.data === 'string'
    ? value.data
    : undefined
}

function readFirstAbiAddress(value: string): string | undefined {
  const match = /^0x[0-9a-f]{8}0{24}([0-9a-f]{40})/iu.exec(value)
  return match?.[1]?.toLowerCase()
}

function canonicalizeHexIdentities(
  value: string,
  identities: readonly (string | undefined)[],
): string {
  let result = value.toLowerCase()
  for (const identity of identities) {
    if (!identity) continue
    result = result.replaceAll(
      identity.replace(/^0x/u, '').toLowerCase(),
      '0'.repeat(40),
    )
  }
  return result
}

function readAddress(
  value: StableValue,
  path: readonly string[],
): string | undefined {
  const current = readValue(value, path)
  return typeof current === 'string' ? current.toLowerCase() : undefined
}

function readValue(
  value: StableValue,
  path: readonly string[],
): StableValue | undefined {
  let current: StableValue | undefined = value
  for (const segment of path) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
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
    normalized.includes('mocksignatures') ||
    (normalized.includes('setupops') && leaf === 'data') ||
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

function isDestinationExecutionData(path: readonly string[]): boolean {
  const normalized = path.map((part) => part.toLowerCase())
  return (
    normalized.includes('destinationexecutions') && normalized.at(-1) === 'data'
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
