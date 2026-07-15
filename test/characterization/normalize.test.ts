import { describe, expect, it } from 'vitest'
import { normalizeObservation } from './normalize'

describe('characterization normalization', () => {
  it('normalizes only explicit volatile paths and records every reason', () => {
    const result = normalizeObservation(
      {
        requestId: 'request-123',
        operations: [
          { blockNumber: 100, chainId: 1 },
          { blockNumber: 101, chainId: 10 },
        ],
        traceUrl: 'https://trace-123.internal.example/trace/abc',
      },
      {
        rules: [
          {
            path: '/requestId',
            kind: 'generated-id',
            reason: 'generated for each orchestrator request',
          },
          {
            path: '/operations/*/blockNumber',
            kind: 'block-number',
            reason: 'depends on the testnet head',
          },
          {
            path: '/traceUrl',
            kind: 'infrastructure-hostname',
            reason: 'trace host is allocated per environment',
          },
        ],
      },
    )

    expect(result.value).toEqual({
      requestId: { $characterizationNormalized: 'generated-id' },
      operations: [
        {
          blockNumber: { $characterizationNormalized: 'block-number' },
          chainId: 1,
        },
        {
          blockNumber: { $characterizationNormalized: 'block-number' },
          chainId: 10,
        },
      ],
      traceUrl: 'https://infrastructure.invalid/trace/abc',
    })
    expect(result.appliedRules).toHaveLength(4)
    expect(result.appliedRules[0]).toEqual({
      path: '/requestId',
      kind: 'generated-id',
      reason: 'generated for each orchestrator request',
    })
  })

  it('retains explicit identity evidence while mapping isolated subjects', () => {
    const mapping = {
      path: '/account/address',
      identity: 'scenario-account',
      values: [
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
      ],
      reason: 'stateful subjects use isolated account salts',
    } as const
    const legacy = normalizeObservation(
      { account: { address: mapping.values[0] }, chainId: 1 },
      { identityMappings: [mapping] },
    )
    const rewrite = normalizeObservation(
      { account: { address: mapping.values[1] }, chainId: 1 },
      { identityMappings: [mapping] },
    )

    expect(legacy.value).toEqual(rewrite.value)
    expect(legacy.appliedIdentities).toEqual([
      {
        path: '/account/address',
        identity: 'scenario-account',
        original: mapping.values[0],
        reason: mapping.reason,
      },
    ])
    expect(rewrite.appliedIdentities[0]?.original).toBe(mapping.values[1])
  })

  it('rejects attempts to normalize semantic fields', () => {
    const semanticCases = [
      ['/accountAddress', 'transaction-hash'],
      ['/operations/0/chainId', 'block-number'],
      ['/input/amount', 'market-amount'],
      ['/calls/0/data', 'generated-id'],
      ['/signing/signature', 'generated-id'],
      ['/outcome/errorCode', 'generated-id'],
      ['/execution/terminalState', 'generated-id'],
    ] as const

    for (const [path, kind] of semanticCases) {
      expect(() =>
        normalizeObservation(
          {
            accountAddress: '0x1',
            operations: [{ chainId: 1 }],
            input: { amount: 1n },
            calls: [{ data: '0x' }],
            signing: { signature: '0x1234' },
            outcome: { errorCode: 'NO_ROUTE' },
            execution: { terminalState: 'failed' },
          },
          {
            rules: [{ path, kind, reason: 'test should reject this rule' }],
          },
        ),
      ).toThrow(/cannot remove semantic field/)
    }

    expect(() =>
      normalizeObservation(
        { prepared: { kind: 'intent' } },
        {
          rules: [
            {
              path: '/prepared/kind',
              kind: 'generated-id',
              reason: 'a discriminator is not a generated identifier',
            },
          ],
        },
      ),
    ).toThrow('is not approved for /prepared/kind')
  })

  it('allows explicit market, fee, and case canonicalization without deleting values', () => {
    const result = normalizeObservation(
      {
        quote: { marketAmount: 123n },
        fees: { feeAmount: 5n },
        publicLabel: 'KeRnEl',
      },
      {
        rules: [
          {
            path: '/quote/marketAmount',
            kind: 'market-amount',
            reason: 'quote output changes with market liquidity',
          },
          {
            path: '/fees/feeAmount',
            kind: 'fee-value',
            reason: 'fee output changes with gas prices',
          },
          {
            path: '/publicLabel',
            kind: 'case-insensitive',
            reason: 'the public label contract is case-insensitive',
          },
        ],
      },
    )

    expect(result.value).toEqual({
      quote: {
        marketAmount: { $characterizationNormalized: 'market-amount' },
      },
      fees: { feeAmount: { $characterizationNormalized: 'fee-value' } },
      publicLabel: 'kernel',
    })
  })

  it('rejects unused, ambiguous, unexplained, and container rules', () => {
    expect(() =>
      normalizeObservation(
        { requestId: 'one' },
        {
          rules: [
            {
              path: '/missing',
              kind: 'generated-id',
              reason: 'must exist',
            },
          ],
        },
      ),
    ).toThrow('Normalization definition did not match /missing')

    expect(() =>
      normalizeObservation(
        { requestId: 'one' },
        {
          rules: [
            { path: '/requestId', kind: 'generated-id', reason: 'one' },
            { path: '/*', kind: 'generated-id', reason: 'two' },
          ],
        },
      ),
    ).toThrow('Multiple normalization definitions match /requestId')

    expect(() =>
      normalizeObservation(
        { requestId: 'one' },
        {
          rules: [{ path: '/requestId', kind: 'generated-id', reason: '' }],
        },
      ),
    ).toThrow('must state a reason')

    expect(() =>
      normalizeObservation(
        { requestId: { raw: 'one' } },
        {
          rules: [
            {
              path: '/requestId',
              kind: 'generated-id',
              reason: 'cannot drop an identifier container',
            },
          ],
        },
      ),
    ).toThrow('may only replace a volatile leaf')
  })
})
