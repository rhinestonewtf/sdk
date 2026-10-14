import { describe, expect, test } from 'vitest'
import { eip712Request } from '../../../test/utils/caucasus'
import type {
  SigningProof,
  SigningRequest,
} from '../../clients/orchestrator/public'
import type { IntentSigningRequest } from '../../signing/intent-plans/types'
import { assembleProofVector, requestSetId } from './proofs'

const requests: IntentSigningRequest[] = [
  {
    kind: 'eip712',
    index: 0,
    purpose: 'originAuthorization',
    artifactId: 'request-0',
    signatureFormat: 'account',
    payload: {
      id: '0xaa',
      chain: { kind: 'evm', id: 1, caip2: 'eip155:1' },
      typedData: {} as never,
      usage: 'intent-origin',
    },
    shape: 'hex',
    exposedForIndependentSigning: true,
  },
  {
    kind: 'eip7702',
    index: 1,
    purpose: 'delegationAuthorization',
    chainId: 1,
    contract: '0x0000000000000000000000000000000000000002',
  },
]

const wireRequests: SigningRequest[] = [eip712Request({ chainId: 1 })]
const setId = requestSetId(wireRequests)

const eip712: SigningProof = { kind: 'eip712', signature: '0xsig' }
const delegation: SigningProof = {
  kind: 'eip7702',
  nonce: 3,
  signature: { r: '0x1', s: '0x2', yParity: 0 },
}

describe('requestSetId', () => {
  test('is stable across key order', () => {
    const reordered = [
      { ...wireRequests[0], purpose: wireRequests[0]!.purpose },
    ] as SigningRequest[]
    expect(requestSetId(reordered)).toBe(setId)
  })

  // A re-quote produces different requests, so a contribution made against the
  // old set must not assemble into the new one.
  test('changes when any request changes', () => {
    expect(requestSetId([eip712Request({ chainId: 10 })])).not.toBe(setId)
  })
})

describe('assembleProofVector', () => {
  test('accepts a personal-sign contribution for a personal-sign slot', () => {
    const personal: SigningProof = { kind: 'personalSign', signature: '0xab' }
    expect(
      assembleProofVector({
        intentId: 'intent-1',
        requestSetId: setId,
        requests: [
          {
            kind: 'personalSign',
            index: 0,
            purpose: 'originAuthorization',
            message: 'ab'.repeat(32),
          },
        ],
        local: new Map(),
        contributions: [
          {
            intentId: 'intent-1',
            requestSetId: setId,
            requestIndex: 0,
            proof: personal,
          },
        ],
      }),
    ).toEqual([personal])
  })

  // An unsupported slot has no proof shape that could satisfy it, so a
  // contribution claiming one is refused rather than passed through.
  test('refuses any contribution for an unsupported slot', () => {
    expect(() =>
      assembleProofVector({
        intentId: 'intent-1',
        requestSetId: setId,
        requests: [
          {
            kind: 'unsupported',
            index: 0,
            purpose: 'originAuthorization',
            payloadKind: 'webauthn',
          },
        ],
        local: new Map(),
        contributions: [
          {
            intentId: 'intent-1',
            requestSetId: setId,
            requestIndex: 0,
            proof: eip712,
          },
        ],
      }),
    ).toThrow(/does not belong to this prepared transaction/)
  })

  const base = {
    intentId: 'intent-1',
    requestSetId: setId,
    requests,
  }

  test('merges local proofs with indexed contributions in request order', () => {
    expect(
      assembleProofVector({
        ...base,
        local: new Map([[0, eip712]]),
        contributions: [
          {
            intentId: 'intent-1',
            requestSetId: setId,
            requestIndex: 1,
            proof: delegation,
          },
        ],
      }),
    ).toEqual([eip712, delegation])
  })

  // Callers assembling from several parties have no reason to know the order.
  test('does not require contributions to be supplied in order', () => {
    const vector = assembleProofVector({
      ...base,
      local: new Map(),
      contributions: [
        {
          intentId: 'intent-1',
          requestSetId: setId,
          requestIndex: 1,
          proof: delegation,
        },
        {
          intentId: 'intent-1',
          requestSetId: setId,
          requestIndex: 0,
          proof: eip712,
        },
      ],
    })
    expect(vector).toEqual([eip712, delegation])
  })

  // A sparse vector is not a signed transaction, however complete it looks.
  test('refuses an incomplete vector, naming the missing slots', () => {
    expect(() =>
      assembleProofVector({ ...base, local: new Map([[0, eip712]]) }),
    ).toThrow(/missing proofs for signing request 1/)
  })

  test.each([
    [
      'another intent',
      { intentId: 'intent-2', requestSetId: setId, requestIndex: 1 },
    ],
    [
      'another request set',
      {
        intentId: 'intent-1',
        requestSetId: '0xdead' as `0x${string}`,
        requestIndex: 1,
      },
    ],
    [
      'an out-of-range slot',
      { intentId: 'intent-1', requestSetId: setId, requestIndex: 9 },
    ],
  ])('refuses a contribution from %s', (_name, overrides) => {
    expect(() =>
      assembleProofVector({
        ...base,
        local: new Map([[0, eip712]]),
        contributions: [{ ...overrides, proof: delegation }],
      }),
    ).toThrow(/does not belong to this prepared transaction/)
  })

  test('refuses a proof of the wrong kind for its slot', () => {
    expect(() =>
      assembleProofVector({
        ...base,
        local: new Map([[0, eip712]]),
        contributions: [
          {
            intentId: 'intent-1',
            requestSetId: setId,
            requestIndex: 1,
            proof: eip712,
          },
        ],
      }),
    ).toThrow(/does not belong to this prepared transaction/)
  })

  test('refuses two contributions claiming the same slot', () => {
    const contribution = {
      intentId: 'intent-1',
      requestSetId: setId,
      requestIndex: 1,
      proof: delegation,
    }
    expect(() =>
      assembleProofVector({
        ...base,
        local: new Map([[0, eip712]]),
        contributions: [contribution, contribution],
      }),
    ).toThrow(/does not belong to this prepared transaction/)
  })

  test('refuses a contribution for a slot the SDK already produced', () => {
    expect(() =>
      assembleProofVector({
        ...base,
        local: new Map<number, SigningProof>([
          [0, eip712],
          [1, delegation],
        ]),
        contributions: [
          {
            intentId: 'intent-1',
            requestSetId: setId,
            requestIndex: 1,
            proof: delegation,
          },
        ],
      }),
    ).toThrow(/does not belong to this prepared transaction/)
  })
})
