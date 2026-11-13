import { encodeFunctionData, parseAbi } from 'viem'
import { describe, expect, test } from 'vitest'
import { applyAccepted } from './accepted'
import { compare } from './compare'
import { matchGlob } from './glob'
import { normalizeLayer } from './normalize'
import { RULES, type Rule } from './rules'

const erc20 = parseAbi([
  'function approve(address spender, uint256 amount)',
  'function transfer(address to, uint256 amount)',
])
const SPENDER = '0x1d7df6ddc7328ac827eb4d7f171c60afb7f9a599' as const

function approve(amount: bigint, spender: `0x${string}` = SPENDER) {
  return encodeFunctionData({
    abi: erc20,
    functionName: 'approve',
    args: [spender, amount],
  })
}

function typedDataWith(message: Record<string, unknown>) {
  return { public: { messages: [{ role: 'origin[0]', message }] } }
}

function diffTypedData(a: Record<string, unknown>, b: Record<string, unknown>) {
  return compare(
    'typedData',
    normalizeLayer('typedData', typedDataWith(a), RULES, {}),
    normalizeLayer('typedData', typedDataWith(b), RULES, {}),
  )
}

describe('matchGlob', () => {
  test.each([
    ['**/traceId', '/a/b/traceId', true],
    ['**/traceId', '/traceId', true],
    ['*/value/id', '/submit/value/id', true],
    ['*/value/id', '/a/b/value/id', false],
    ['**/message/**/(nonce|expires)', '/public/messages/0/message/nonce', true],
    [
      '**/message/**/(nonce|expires)',
      '/public/messages/0/message/x/expires',
      true,
    ],
    [
      '**/message/**/(nonce|expires)',
      '/public/messages/0/message/nonces',
      false,
    ],
    ['/reads/(splits|appFeeBalances)/result', '/reads/splits/result', true],
  ])('%s ~ %s → %s', (pattern, path, expected) => {
    expect(matchGlob(pattern, path)).toBe(expected)
  })
})

