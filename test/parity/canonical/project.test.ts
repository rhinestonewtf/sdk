import { describe, expect, test } from 'vitest'
import { compare } from '../compare'
import type { HttpRecord, RunRecords } from '../context'
import { normalize } from '../normalize'
import { project } from './project'

function submitRecord(apiKey: boolean): HttpRecord {
  return {
    seq: 1,
    step: 'submit',
    method: 'POST',
    path: '/intent-operations',
    query: {},
    apiVersion: 'alps',
    op: 'submit',
    apiVersionHeader: undefined,
    sdkVersionHeader: '1.22.0',
    authHeadersPresent: {
      'x-api-key': apiKey,
      authorization: false,
      'x-intent-extension': false,
    },
    requestBody: {},
    status: 200,
    responseHeaders: {},
    responseBody: {},
    captured: true,
    faulted: false,
  }
}

const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'

function step(kind: 'prepare' | 'messages', value: unknown): RunRecords {
  return {
    http: [],
    signer: [],
    steps: [{ seq: 1, name: kind, kind, ok: true, value: value as never }],
  }
}

// Alps-shaped prepared value from 1.22.0: amounts are wire strings.
function alpsPrepared(accountType: 'EOA' | 'ERC7579'): RunRecords {
  return step('prepare', {
    intentInput: { ignored: true },
    intentRoute: {
      intentOp: { nonce: '1', signedMetadata: { account: { accountType } } },
      intentCost: { hasFulfilledAll: true },
      tokenRequirements: {
        '84532': {
          [USDC]: { type: 'approval', amount: '1000', spender: '0x01' },
        },
      },
    },
    transaction: { chain: 84532 },
  })
}

// Quote-shaped prepared value from the working tree: amounts are bigints.
function quotePrepared(withRequirements: boolean): RunRecords {
  return step('prepare', {
    intentInput: { ignored: true },
    quote: {
      intentId: '2',
      cost: { fees: { total: { usd: 1 } } },
      tokenRequirements: withRequirements
        ? {
            '84532': {
              [USDC]: { type: 'approval', amount: '1000n', spender: '0x01' },
            },
          }
        : undefined,
    },
    transaction: { chain: 84532 },
  })
}

describe('project', () => {
  test('traffic compares the auth headers a captured submit sent', () => {
    const records = (apiKey: boolean): RunRecords => ({
      http: [submitRecord(apiKey)],
      signer: [],
      steps: [],
    })
    const a = project(records(true))
    const b = project(records(false))
    expect(a.traffic).toEqual([
      { step: 'submit', ops: ['submit(captured) [x-api-key]'] },
    ])
    expect(compare('traffic', a.traffic, b.traffic)).toHaveLength(1)
  })

  test('the prepare step compares the transaction and EOA token requirements only', () => {
    expect(project(alpsPrepared('EOA')).steps).toEqual({
      prepare: {
        kind: 'prepare',
        ok: true,
        value: {
          tokenRequirements: {
            '84532': {
              [USDC]: { type: 'approval', amount: '1000', spender: '0x01' },
            },
          },
          transaction: { chain: 84532 },
        },
      },
    })
    const eoa = normalize(project(alpsPrepared('EOA'))).layers
    const candidate = normalize(project(quotePrepared(true))).layers
    expect(eoa.steps).toMatchObject({
      prepare: {
        value: {
          tokenRequirements: {
            '84532': { [USDC]: { amount: { $tolerance: { value: '1000' } } } },
          },
        },
      },
    })
    expect(compare('steps', eoa.steps, candidate.steps)).toEqual([])
  })

  test('alps token requirements on a smart account are not compared', () => {
    const smart = normalize(project(alpsPrepared('ERC7579'))).layers
    const candidate = normalize(project(quotePrepared(false))).layers
    expect(smart.steps).toEqual({
      prepare: {
        kind: 'prepare',
        ok: true,
        value: { transaction: { chain: 84532 } },
      },
    })
    expect(compare('steps', smart.steps, candidate.steps)).toEqual([])
  })

  test('typed-data integers compare by value, not representation', () => {
    const messages = (nonce: unknown, amounts: unknown[]) =>
      step('messages', {
        origin: [
          {
            domain: { chainId: 84532 },
            primaryType: 'Op',
            types: {
              Op: [
                { name: 'nonce', type: 'uint256' },
                { name: 'amounts', type: 'uint256[]' },
                { name: 'inner', type: 'Inner' },
                { name: 'data', type: 'bytes' },
              ],
              Inner: [{ name: 'value', type: 'int128' }],
            },
            message: {
              nonce,
              amounts,
              inner: { value: '-3' },
              data: '0x05',
            },
          },
        ],
      })
    const local = normalize(project(messages('5n', ['1n', '2']))).layers
    const served = normalize(project(messages('5', ['1', '2n']))).layers
    expect(compare('typedData', local.typedData, served.typedData)).toEqual([])
    expect(JSON.stringify(served.typedData)).toContain('"value":"-3n"')
    expect(JSON.stringify(served.typedData)).toContain('"data":"0x05"')
  })

  test('errors record whether the error carries a trace id', () => {
    const failed = (traceId: string): RunRecords => ({
      http: [],
      signer: [],
      steps: [
        {
          seq: 1,
          name: 'splits',
          kind: 'read',
          ok: false,
          error: {
            name: 'Error',
            ctor: 'InsufficientLiquidityError',
            message: 'Insufficient liquidity',
            statusCode: 422,
            context: { traceId },
            hasTraceId: traceId !== '',
          },
        },
      ],
    })
    const a = normalize(project(failed(''))).layers
    const b = normalize(project(failed('abc'))).layers
    expect(a.errors).toMatchObject({ splits: { hasTraceId: false } })
    expect(compare('errors', a.errors, b.errors).map((d) => d.path)).toEqual([
      '/splits/hasTraceId',
    ])
  })
})
