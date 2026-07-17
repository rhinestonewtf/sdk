import { keccak256, stringToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { CharacterizationScenario, CharacterizationSubject } from './types'

type NamespaceInput = {
  readonly scenario: Pick<CharacterizationScenario, 'id' | 'comparison'>
  readonly baseSha: string
  readonly runId: string
  readonly subject: CharacterizationSubject
}

export function getComparisonGroupNamespace({
  scenario,
  baseSha,
  runId,
}: NamespaceInput): string {
  return `sdk-characterization:v1:${baseSha}:${runId}:${scenario.id}`
}

export function getIdentityNamespace(input: NamespaceInput): string {
  const group = getComparisonGroupNamespace(input)
  if (input.scenario.comparison === 'isolated-state') {
    return `${group}:${input.subject}`
  }
  if (input.scenario.comparison === 'shared-inputs') {
    return `sdk-characterization:v1:${input.baseSha}:shared:${input.scenario.id}`
  }
  return group
}

export function createDeterministicOwner(namespace: string, role: string) {
  const privateKey = keccak256(stringToHex(`${namespace}:${role}`))
  return privateKeyToAccount(privateKey)
}