describe('normalization rules', () => {
  test('masks nonces and counts the hit', () => {
    const hits = {}
    const value = normalizeLayer(
      'typedData',
      typedDataWith({ nonce: '1' }),
      RULES,
      hits,
    )
    expect(value).toEqual(typedDataWith({ nonce: '<nonce>' }))
    expect(hits).toEqual({ 'typed-data.nonce': 1 })
  })

  test('ignores trace ids in every layer', () => {
    expect(
      normalizeLayer('errors', { a: { traceId: 'x', b: 1 } }, RULES, {}),
    ).toEqual({
      a: { b: 1 },
    })
  })

  test('tolerance accepts drift within 2% and rejects beyond', () => {
    const at = (exchangeRate: string) => ({ gasRefund: { exchangeRate } })
    expect(diffTypedData(at('1000'), at('1019'))).toEqual([])
    expect(diffTypedData(at('1000'), at('1021'))).toMatchObject([
      {
        kind: 'out-of-tolerance',
        path: '/public/messages/0/message/gasRefund/exchangeRate',
      },
    ])
  })

  test('approve calldata: amount within tolerance, spender exact', () => {
    const ops = (data: string) => ({ op: { ops: [{ data }] } })
    expect(diffTypedData(ops(approve(1000n)), ops(approve(1015n)))).toEqual([])
    expect(
      diffTypedData(ops(approve(1000n)), ops(approve(1100n))),
    ).toMatchObject([
      {
        kind: 'out-of-tolerance',
        path: '/public/messages/0/message/op/ops/0/data/$calldata/args/amount',
      },
    ])
    const other = '0x0000000000000000000000000000000000000001'
    expect(
      diffTypedData(ops(approve(1000n)), ops(approve(1000n, other))),
    ).toMatchObject([
      {
        kind: 'changed',
        path: '/public/messages/0/message/op/ops/0/data/$calldata/args/spender',
      },
    ])
  })

  test('transfer is decoded; unknown calldata stays exact', () => {
    const transfer = encodeFunctionData({
      abi: erc20,
      functionName: 'transfer',
      args: [SPENDER, 5n],
    })
    const decoded = normalizeLayer(
      'typedData',
      { ops: [{ data: transfer }, { data: '0xdeadbeef' }] },
      RULES,
      {},
    ) as { ops: { data: unknown }[] }
    expect(decoded.ops[0].data).toMatchObject({
      $calldata: { function: 'transfer' },
    })
    expect(decoded.ops[1].data).toBe('0xdeadbeef')
  })

  test('a session spend cap compares its amount within tolerance and its token exactly', () => {
    const cap = parseAbi([
      'function callbackAllowMaxAmount(address token, uint256 amount)',
    ])
    const op = (token: `0x${string}`, amount: bigint) => ({
      op: {
        ops: [
          {
            data: encodeFunctionData({
              abi: cap,
              functionName: 'callbackAllowMaxAmount',
              args: [token, amount],
            }),
          },
        ],
      },
    })
    expect(diffTypedData(op(SPENDER, 66726n), op(SPENDER, 66691n))).toEqual([])
    expect(
      diffTypedData(
        op(SPENDER, 1n),
        op(SPENDER.replace('1d', '2d') as `0x${string}`, 1n),
      ),
    ).toMatchObject([
      { path: '/public/messages/0/message/op/ops/0/data/$calldata/args/token' },
    ])
  })

  test('presence: a fee that appears is a diff even within the absolute tolerance', () => {
    const cost = (usd: number) => ({ q: { fees: { gas: { usd } } } })
    const run = (a: number, b: number) =>
      compare(
        'cost',
        normalizeLayer('cost', cost(a), RULES, {}),
        normalizeLayer('cost', cost(b), RULES, {}),
      )
    expect(run(0.1, 0.11)).toEqual([])
    expect(run(0.1, 0.115)).toEqual([])
    expect(run(0, 0.01)).toMatchObject([{ kind: 'out-of-tolerance' }])
  })

  test('scenario overrides widen a tolerance', () => {
    const overridden: Rule[] = RULES.map((rule) =>
      rule.id === 'typed-data.gas-refund' ? { ...rule, relative: 0.5 } : rule,
    )
    const at = (exchangeRate: string) =>
      normalizeLayer(
        'typedData',
        { gasRefund: { exchangeRate } },
        overridden,
        {},
      )
    expect(compare('typedData', at('100'), at('140'))).toEqual([])
  })
})

