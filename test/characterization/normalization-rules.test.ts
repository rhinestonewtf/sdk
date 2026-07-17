import { describe, expect, test } from 'vitest'
import {
  normalizeScenarioObservation,
  resolveNormalizationRules,
} from './normalization-rules'
import type { CharacterizationObservation } from './observe'
import type { NormalizationRule } from './types'

describe('named characterization normalization rules', () => {
  test('maps every catalog rule to approved concrete paths', () => {
    const observation = makeObservation({
      prepared: {
        requestId: 'request-1',
        traceId: 'trace-1',
        quotes: { best: { intentId: 'intent-1', quoteId: 'quote-1' } },
        createdAt: '2026-07-15T00:00:00.000Z',
        gasEstimate: 12n,
      },
      execution: {
        submission: { id: 'intent-submission-1' },
        transactionHash: `0x${'12'.repeat(32)}`,
        receipt: { blockNumber: 123 },
      },
      simulation: { result: { id: 'intent-simulation-1' } },
    })
    const selected = [
      'request-id',
      'quote-id',
      'timestamps',
      'gas-estimates',
      'transaction-hash',
      'receipt-block',
    ] as const satisfies readonly NormalizationRule[]

    const rules = resolveNormalizationRules(observation, selected)

    expect(rules.map(({ path }) => path)).toEqual([
      '/sign/prepared/requestId',
      '/sign/prepared/traceId',
      '/sign/prepared/quotes/best/intentId',
      '/sign/prepared/quotes/best/quoteId',
      '/sign/prepared/createdAt',
      '/sign/prepared/gasEstimate',
      '/execution/submission/id',
      '/execution/transactionHash',
      '/execution/receipt/blockNumber',
      '/simulation/result/id',
    ])
    expect(() =>
      normalizeScenarioObservation(observation, selected),
    ).not.toThrow()
  })

  test('keeps semantic fields and removes only harness comparison context', () => {
    const observation = makeObservation({
      prepared: {
        requestId: 'request-1',
        accountAddress: '0x1111111111111111111111111111111111111111',
        chainId: 84532,
        amount: 100n,
        call: { target: '0x2222', data: '0x1234' },
        signature: '0xabcd',
      },
    })

    const result = normalizeScenarioObservation(observation, ['request-id'])

    expect(result.value).toEqual({
      workflow: 'intent',
      mode: 'sign',
      sign: {
        prepared: {
          requestId: { $characterizationNormalized: 'generated-id' },
          accountAddress: '0x1111111111111111111111111111111111111111',
          chainId: 84532,
          amount: 100n,
          call: { target: '0x2222', data: '0x1234' },
          signature: '0xabcd',
        },
      },
      outcome: { status: 'success' },
    })
    expect(result.appliedRules).toEqual([
      {
        path: '/sign/prepared/requestId',
        kind: 'generated-id',
        reason: 'request and trace correlation IDs are generated for each run',
      },
    ])
  })

  test('normalizes distinct execute transaction hashes and receipt blocks', () => {
    const referenceExecution = {
      terminal: {
        operations: [
          {
            chain: 84532,
            status: 'COMPLETED',
            txHash: `0x${'12'.repeat(32)}`,
            receipt: { blockNumber: 123 },
          },
        ],
      },
    }
    const reference = makeObservation({
      execution: referenceExecution,
    })
    const candidate = makeObservation({
      execution: {
        terminal: {
          operations: [
            {
              chain: 84532,
              status: 'COMPLETED',
              txHash: `0x${'34'.repeat(32)}`,
              receipt: { blockNumber: 456 },
            },
          ],
        },
      },
    })

    const selected = ['transaction-hash', 'receipt-block'] as const
    const normalizedReference = normalizeScenarioObservation(
      reference,
      selected,
    )
    const normalizedCandidate = normalizeScenarioObservation(
      candidate,
      selected,
    )

    expect(normalizedReference.value).toEqual(normalizedCandidate.value)
    expect(normalizedReference.appliedRules).toEqual([
      {
        path: '/execution/terminal/operations/0/txHash',
        kind: 'transaction-hash',
        reason: 'transaction hashes identify individual live submissions',
      },
      {
        path: '/execution/terminal/operations/0/receipt/blockNumber',
        kind: 'block-number',
        reason: 'receipt block numbers depend on the testnet head',
      },
    ])
    expect(referenceExecution.terminal.operations[0]?.txHash).toBe(
      `0x${'12'.repeat(32)}`,
    )
  })

  test('retains isolated identity mapping evidence on both subjects', () => {
    const mapping = {
      path: '/sign/account/address',
      identity: 'scenario-account',
      values: ['0xlegacy', '0xrewrite'],
      reason: 'stateful comparisons use isolated accounts',
    } as const
    const legacy = normalizeScenarioObservation(
      makeObservation({}, 'legacy', '0xlegacy'),
      [],
      [mapping],
    )
    const rewrite = normalizeScenarioObservation(
      makeObservation({}, 'rewrite', '0xrewrite'),
      [],
      [mapping],
    )

    expect(legacy.value).toEqual(rewrite.value)
    expect(legacy.appliedIdentities[0]).toMatchObject({
      original: '0xlegacy',
      identity: 'scenario-account',
    })
    expect(rewrite.appliedIdentities[0]).toMatchObject({
      original: '0xrewrite',
      identity: 'scenario-account',
    })
  })
})

function makeObservation(
  details: {
    prepared?: unknown
    execution?: unknown
    simulation?: unknown
  },
  subject: 'legacy' | 'rewrite' = 'legacy',
  accountAddress?: string,
): CharacterizationObservation {
  return {
    schemaVersion: 1,
    scenarioId: 'intents/example',
    workflow: 'intent',
    subject,
    runId: `${subject}-run`,
    comparisonGroup: `${subject}-group`,
    mode: details.execution ? 'execute' : 'sign',
    sign: {
      ...(accountAddress ? { account: { address: accountAddress } } : {}),
      ...(details.prepared ? { prepared: details.prepared } : {}),
    },
    ...(details.execution ? { execution: details.execution } : {}),
    ...(details.simulation ? { simulation: details.simulation } : {}),
    outcome: { status: 'success' },
  } as CharacterizationObservation
}
