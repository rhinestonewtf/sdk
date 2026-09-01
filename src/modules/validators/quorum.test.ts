import { decodeAbiParameters, type Hex, zeroAddress } from 'viem'
import { describe, expect, test } from 'vitest'
import { accountA, accountB } from '../../../test/consts'
import type { QuorumValidatorConfig } from '../../types'
import {
  buildQuorumMerkleTree,
  encodeQuorumErc1271Signature,
  encodeQuorumMerkleSignature,
  encodeQuorumOwnerSignatures,
  getQuorumMockSignature,
  getQuorumValidator,
} from './quorum'

const moduleAddress = '0x0000000000000000000000000000000000000042'
const signature = `0x${'11'.repeat(64)}1b` as const

function config(
  overrides: Partial<QuorumValidatorConfig> = {},
): QuorumValidatorConfig {
  return {
    type: 'quorum',
    module: moduleAddress,
    owners: [{ account: accountA, weight: 1n }],
    thresholdWeight: 1n,
    ...overrides,
  }
}

describe('Quorum validator encoding', () => {
  test('encodes canonical installation data independently of owner order', () => {
    const owners = [
      { account: accountB, weight: 2n },
      { account: accountA, weight: 1n },
    ]
    const validator = getQuorumValidator(
      config({ owners, thresholdWeight: 2n }),
    )
    const reversed = getQuorumValidator(
      config({ owners: [...owners].reverse(), thresholdWeight: 2n }),
    )
    const [thresholdWeight, decodedOwners] = decodeAbiParameters(
      [
        { type: 'uint256' },
        {
          type: 'tuple[]',
          components: [
            { name: 'addr', type: 'address' },
            { name: 'weight', type: 'uint96' },
          ],
        },
      ],
      validator.initData,
    )

    expect(reversed.initData).toBe(validator.initData)
    expect(thresholdWeight).toBe(2n)
    expect(decodedOwners.map(({ addr }) => BigInt(addr))).toEqual(
      [...decodedOwners.map(({ addr }) => BigInt(addr))].sort((a, b) =>
        a < b ? -1 : 1,
      ),
    )
  })

  test('rejects malformed owner policies', () => {
    expect(() => getQuorumValidator(config({ owners: [] }))).toThrow(
      'owners length',
    )
    expect(() =>
      getQuorumValidator(
        config({
          owners: [
            { account: { ...accountA, address: zeroAddress }, weight: 1n },
          ],
        }),
      ),
    ).toThrow('zero address')
    expect(() =>
      getQuorumValidator(
        config({
          owners: [
            { account: accountA, weight: 1n },
            { account: accountA, weight: 1n },
          ],
        }),
      ),
    ).toThrow('Duplicate quorum owner')
    expect(() =>
      getQuorumValidator(
        config({ owners: [{ account: accountA, weight: 0n }] }),
      ),
    ).toThrow('fit uint96')
    expect(() =>
      getQuorumValidator(
        config({ owners: [{ account: accountA, weight: 1n << 96n }] }),
      ),
    ).toThrow('fit uint96')
    expect(() => getQuorumValidator(config({ thresholdWeight: 2n }))).toThrow(
      'total owner weight',
    )
  })

  test('sorts selected signatures and enforces configured weight', () => {
    const owners = [
      { ownerId: 'b', signer: accountB.address, weight: 2n },
      { ownerId: 'a', signer: accountA.address, weight: 1n },
    ]
    const encoded = encodeQuorumOwnerSignatures({
      owners,
      thresholdWeight: 3n,
      signatures: [
        { ownerId: 'b', signature },
        { ownerId: 'a', signature },
      ],
    })
    const firstAddress = `0x${encoded.slice(2, 42)}`

    expect(BigInt(firstAddress)).toBeLessThan(
      BigInt(`0x${encoded.slice(176, 216)}`),
    )
    expect(() =>
      encodeQuorumOwnerSignatures({
        owners,
        thresholdWeight: 3n,
        signatures: [{ ownerId: 'b', signature }],
      }),
    ).toThrow('Insufficient validator contribution weight')
    expect(() =>
      encodeQuorumOwnerSignatures({
        owners,
        thresholdWeight: 1n,
        signatures: [
          { ownerId: 'a', signature },
          { ownerId: 'a', signature },
        ],
      }),
    ).toThrow('Duplicate validator owner')
  })

  test('builds odd-sized trees and proof-bearing envelopes', () => {
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
    const weightedSignatures = `0x${'44'.repeat(88)}` as Hex
    const envelope = encodeQuorumMerkleSignature({
      operation: tree.operations[0],
      signatures: weightedSignatures,
    })

    expect(tree.operations[2].proof).toHaveLength(1)
    expect(envelope.slice(0, 4)).toBe('0x02')
    expect(envelope.endsWith(weightedSignatures.slice(2))).toBe(true)
    expect(() =>
      encodeQuorumMerkleSignature({
        operation: { root: tree.root, proof: [] },
        signatures: weightedSignatures,
      }),
    ).toThrow('between 1 and 32')
  })

  test('builds a maximum-cost regular mock signature', () => {
    const mock = getQuorumMockSignature(
      config({
        owners: [
          { account: accountA, weight: 1n },
          { account: accountB, weight: 1n },
        ],
      }),
    )

    expect(mock.startsWith('0x00')).toBe(true)
    expect(mock.length).toBe(2 + 2 + 2 * (40 + 4 + 130))
    expect(() => encodeQuorumErc1271Signature({ signatures: '0x' })).toThrow(
      'must not be empty',
    )
  })
})