describe('funded execution rules', () => {
  test('sponsored gas fees compare within an absolute floor, and must both be charged or not', () => {
    const quote = (usd: number, microUsd: number) => ({
      prepare: {
        value: {
          intentRoute: {
            intentCost: { sponsorFee: { relayer: usd } },
            intentOp: {
              signedMetadata: {
                accounting: {
                  sponsorFee: {
                    surchargeUsd: usd,
                    plannedGasPrincipalMicroUsd: microUsd,
                  },
                },
              },
            },
          },
        },
      },
    })
    const run = (a: unknown, b: unknown) =>
      compare(
        'steps',
        normalizeLayer('steps', a, RULES, {}),
        normalizeLayer('steps', b, RULES, {}),
      )
    expect(run(quote(0.0139, 5918), quote(0.0159, 7932))).toEqual([])
    expect(run(quote(0.0139, 5918), quote(0.05, 40_000))).toHaveLength(3)
    expect(run(quote(0, 0), quote(0.001, 1000))).toHaveLength(3)
  })

  test('a wrapped native origin-op value compares within tolerance', () => {
    const op = (value: string) =>
      typedDataWith({
        mandate: { originOps: { ops: [{ to: '0x42', value }] } },
      })
    const run = (a: string, b: string) =>
      compare(
        'typedData',
        normalizeLayer('typedData', op(a), RULES, {}),
        normalizeLayer('typedData', op(b), RULES, {}),
      )
    expect(run('15368872988263', '15364553240671')).toEqual([])
    expect(run('15368872988263', '20000000000000')).toMatchObject([
      { kind: 'out-of-tolerance' },
    ])
  })

  const steps = (wait: unknown, permitNonce: string) => ({
    wait: { kind: 'wait', ok: true, value: wait },
    prepare: {
      kind: 'prepare',
      ok: true,
      value: {
        intentRoute: {
          tokenRequirements: {
            84532: {
              '0x036cbd53842c5426634e7929541ec2318f3dcf7e': {
                type: 'approval',
                permit: { message: { nonce: permitNonce, value: '1' } },
              },
            },
          },
        },
      },
    },
  })
  const run = (a: unknown, b: unknown) =>
    compare(
      'steps',
      normalizeLayer('steps', a, RULES, {}),
      normalizeLayer('steps', b, RULES, {}),
    )

  test('fill hashes, claim hashes and permit nonces vary per execution', () => {
    const hits = {}
    normalizeLayer(
      'steps',
      steps({ fill: { hash: '0xaa', chainId: 1 }, claims: [] }, '0'),
      RULES,
      hits,
    )
    expect(hits).toMatchObject({
      'steps.wait.fill-hash': 1,
      'steps.token-requirements.permit-nonce': 1,
    })
    expect(
      run(
        steps(
          { fill: { hash: '0xaa', chainId: 1 }, claims: [{ chainId: 2 }] },
          '0',
        ),
        steps(
          {
            fill: { hash: '0xbb', chainId: 1 },
            claims: [{ hash: '0xcc', chainId: 2 }],
          },
          '1',
        ),
      ),
    ).toEqual([])
  })

  test('the fill chain, the number of claims and the permit itself stay exact', () => {
    expect(
      run(
        steps({ fill: { hash: '0xaa', chainId: 1 }, claims: [] }, '0'),
        steps(
          { fill: { hash: '0xaa', chainId: 2 }, claims: [{ chainId: 2 }] },
          '0',
        ),
      ).map((diff) => diff.path),
    ).toEqual(['/wait/value/claims/0', '/wait/value/fill/chainId'])
  })
})

describe('compare', () => {
  test('reports missing, extra, type and changed', () => {
    expect(
      compare(
        'steps',
        { a: 1, b: [1], c: 'x', d: { e: 1 } },
        { a: 2, b: { 0: 1 }, d: {}, f: true },
      ),
    ).toEqual([
      { layer: 'steps', path: '/a', kind: 'changed', a: 1, b: 2 },
      { layer: 'steps', path: '/b', kind: 'type', a: [1], b: { 0: 1 } },
      { layer: 'steps', path: '/c', kind: 'missing', a: 'x', b: undefined },
      { layer: 'steps', path: '/d/e', kind: 'missing', a: 1, b: undefined },
      { layer: 'steps', path: '/f', kind: 'extra', a: undefined, b: true },
    ])
  })

  test('array length differences', () => {
    expect(compare('traffic', [1, 2], [1])).toEqual([
      { layer: 'traffic', path: '/1', kind: 'missing', a: 2, b: undefined },
    ])
  })
})

describe('accepted differences', () => {
  const diffs = compare(
    'errors',
    { s: { message: 'a', statusCode: 1 } },
    { s: { message: 'b', statusCode: 2 } },
  )

  test('move matching diffs out of the verdict with their reason', () => {
    const result = applyAccepted(diffs, 'seed/errors', [
      {
        layer: 'errors',
        path: '**/message',
        reason: 'message text is not part of the bar',
      },
    ])
    expect(result.accepted).toMatchObject([
      { path: '/s/message', reason: 'message text is not part of the bar' },
    ])
    expect(result.unaccepted).toMatchObject([{ path: '/s/statusCode' }])
  })

  test('respect the scenario glob', () => {
    const result = applyAccepted(diffs, 'seed/errors', [
      { layer: 'errors', path: '**', scenario: 'other/*', reason: 'x' },
    ])
    expect(result.accepted).toEqual([])
  })
})
