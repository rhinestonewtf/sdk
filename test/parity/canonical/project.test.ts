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

function prepared(hasFulfilledAll: boolean): RunRecords {
  return {
    http: [],
    signer: [],
    steps: [
      {
        seq: 1,
        name: 'prepare',
        kind: 'prepare',
        ok: true,
        value: {
          intentInput: { ignored: true },
          intentRoute: {
            intentOp: { nonce: '1' },
            intentCost: { hasFulfilledAll },
            tokenRequirements: {},
          },
          transaction: { chain: 84532 },
        },
      },
    ],
  }
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

  test('the prepare step compares the intent route, not the echoed input', () => {
    const a = normalize(project(prepared(true))).layers
    const b = normalize(project(prepared(false))).layers
    expect(a.steps).toMatchObject({
      prepare: {
        value: {
          intentRoute: { intentOp: { nonce: '<nonce>' } },
          transaction: { chain: 84532 },
        },
      },
    })
    expect(JSON.stringify(a.steps)).not.toContain('intentInput')
    expect(compare('steps', a.steps, b.steps).map((d) => d.path)).toEqual([
      '/prepare/value/intentRoute/intentCost/hasFulfilledAll',
    ])
  })
})
