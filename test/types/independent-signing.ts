import type {
  OwnerSignature,
  PreparedTransactionData,
  RhinestoneAccount,
  SignedTransactionData,
} from '../../src/index'
import { accountA } from '../consts'

declare const account: RhinestoneAccount
declare const prepared: PreparedTransactionData
declare const signatures: OwnerSignature[]

const ownerSignature: Promise<OwnerSignature> = account.signTransaction(
  prepared,
  { owner: accountA },
)
const selectedOwnerSignature: Promise<OwnerSignature> = account.signTransaction(
  prepared,
  { owner: accountA, intentId: 'intent-id' },
)
const signedTransaction: Promise<SignedTransactionData> =
  account.signTransaction(prepared)
const selectedSignedTransaction: Promise<SignedTransactionData> =
  account.signTransaction(prepared, { intentId: 'intent-id' })
const assembledTransaction: Promise<SignedTransactionData> =
  account.assembleTransaction(prepared, signatures)

void ownerSignature
void selectedOwnerSignature
void signedTransaction
void selectedSignedTransaction
void assembledTransaction
