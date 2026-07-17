import { arbitrumSepolia, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { encodeDisableSessionCall } from '../../src/modules/validators/smart-sessions/calls'
import { toSession } from '../../src/modules/validators/smart-sessions/resolve'
import { accountA, accountB } from '../consts'
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

  test('projects identity-bound session setup and permission artifacts', () => {
    const reference = observation(
      '0x1111111111111111111111111111111111111111',
      'aa',
      5n,
    )
    const candidate = observation(
      '0x2222222222222222222222222222222222222222',
      'bb',
      5n,
    )
    Object.assign(reference.sign, {
      prepared: {
        account: {
          setupOps: [
            {
              to: '0x7777777777777777777777777777777777777777',
              data: '0xaaaa',
            },
          ],
          mockSignatures: { 1: '0xaaaa' },
        },
      },
      artifacts: { preClaimPrefix: '0x0011223344' },
    })
    Object.assign(candidate.sign, {
      prepared: {
        account: {
          setupOps: [
            {
              to: '0x7777777777777777777777777777777777777777',
              data: '0xbbbb',
            },
          ],
          mockSignatures: { 1: '0xbbbb' },
        },
      },
      artifacts: { preClaimPrefix: '0x00aabbccdd' },
    })

    expect(
      compareScenarioValues(isolatedScenario, reference, candidate),
    ).toMatchObject({
      equal: true,
      deltas: [],
    })
  })

  test('projects isolated balance targets and subject-bound calldata', () => {
    const reference = observation(
      '0x1111111111111111111111111111111111111111',
      'aa',
      5n,
    )
    const candidate = observation(
      '0x2222222222222222222222222222222222222222',
      'bb',
      5n,
    )
    reference.execution.balance.address =
      '0x3333333333333333333333333333333333333333'
    candidate.execution.balance.address =
      '0x4444444444444444444444444444444444444444'
    Object.assign(reference.sign.prepared, {
      intentInput: {
        destinationExecutions: [
          {
            to: reference.execution.balance.address,
            data: `0xa9059cbb${'0'.repeat(24)}${reference.execution.balance.address.slice(2)}${'0'.repeat(63)}1`,
          },
        ],
      },
    })
    Object.assign(candidate.sign.prepared, {
      intentInput: {
        destinationExecutions: [
          {
            to: candidate.execution.balance.address,
            data: `0xa9059cbb${'0'.repeat(24)}${candidate.execution.balance.address.slice(2)}${'0'.repeat(63)}1`,
          },
        ],
      },
    })

    expect(
      compareScenarioValues(isolatedScenario, reference, candidate),
    ).toMatchObject({ equal: true, deltas: [] })

    const candidateInput = candidate.sign
      .prepared as typeof candidate.sign.prepared & {
      intentInput: { destinationExecutions: { data: string }[] }
    }
    candidateInput.intentInput.destinationExecutions[0].data = `0xa9059cbb${'0'.repeat(24)}${candidate.execution.balance.address.slice(2)}${'0'.repeat(63)}2`
    expect(
      compareScenarioValues(isolatedScenario, reference, candidate).equal,
    ).toBe(false)
  })

  test('decodes identity-bound session disable calldata without hiding invariants', () => {
    const scenario = {
      comparison: 'isolated-state',
      caseId: 'disable-session',
    } as CharacterizationScenario
    const reference = sessionDisableObservation(base, accountA, 123n)
    const candidate = sessionDisableObservation(base, accountB, 456n)

    expect(compareScenarioValues(scenario, reference, candidate)).toMatchObject(
      {
        equal: true,
        deltas: [],
      },
    )

    const changedChain = sessionDisableObservation(
      arbitrumSepolia,
      accountB,
      456n,
    )
    expect(compareScenarioValues(scenario, reference, changedChain).equal).toBe(
      false,
    )
  })
})

function sessionDisableObservation(
  chain: typeof base | typeof arbitrumSepolia,
  owner: typeof accountA,
  expires: bigint,
) {
  const session = toSession({
    chain,
    owners: { type: 'ecdsa', accounts: [owner] },
  })
  const result = observation(owner.address, 'aa', 5n)
  Object.assign(result.sign.prepared, {
    intentInput: {
      destinationExecutions: [
        encodeDisableSessionCall({
          account: owner.address,
          session,
          expires,
          nonce: expires,
          environment: 'production',
        }),
      ],
    },
  })
  return result
}

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
