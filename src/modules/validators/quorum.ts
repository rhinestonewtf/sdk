import {
  type Address,
  concat,
  encodeAbiParameters,
  type Hex,
  hashTypedData,
  keccak256,
  size,
  toHex,
} from 'viem'
import { compareHexValues } from './ordering'
import type { ResolvedModule } from '../types'
import type {
  AtomicValidatorDefinition,
  ValidatorContributionInput,
} from './types'

const MAX_QUORUM_OWNERS = 32
const MAX_UINT96 = (1n << 96n) - 1n
const QUORUM_MESSAGE_TYPEHASH = keccak256(
  toHex(
    'WeightedOwnableValidatorMessage(address validator,uint256 chainId,address account,bytes32 hash)',
  ),
)

/** Bind an ERC-1271 digest to its Quorum module, chain, and smart account. */
export function getQuorumSignableHash(input: {
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

export interface QuorumMerkleProof {
  readonly root: Hex
  readonly proof: readonly Hex[]
}

export interface QuorumMerkleOperation extends QuorumMerkleProof {
  readonly account: Address
  readonly digest: Hex
  readonly leaf: Hex
}

/** Build account-bound leaves and Solady-compatible sorted-pair proofs. */
export function buildQuorumMerkleTree(
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

/** Hash the chain-agnostic EIP-712 root message signed by every owner. */
export function getQuorumMerkleRootSignableHash(input: {
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

function hashQuorumMerklePair(left: Hex, right: Hex): Hex {
  return compareHexValues(left, right) < 0
    ? keccak256(concat([left, right]))
    : keccak256(concat([right, left]))
}
const MAX_SIGNATURE_LENGTH = 65_535
const QUORUM_MOCK_SIGNATURE = `0x${'00'.repeat(64)}1b` as const

/** Resolve Quorum Signer installation data from a weighted owner definition. */
export function resolveQuorumValidator(
  definition: AtomicValidatorDefinition,
): ResolvedModule {
  if (definition.kind !== 'quorum') {
    throw new Error('Quorum resolver received a non-quorum validator')
  }
  const owners = resolveOwners(definition)
  const thresholdWeight = requireThresholdWeight(definition)
  validateQuorumConfig(owners, thresholdWeight)
  if (definition.module.source !== 'explicit') {
    throw new Error('Quorum validator requires a deployed module address')
  }
  return {
    kind: 'validator',
    address: definition.module.address,
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
        thresholdWeight,
        owners.map(({ signer, weight }) => ({ addr: signer, weight })),
      ],
    ),
    deInitData: '0x',
    additionalContext: '0x',
  }
}

/** Encode a regular Quorum Signer envelope from owner signature contributions. */
export function encodeQuorumValidatorContribution(input: {
  readonly owners: readonly {
    readonly ownerId: string
    readonly signer: Address
    readonly weight: bigint
  }[]
  readonly thresholdWeight: bigint
  readonly contributions: readonly Extract<
    ValidatorContributionInput,
    { readonly kind: 'ecdsa' }
  >[]
}): Hex {
  return concat(['0x00', encodeSelectedQuorumSignatures(input)])
}

function encodeSelectedQuorumSignatures(input: {
  readonly owners: readonly {
    readonly ownerId: string
    readonly signer: Address
    readonly weight: bigint
  }[]
  readonly thresholdWeight: bigint
  readonly contributions: readonly Extract<
    ValidatorContributionInput,
    { readonly kind: 'ecdsa' }
  >[]
}): Hex {
  validateQuorumConfig(input.owners, input.thresholdWeight)
  const configured = new Map(
    input.owners.map((owner) => [owner.ownerId, owner]),
  )
  const contributions = new Map<string, Hex>()
  for (const contribution of input.contributions) {
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
    .sort((left, right) => compareAddresses(left.signer, right.signer))
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

/** Encode one Merkle proof with an already packed weighted quorum. */
export function encodeQuorumMerkleEnvelope(input: {
  readonly proof: QuorumMerkleProof
  readonly signatures: Hex
}): Hex {
  if (input.proof.proof.length < 1 || input.proof.proof.length > 32) {
    throw new Error('Quorum Merkle proof length must be between 1 and 32')
  }
  if (input.signatures === '0x') {
    throw new Error('Quorum Merkle signatures must not be empty')
  }
  return concat([
    toHex(input.proof.proof.length, { size: 1 }),
    input.proof.root,
    ...input.proof.proof,
    input.signatures,
  ])
}

/** Encode weighted entries without the regular or Merkle envelope prefix. */
export function encodeQuorumWeightedSignatures(input: {
  readonly owners: readonly {
    readonly ownerId: string
    readonly signer: Address
    readonly weight: bigint
  }[]
  readonly thresholdWeight: bigint
  readonly contributions: readonly Extract<
    ValidatorContributionInput,
    { readonly kind: 'ecdsa' }
  >[]
}): Hex {
  return encodeSelectedQuorumSignatures(input)
}

/** Build a structurally valid maximum-cost signature for bundler gas estimation. */
export function encodeQuorumMockSignature(
  definition: AtomicValidatorDefinition,
): Hex {
  if (definition.kind !== 'quorum') {
    throw new Error('Quorum mock signature requires a quorum validator')
  }
  const owners = resolveOwners(definition)
  validateQuorumConfig(owners, requireThresholdWeight(definition))
  return concat([
    '0x00',
    encodeQuorumEntries(
      owners
        .map(({ signer }) => ({ signer, signature: QUORUM_MOCK_SIGNATURE }))
        .sort((left, right) => compareAddresses(left.signer, right.signer)),
    ),
  ])
}

function encodeQuorumEntries(
  entries: readonly { readonly signer: Address; readonly signature: Hex }[],
): Hex {
  if (entries.length === 0)
    throw new Error('Quorum signature must not be empty')
  let previous: Address | undefined
  const packed = entries.map(({ signer, signature }) => {
    if (previous && compareAddresses(previous, signer) >= 0) {
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

function resolveOwners(definition: AtomicValidatorDefinition) {
  return definition.owners.map((owner) => {
    if (owner.kind === 'webauthn' || owner.weight === undefined) {
      throw new Error('Quorum validator requires weighted ECDSA owners')
    }
    return {
      ownerId: owner.id,
      signer: owner.account.address,
      weight: owner.weight,
    }
  })
}

function requireThresholdWeight(definition: AtomicValidatorDefinition): bigint {
  if (definition.thresholdWeight === undefined) {
    throw new Error('Quorum validator threshold weight is missing')
  }
  return definition.thresholdWeight
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
    if (signer === '0x0000000000000000000000000000000000000000') {
      throw new Error(`Quorum owner ${index} cannot be the zero address`)
    }
    if (seen.has(signer))
      throw new Error(`Duplicate quorum owner ${owner.signer}`)
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

function compareAddresses(left: Address, right: Address): number {
  return compareHexValues(left, right)
}
