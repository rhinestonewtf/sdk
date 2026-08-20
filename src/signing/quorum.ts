import type { Address, Hex } from 'viem'
import {
  buildQuorumMerkleTree,
  encodeQuorumMerkleEnvelope,
  encodeQuorumWeightedSignatures,
  getQuorumMerkleRootSignableHash,
  getQuorumSignableHash,
  type QuorumMerkleOperation,
} from '../modules/validators/quorum'
/** One Quorum Signer owner used to assemble a weighted signature. */
export interface QuorumSigningOwner {
  /** Stable owner identifier used to associate an independently collected signature. */
  ownerId: string
  /** EOA or EIP-1271 signer address configured in the Quorum validator. */
  signer: Address
  /** Weight contributed when this owner's signature validates. */
  weight: bigint
}

/** One independently collected signature over a Quorum signing digest. */
export interface QuorumOwnerSignature {
  /** Identifier matching one configured {@link QuorumSigningOwner}. */
  ownerId: string
  /** Raw ECDSA or EIP-1271 signature bytes. */
  signature: Hex
}

/** Account-bound operation included in a Quorum Merkle signing batch. */
export interface QuorumMerkleSigningOperation {
  /** Smart account that will validate this operation. */
  account: Address
  /** Validator-specific operation digest placed in the account-bound Merkle leaf. */
  digest: Hex
}

/** Merkle root and one proof-bearing result for every input operation. */
export interface QuorumMerkleSigningTree {
  /** Shared root signed by the owner quorum. */
  root: Hex
  /** Proofs in the same order as the input operations. */
  operations: readonly QuorumMerkleOperation[]
}

/** Bind an ERC-1271 application hash to one Quorum validator, chain, and account. */
export function getQuorumErc1271SignableHash(input: {
  /** Deployed Quorum Signer validator address. */
  validator: Address
  /** Chain on which ERC-1271 validation will execute. */
  chainId: number
  /** Smart account that will call the validator. */
  account: Address
  /** Application hash passed to the smart account's ERC-1271 entry point. */
  hash: Hex
}): Hex {
  return getQuorumSignableHash(input)
}

/** Build account-bound Merkle leaves and proofs for a Quorum signing batch. */
export function buildQuorumSigningTree(
  operations: readonly QuorumMerkleSigningOperation[],
): QuorumMerkleSigningTree {
  return buildQuorumMerkleTree(operations)
}

/** Derive the chain-agnostic EIP-712 digest owners sign for a Quorum Merkle root. */
export function getQuorumSigningTreeHash(input: {
  /** Deployed Quorum Signer validator address shared by the target chains. */
  validator: Address
  /** Root returned by {@link buildQuorumSigningTree}. */
  root: Hex
}): Hex {
  return getQuorumMerkleRootSignableHash(input)
}

/** Pack weighted owner signatures without selecting a regular or Merkle envelope. */
export function encodeQuorumOwnerSignatures(input: {
  /** Complete configured owner policy, including weights. */
  owners: readonly QuorumSigningOwner[]
  /** Minimum aggregate weight required by the validator. */
  thresholdWeight: bigint
  /** Independently collected signatures over one common Quorum digest. */
  signatures: readonly QuorumOwnerSignature[]
}): Hex {
  return encodeQuorumWeightedSignatures({
    owners: input.owners.map(({ ownerId, signer, weight }) => ({
      ownerId,
      signer,
      weight,
    })),
    thresholdWeight: input.thresholdWeight,
    contributions: input.signatures.map(({ ownerId, signature }) => ({
      kind: 'ecdsa',
      ownerId,
      signature,
      encoding: 'raw-signer',
    })),
  })
}

/** Pack a regular ERC-1271 Quorum signature for one operation digest. */
export function encodeQuorumErc1271Signature(input: {
  /** Weighted owner entries returned by {@link encodeQuorumOwnerSignatures}. */
  signatures: Hex
}): Hex {
  if (input.signatures === '0x') {
    throw new Error('Quorum owner signatures must not be empty')
  }
  return `0x00${input.signatures.slice(2)}`
}

/** Pack one operation's Merkle proof and shared weighted owner signatures. */
export function encodeQuorumMerkleSignature(input: {
  /** Operation result returned by {@link buildQuorumSigningTree}. */
  operation: QuorumMerkleOperation
  /** Weighted owner entries returned by {@link encodeQuorumOwnerSignatures}. */
  signatures: Hex
}): Hex {
  return encodeQuorumMerkleEnvelope({
    proof: input.operation,
    signatures: input.signatures,
  })
}
