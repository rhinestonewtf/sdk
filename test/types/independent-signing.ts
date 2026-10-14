import type { Hex } from 'viem'
import type {
  OwnerPasskeySignature,
  OwnerSignature,
  OwnerSignatureData,
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
const kernelErc1271Hash = getQuorumErc1271SignableHash({
  validator: quorumConfig.module,
  chainId: 1,
  account: accountA.address,
  accountType: 'kernel',
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

const ecdsaSlot: Hex = `0x${'44'.repeat(65)}`
const passkeyPublicKey: Hex = `0x${'55'.repeat(64)}`
const minimalPasskeySlot = {
  webauthn: {
    authenticatorData: `0x${'66'.repeat(37)}`,
    clientDataJSON: '{"type":"webauthn.get"}',
  },
  signature: `0x${'77'.repeat(64)}`,
} satisfies OwnerPasskeySignature
const fullPasskeySlot = {
  webauthn: {
    authenticatorData: `0x${'66'.repeat(37)}`,
    challengeIndex: 23,
    clientDataJSON: '{"type":"webauthn.get"}',
    typeIndex: 1,
    userVerificationRequired: true,
  },
  signature: `0x${'77'.repeat(64)}`,
} satisfies OwnerPasskeySignature

const ecdsaFactor = {
  kind: 'ecdsa',
  signer: accountA.address,
  slots: [ecdsaSlot, ecdsaSlot],
} satisfies OwnerSignatureData
const passkeyFactor = {
  kind: 'passkey',
  publicKey: passkeyPublicKey,
  slots: [minimalPasskeySlot, fullPasskeySlot],
} satisfies OwnerSignatureData
const v3Contributions = [
  { intentId: 'intent-id', ...ecdsaFactor },
  { intentId: 'intent-id', ...passkeyFactor },
  {
    intentId: 'intent-id',
    kind: 'multi-factor',
    validatorId: 0,
    signature: ecdsaFactor,
  },
  {
    intentId: 'intent-id',
    kind: 'multi-factor',
    validatorId: '0x1234',
    signature: passkeyFactor,
  },
] satisfies OwnerSignature[]

const obsoleteEcdsa: OwnerSignature = {
  intentId: 'intent-id',
  kind: 'ecdsa',
  signer: accountA.address,
  // @ts-expect-error contributions carry `slots`, not the obsolete `origin`.
  origin: [ecdsaSlot],
}
const obsoletePasskey: OwnerSignature = {
  intentId: 'intent-id',
  kind: 'passkey',
  publicKey: passkeyPublicKey,
  // @ts-expect-error contributions carry `slots`, not the obsolete `origin`.
  origin: [minimalPasskeySlot],
}
const obsoleteMultiFactor: OwnerSignature = {
  intentId: 'intent-id',
  kind: 'multi-factor',
  validatorId: 0,
  signature: {
    kind: 'ecdsa',
    signer: accountA.address,
    // @ts-expect-error factor contributions carry `slots`, not `origin`.
    origin: [ecdsaSlot],
  },
}

async function readSignedContribution(): Promise<void> {
  const contribution = await account.signTransaction(prepared, {
    owner: accountA,
  })
  if (contribution.kind === 'ecdsa') {
    const slots: Hex[] = contribution.slots
    void slots
    // @ts-expect-error signed contributions no longer expose `origin`.
    void contribution.origin
  } else if (contribution.kind === 'passkey') {
    const slots: OwnerPasskeySignature[] = contribution.slots
    void slots
  } else {
    const validatorId: number | Hex = contribution.validatorId
    const slots: Hex[] | OwnerPasskeySignature[] = contribution.signature.slots
    void validatorId
    void slots
  }
}

declare const serialized: string
async function assembleTransported(): Promise<SignedTransactionData> {
  const transported: OwnerSignature = JSON.parse(serialized)
  return account.assembleTransaction(prepared, [
    await account.signTransaction(prepared, { owner: accountA }),
    transported,
  ])
}

void quorumConfig
void erc1271Hash
void kernelErc1271Hash
void rootHash
void regularSignature
void merkleSignature
void ownerSignature
void selectedOwnerSignature
void multiFactorOwnerSignature
void signedTransaction
void selectedSignedTransaction
void assembledTransaction
void v3Contributions
void obsoleteEcdsa
void obsoletePasskey
void obsoleteMultiFactor
void readSignedContribution
void assembleTransported
