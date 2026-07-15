import { describe, expect, test } from 'vitest'
import {
  compareScenarioValues,
  projectIsolatedObservation,
} from './comparison-strategy'
import type { CharacterizationScenario } from './types'

const isolatedScenario = {
  comparison: 'isolated-state',
} as CharacterizationScenario

describe('characterization comparison strategy', () => {
  test('maps isolated identity and signer artifacts while retaining semantics', () => {
    const reference = observation(
      '0x1111111111111111111111111111111111111111',
      'aa',
      5n,
    )
    const candidate = observation(
      '0x2222222222222222222222222222222222222222',
      'bb',
      5n,
      100n,
    )

    expect(
      compareScenarioValues(isolatedScenario, reference, candidate),
    ).toMatchObject({ equal: true, deltas: [] })
  })

  test('does not hide terminal assertion changes', () => {
    const reference = observation(
      '0x1111111111111111111111111111111111111111',
      'aa',
      5n,
    )
    const candidate = observation(
      '0x2222222222222222222222222222222222222222',
      'bb',
      8n,
    )
    candidate.execution.assertions = ['no-failed-operations']

    expect(
      compareScenarioValues(isolatedScenario, reference, candidate).equal,
    ).toBe(false)
  })

  test('does not hide balance delta changes', () => {
    const reference = observation(
      '0x1111111111111111111111111111111111111111',
      'aa',
      5n,
    )
    const candidate = observation(
      '0x2222222222222222222222222222222222222222',
      'bb',
      1n,
    )

    expect(
      compareScenarioValues(isolatedScenario, reference, candidate).equal,
    ).toBe(false)
  })

  test('retains wrapper prefixes and authorization addresses', () => {
    const reference = observation(
      '0x1111111111111111111111111111111111111111',
      'aa',
      5n,
      1n,
      '0x12345678',
    )
    const changedPrefix = observation(
      '0x2222222222222222222222222222222222222222',
      'bb',
      5n,
      1n,
      '0x87654321',
    )
    expect(
      compareScenarioValues(isolatedScenario, reference, changedPrefix).equal,
    ).toBe(false)

    changedPrefix.sign.authorizations[0].address =
      reference.sign.authorizations[0].address
    changedPrefix.sign.artifacts.prefix = reference.sign.artifacts.prefix
    expect(
      compareScenarioValues(isolatedScenario, reference, changedPrefix),
    ).toMatchObject({ equal: true, deltas: [] })

    changedPrefix.sign.authorizations[0].address =
      '0x9999999999999999999999999999999999999999'
    expect(
      compareScenarioValues(isolatedScenario, reference, changedPrefix).equal,
    ).toBe(false)
  })

  test('retains raw identity and bytes outside the semantic projection', () => {
    const raw = observation(
      '0x1111111111111111111111111111111111111111',
      'aa',
      5n,
    )
    projectIsolatedObservation(raw)
    expect(raw.sign.account.address).toBe(
      '0x1111111111111111111111111111111111111111',
    )
    expect(raw.sign.artifacts.signature).toBe('0xaaaa')
  })
})

function observation(
  address: string,
  byte: string,
  delta: bigint,
  before = 1n,
  prefix = '0x12345678',
) {
  return {
    mode: 'execute',
    workflow: 'intent',
    outcome: { status: 'success' },
    sign: {
      account: { address },
      prepared: {
        chainId: 84532,
        call: { to: '0x0000000000000000000000000000000000000001' },
      },
      signing: {
        invocations: [{ order: 0, payload: `0x${byte.repeat(32)}` }],
      },
      artifacts: { prefix, signature: `0x${byte.repeat(2)}` },
      authorizations: [
        {
          address: '0x7777777777777777777777777777777777777777',
          r: `0x${byte.repeat(32)}`,
          s: `0x${byte.repeat(32)}`,
          yParity: 0,
        },
      ],
    },
    execution: {
      assertions: ['intent-completed'],
      balance: {
        kind: 'erc20',
        chainId: 421614,
        address,
        before,
        after: before + delta,
        delta,
        expectedDelta: 5n,
      },
    },
  }
}
