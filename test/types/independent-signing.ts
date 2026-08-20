import type {
  OwnerSignature,
  PreparedTransactionData,
  QuorumValidatorConfig,
  RhinestoneAccount,
  SignedTransactionData,
} from '../../src/index'
import {
  buildQuorumSigningTree,
  encodeQuorumErc1271Signature,
  encodeQuorumMerkleSignature,
  encodeQuorumOwnerSignatures,
  getQuorumErc1271SignableHash,
  getQuorumSigningTreeHash,
  type QuorumSigningOwner,
} from '../../src/signing/quorum'
import { accountA } from '../consts'

declare const account: RhinestoneAccount
declare const prepared: PreparedTransactionData
declare const signatures: OwnerSignature[]
declare const quorumOwners: QuorumValidatorConfig['owners']

const quorumConfig: QuorumValidatorConfig = {
  type: 'quorum',
  module: '0x0000000000000000000000000000000000000042',
  thresholdWeight: 2n,
  owners: quorumOwners,
}

declare const quorumSigningOwners: readonly QuorumSigningOwner[]
const erc1271Hash = getQuorumErc1271SignableHash({
  validator: quorumConfig.module,
  chainId: 1,
  account: accountA.address,
  hash: `0x${'11'.repeat(32)}`,
})
const tree = buildQuorumSigningTree([
  { account: accountA.address, digest: erc1271Hash },
  { account: accountA.address, digest: `0x${'22'.repeat(32)}` },
])
const rootHash = getQuorumSigningTreeHash({
  validator: quorumConfig.module,
  root: tree.root,
})
const packedOwners = encodeQuorumOwnerSignatures({
  owners: quorumSigningOwners,
  thresholdWeight: 1n,
  signatures: [{ ownerId: 'owner-1', signature: `0x${'33'.repeat(65)}` }],
})
const regularSignature = encodeQuorumErc1271Signature({
  signatures: packedOwners,
})
const merkleSignature = encodeQuorumMerkleSignature({
  operation: tree.operations[0],
  signatures: packedOwners,
})

const ownerSignature: Promise<OwnerSignature> = account.signTransaction(
  prepared,
  { owner: accountA },
)
const selectedOwnerSignature: Promise<OwnerSignature> = account.signTransaction(
  prepared,
  { owner: accountA, intentId: 'intent-id' },
)
const multiFactorOwnerSignature: Promise<OwnerSignature> =
  account.signTransaction(prepared, {
    owner: accountA,
    validatorId: '0x1234',
  })
const signedTransaction: Promise<SignedTransactionData> =
  account.signTransaction(prepared)
const selectedSignedTransaction: Promise<SignedTransactionData> =
  account.signTransaction(prepared, { intentId: 'intent-id' })
const assembledTransaction: Promise<SignedTransactionData> =
  account.assembleTransaction(prepared, signatures)

void quorumConfig
void erc1271Hash
void rootHash
void regularSignature
void merkleSignature
void ownerSignature
void selectedOwnerSignature
void multiFactorOwnerSignature
void signedTransaction
void selectedSignedTransaction
void assembledTransaction
