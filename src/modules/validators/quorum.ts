import {
  type Address,
  concat,
  encodeAbiParameters,
  type Hex,
  hashTypedData,
  keccak256,
  size,
  toHex,
  zeroAddress,
} from 'viem'
import type { QuorumValidatorConfig } from '../../types'
import type { Module } from '../common'
import { MODULE_TYPE_ID_VALIDATOR } from '../common'
import { compareHexValues } from './ordering'

const MAX_QUORUM_OWNERS = 32
const MAX_UINT96 = (1n << 96n) - 1n
const MAX_SIGNATURE_LENGTH = 65_535
const QUORUM_MOCK_SIGNATURE = `0x${'00'.repeat(64)}1b` as const
const QUORUM_MESSAGE_TYPEHASH = keccak256(
  toHex(
    'WeightedOwnableValidatorMessage(address validator,uint256 chainId,address account,bytes32 hash)',
  ),
)

interface QuorumSigningOwner {
  readonly ownerId: string
  readonly signer: Address
  readonly weight: bigint
}

interface QuorumOwnerSignature {
  readonly ownerId: string
  readonly signature: Hex
}

interface QuorumMerkleProof {
  readonly root: Hex
  readonly proof: readonly Hex[]
}

interface QuorumMerkleOperation extends QuorumMerkleProof {
  readonly account: Address
  readonly digest: Hex
  readonly leaf: Hex
}

function getQuorumSignableHash(input: {
  readonly validator: Address
  readonly chainId: number
  readonly account: Address
  readonly hash: Hex
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'bytes32' },
      ],
      [
        QUORUM_MESSAGE_TYPEHASH,
        input.validator,
        BigInt(input.chainId),
        input.account,
        input.hash,
      ],
    ),
  )
}

function buildQuorumMerkleTree(
  operations: readonly {
    readonly account: Address
    readonly digest: Hex
  }[],
): {
  readonly root: Hex
  readonly operations: readonly QuorumMerkleOperation[]
} {
  if (operations.length < 2) {
    throw new Error('Quorum Merkle signing requires at least two operations')
  }
  const leaves = operations.map(({ account, digest }) =>
    keccak256(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'bytes32' }],
        [account, digest],
      ),
    ),
  )
  const layers: Hex[][] = [leaves]
  while (layers.at(-1)!.length > 1) {
    const current = layers.at(-1)!
    const next: Hex[] = []
    for (let index = 0; index < current.length; index += 2) {
      next.push(
        index + 1 < current.length
          ? hashQuorumMerklePair(current[index], current[index + 1])
          : current[index],
      )
    }
    layers.push(next)
  }
  const root = layers.at(-1)![0]
  return {
    root,
    operations: operations.map(({ account, digest }, leafIndex) => {
      const proof: Hex[] = []
      let index = leafIndex
      for (const layer of layers.slice(0, -1)) {
        const siblingIndex = index % 2 === 0 ? index + 1 : index - 1
        if (siblingIndex < layer.length) proof.push(layer[siblingIndex])
        index = Math.floor(index / 2)
      }
      return { account, digest, leaf: leaves[leafIndex], root, proof }
    }),
  }
}

function getQuorumMerkleRootSignableHash(input: {
  readonly validator: Address
  readonly root: Hex
}): Hex {
  return hashTypedData({
    domain: {
      name: 'Quorum Signer',
      version: '1',
      verifyingContract: input.validator,
    },
    types: {
      WeightedMerkleRoot: [{ name: 'root', type: 'bytes32' }],
    },
    primaryType: 'WeightedMerkleRoot',
    message: { root: input.root },
  })
}

function getQuorumValidator(config: QuorumValidatorConfig): Module {
  const owners = resolveOwners(config).sort((left, right) =>
    compareHexValues(left.signer, right.signer),
  )
  validateQuorumConfig(owners, config.thresholdWeight)
  return {
    address: config.module,
    initData: encodeAbiParameters(
      [
        { name: 'thresholdWeight', type: 'uint256' },
        {
          name: 'owners',
          type: 'tuple[]',
          components: [
            { name: 'addr', type: 'address' },
            { name: 'weight', type: 'uint96' },
          ],
        },
      ],
      [
        config.thresholdWeight,
        owners.map(({ signer, weight }) => ({ addr: signer, weight })),
      ],
    ),
    deInitData: '0x',
    additionalContext: '0x',
    type: MODULE_TYPE_ID_VALIDATOR,
  }
}

function encodeQuorumOwnerSignatures(input: {
  readonly owners: readonly QuorumSigningOwner[]
  readonly thresholdWeight: bigint
  readonly signatures: readonly QuorumOwnerSignature[]
}): Hex {
  validateQuorumConfig(input.owners, input.thresholdWeight)
  const configured = new Map(
    input.owners.map((owner) => [owner.ownerId, owner]),
  )
  const contributions = new Map<string, Hex>()
  for (const contribution of input.signatures) {
    if (!configured.has(contribution.ownerId)) {
      throw new Error(`Unknown validator owner ${contribution.ownerId}`)
    }
    if (contributions.has(contribution.ownerId)) {
      throw new Error(`Duplicate validator owner ${contribution.ownerId}`)
    }
    contributions.set(contribution.ownerId, contribution.signature)
  }
  const selected = input.owners
    .filter((owner) => contributions.has(owner.ownerId))
    .sort((left, right) => compareHexValues(left.signer, right.signer))
  const signedWeight = selected.reduce((sum, owner) => sum + owner.weight, 0n)
  if (signedWeight < input.thresholdWeight) {
    throw new Error(
      `Insufficient validator contribution weight: required ${input.thresholdWeight}, received ${signedWeight}`,
    )
  }
  return encodeQuorumEntries(
    selected.map((owner) => ({
      signer: owner.signer,
      signature: contributions.get(owner.ownerId)!,
    })),
  )
}

