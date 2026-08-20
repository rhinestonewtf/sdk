import { type Hex, zeroAddress } from 'viem'
import { describe, expect, test } from 'vitest'
import { accountA, accountB } from '../../../test/consts'
import { encodeQuorumErc1271Signature } from '../../signing/quorum'
import {
  buildQuorumMerkleTree,
  encodeQuorumMerkleEnvelope,
  encodeQuorumMockSignature,
  encodeQuorumValidatorContribution,
  resolveQuorumValidator,
} from './quorum'
import type { AtomicValidatorDefinition } from './types'

const moduleAddress = '0x0000000000000000000000000000000000000042'
const signature = `0x${'11'.repeat(64)}1b` as const

function definition(
  input: {
    owners?: AtomicValidatorDefinition['owners']
    thresholdWeight?: bigint
    kind?: AtomicValidatorDefinition['kind']
    explicitModule?: boolean
  } = {},
): AtomicValidatorDefinition {
  return {
    kind: input.kind ?? 'quorum',
    id: 'quorum',
    publicId: 0,
    module:
      input.explicitModule === false
        ? { source: 'default', profile: 'ownable' }
        : { source: 'explicit', address: moduleAddress },
    owners: input.owners ?? [
      {
        kind: 'ecdsa',
        id: 'owner/a',
        signerId: `ecdsa:${accountA.address.toLowerCase()}`,
        account: accountA,
        weight: 1n,
      },
    ],
    threshold: 1,
    thresholdWeight: input.thresholdWeight ?? 1n,
  }
}

describe('Quorum validator encoding', () => {
  test('builds odd-sized trees and rejects a one-operation batch', () => {
    expect(() =>
      buildQuorumMerkleTree([
        { account: accountA.address, digest: `0x${'11'.repeat(32)}` },
      ]),
    ).toThrow('at least two operations')

    const tree = buildQuorumMerkleTree([
      { account: accountA.address, digest: `0x${'11'.repeat(32)}` },
      { account: accountA.address, digest: `0x${'22'.repeat(32)}` },
      { account: accountA.address, digest: `0x${'33'.repeat(32)}` },
    ])
    expect(tree.operations[2].proof).toHaveLength(1)
  })

  test('rejects incompatible resolver definitions', () => {
    expect(() => resolveQuorumValidator(definition({ kind: 'ecdsa' }))).toThrow(
      'non-quorum',
    )
    expect(() =>
      resolveQuorumValidator(definition({ explicitModule: false })),
    ).toThrow('deployed module address')
    expect(() =>
      encodeQuorumMockSignature(definition({ kind: 'ecdsa' })),
    ).toThrow('requires a quorum validator')
  })

  test('rejects malformed owner policies', () => {
    expect(() => resolveQuorumValidator(definition({ owners: [] }))).toThrow(
      'owners length',
    )
    expect(() =>
      resolveQuorumValidator(
        definition({
          owners: Array.from({ length: 33 }, (_, index) => ({
            kind: 'ecdsa' as const,
            id: `owner/${index}`,
            signerId: `ecdsa:${index}`,
            account: {
              ...accountA,
              address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
            },
            weight: 1n,
          })),
          thresholdWeight: 1n,
        }),
      ),
    ).toThrow('owners length')
    expect(() =>
      resolveQuorumValidator(
        definition({
          owners: [
            {
              kind: 'ecdsa',
              id: 'zero',
              signerId: 'zero',
              account: { ...accountA, address: zeroAddress },
              weight: 1n,
            },
          ],
        }),
      ),
    ).toThrow('zero address')
    expect(() =>
      resolveQuorumValidator(
        definition({
          owners: [
            {
              kind: 'ecdsa',
              id: 'zero-weight',
              signerId: 'zero-weight',
              account: accountA,
              weight: 0n,
            },
          ],
        }),
      ),
    ).toThrow('fit uint96')
    expect(() =>
      resolveQuorumValidator(
        definition({
          owners: [
            {
              kind: 'ecdsa',
              id: 'huge-weight',
              signerId: 'huge-weight',
              account: accountA,
              weight: 1n << 96n,
            },
          ],
        }),
      ),
    ).toThrow('fit uint96')
  })

  test('rejects invalid contributions and signature entries', () => {
    const owners = [
      { ownerId: 'owner/a', signer: accountA.address, weight: 1n },
      { ownerId: 'owner/b', signer: accountB.address, weight: 1n },
    ]
    expect(() =>
      encodeQuorumValidatorContribution({
        owners,
        thresholdWeight: 1n,
        contributions: [
          {
            kind: 'ecdsa',
            ownerId: 'unknown',
            signature,
            encoding: 'raw-signer',
          },
        ],
      }),
    ).toThrow('Unknown validator owner')
    expect(() =>
      encodeQuorumValidatorContribution({
        owners,
        thresholdWeight: 1n,
        contributions: [
          {
            kind: 'ecdsa',
            ownerId: 'owner/a',
            signature,
            encoding: 'raw-signer',
          },
          {
            kind: 'ecdsa',
            ownerId: 'owner/a',
            signature,
            encoding: 'raw-signer',
          },
        ],
      }),
    ).toThrow('Duplicate validator owner')
    expect(() =>
      encodeQuorumValidatorContribution({
        owners: [owners[0]],
        thresholdWeight: 1n,
        contributions: [
          {
            kind: 'ecdsa',
            ownerId: 'owner/a',
            signature: `0x${'11'.repeat(65_536)}`,
            encoding: 'raw-signer',
          },
        ],
      }),
    ).toThrow('exceeds 65535')
  })

  test('rejects malformed Merkle envelopes', () => {
    const proof = { root: `0x${'11'.repeat(32)}` as Hex, proof: [] as Hex[] }
    expect(() =>
      encodeQuorumMerkleEnvelope({ proof, signatures: signature }),
    ).toThrow('between 1 and 32')
    expect(() =>
      encodeQuorumMerkleEnvelope({
        proof: {
          ...proof,
          proof: Array.from(
            { length: 33 },
            () => `0x${'22'.repeat(32)}` as Hex,
          ),
        },
        signatures: signature,
      }),
    ).toThrow('between 1 and 32')
    expect(() =>
      encodeQuorumMerkleEnvelope({
        proof: { ...proof, proof: [`0x${'22'.repeat(32)}`] },
        signatures: '0x',
      }),
    ).toThrow('must not be empty')
    expect(() => encodeQuorumErc1271Signature({ signatures: '0x' })).toThrow(
      'must not be empty',
    )
  })
})