function encodeQuorumErc1271Signature(input: {
  readonly signatures: Hex
}): Hex {
  if (input.signatures === '0x') {
    throw new Error('Quorum owner signatures must not be empty')
  }
  return concat(['0x00', input.signatures])
}

function encodeQuorumMerkleSignature(input: {
  readonly operation: QuorumMerkleProof
  readonly signatures: Hex
}): Hex {
  if (input.operation.proof.length < 1 || input.operation.proof.length > 32) {
    throw new Error('Quorum Merkle proof length must be between 1 and 32')
  }
  if (input.signatures === '0x') {
    throw new Error('Quorum Merkle signatures must not be empty')
  }
  return concat([
    toHex(input.operation.proof.length, { size: 1 }),
    input.operation.root,
    ...input.operation.proof,
    input.signatures,
  ])
}

function getQuorumMockSignature(config: QuorumValidatorConfig): Hex {
  const owners = resolveOwners(config)
  validateQuorumConfig(owners, config.thresholdWeight)
  return encodeQuorumErc1271Signature({
    signatures: encodeQuorumEntries(
      owners
        .map(({ signer }) => ({ signer, signature: QUORUM_MOCK_SIGNATURE }))
        .sort((left, right) => compareHexValues(left.signer, right.signer)),
    ),
  })
}

function getQuorumConfigOwners(
  config: QuorumValidatorConfig,
): QuorumSigningOwner[] {
  return resolveOwners(config)
}

function encodeQuorumEntries(
  entries: readonly { readonly signer: Address; readonly signature: Hex }[],
): Hex {
  if (entries.length === 0) {
    throw new Error('Quorum signature must not be empty')
  }
  let previous: Address | undefined
  const packed = entries.map(({ signer, signature }) => {
    if (previous && compareHexValues(previous, signer) >= 0) {
      throw new Error(
        'Quorum signer addresses must be strictly sorted and unique',
      )
    }
    previous = signer
    const signatureLength = size(signature)
    if (signatureLength > MAX_SIGNATURE_LENGTH) {
      throw new Error(
        `Quorum inner signature exceeds ${MAX_SIGNATURE_LENGTH} bytes`,
      )
    }
    return concat([signer, toHex(signatureLength, { size: 2 }), signature])
  })
  return concat(packed)
}

function resolveOwners(config: QuorumValidatorConfig): QuorumSigningOwner[] {
  return config.owners.map(({ account, weight }) => ({
    ownerId: account.address.toLowerCase(),
    signer: account.address,
    weight,
  }))
}

function validateQuorumConfig(
  owners: readonly { readonly signer: Address; readonly weight: bigint }[],
  thresholdWeight: bigint,
): void {
  if (owners.length < 1 || owners.length > MAX_QUORUM_OWNERS) {
    throw new Error(
      `Quorum owners length must be between 1 and ${MAX_QUORUM_OWNERS}`,
    )
  }
  const seen = new Set<string>()
  let totalWeight = 0n
  for (const [index, owner] of owners.entries()) {
    const signer = owner.signer.toLowerCase()
    if (signer === zeroAddress) {
      throw new Error(`Quorum owner ${index} cannot be the zero address`)
    }
    if (seen.has(signer)) {
      throw new Error(`Duplicate quorum owner ${owner.signer}`)
    }
    seen.add(signer)
    if (owner.weight <= 0n || owner.weight > MAX_UINT96) {
      throw new Error(
        `Quorum owner ${owner.signer} weight must fit uint96 and be non-zero`,
      )
    }
    totalWeight += owner.weight
  }
  if (thresholdWeight <= 0n || thresholdWeight > totalWeight) {
    throw new Error(
      `Quorum threshold weight must be between 1 and total owner weight ${totalWeight}`,
    )
  }
}

function hashQuorumMerklePair(left: Hex, right: Hex): Hex {
  return compareHexValues(left, right) < 0
    ? keccak256(concat([left, right]))
    : keccak256(concat([right, left]))
}

export {
  buildQuorumMerkleTree,
  encodeQuorumErc1271Signature,
  encodeQuorumMerkleSignature,
  encodeQuorumOwnerSignatures,
  getQuorumConfigOwners,
  getQuorumMerkleRootSignableHash,
  getQuorumMockSignature,
  getQuorumSignableHash,
  getQuorumValidator,
}
export type {
  QuorumMerkleOperation,
  QuorumMerkleProof,
  QuorumOwnerSignature,
  QuorumSigningOwner,
}
