export interface ExampleContext {
  setup: string
  assertions?: string
}

const sdk = `import { RhinestoneSDK as ReferenceSDK } from '@rhinestone/sdk'
import { base, optimism } from 'viem/chains'
import type { Address, Hex, LocalAccount } from 'viem'
declare const apiKey: string
declare const owner: LocalAccount
const sdk = new ReferenceSDK({ auth: { mode: 'apiKey', apiKey } })
const chain = base
`
const evm = `${sdk}
const account = await sdk.createAccount({ evm: { owners: { type: 'ecdsa', accounts: [owner] } } })
`
const solana = `${sdk}
import type { SolanaAddress } from '@rhinestone/sdk/solana'
import type { WebAuthnAccount } from 'viem/account-abstraction'
declare const swig: SolanaAddress
declare const newPasskey: WebAuthnAccount
declare const recoveryPublicKey: Hex
declare const oldPublicKey: Hex
declare const recoveryAddress: Address
declare const recoverySigner: LocalAccount
const account = await sdk.createAccount({ solana: { owner: { type: 'ecdsa', account: owner }, swig } })
`
const assertTypes = `type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T
`
function context(setup: string, assertions?: string): ExampleContext {
  return { setup, assertions: assertions && `${assertTypes}\n${assertions}` }
}
function argument(receiver: string, method: string, name: string, index = 0) {
  const callable = receiver ? `${receiver}.${method}` : method
  return `declare const ${name}: Parameters<typeof ${callable}>[${index}]\n`
}
function action(symbol: string, names: string[]): ExampleContext {
  return context(
    evm + names.map((name, i) => argument('', symbol, name, i)).join(''),
  )
}

// Each array registers every Usage block, including blocks needing no inputs.
export const exampleContexts: Record<string, ExampleContext[]> = {
  'rhinestone-sdk/rhinestone-sdk': [context('declare const apiKey: string\n')],
  'rhinestone-sdk/create-account': [
    context(
      'declare const apiKey: string\ndeclare const owner: import("viem").LocalAccount\n',
    ),
  ],
  'rhinestone-sdk/get-app-fee-balances': [context(sdk)],
  'rhinestone-sdk/get-intent-status': [
    context(`${sdk}declare const intentId: Hex\n`),
  ],
  'rhinestone-sdk/split-intents': [
    context(sdk + argument('sdk', 'splitIntents', 'input')),
  ],
  'rhinestone-sdk/create-session': [
    context(sdk + argument('sdk', 'createSession', 'definition')),
  ],
  'rhinestone-sdk/validate-session': [
    context(sdk + argument('sdk', 'validateSession', 'definition')),
  ],
  'account/deployment/deploy': [
    context(evm),
    context(`${evm}declare const usdcOnBase: Address\n`),
  ],
  'account/deployment/deploy-solana': [context(sdk)],
  'account/deployment/setup': [
    context(`${evm}declare const usdcOnBase: Address\n`),
  ],
  'account/deployment/get-init-data': [context(evm)],
  'account/deployment/is-deployed': [context(evm)],
  'account/deployment/sign-eip7702-init-data': [context(evm)],
  'account/reads/get-address': [
    context(evm, 'type NativeAddress = Assert<Equal<typeof address, Address>>'),
    context(
      solana,
      "type NativeAddress = Assert<Equal<typeof address, import('@rhinestone/sdk/solana').SolanaAddress>>",
    ),
  ],
  'account/reads/get-executors': [context(evm)],
  'account/reads/get-owners': [context(evm)],
  'account/reads/get-portfolio': [context(evm)],
  'account/reads/get-validators': [context(evm)],
  'account/signing/sign-message': [
    context(
      evm +
        argument('account', 'signMessage', 'message') +
        argument('account', 'signMessage', 'signers', 2),
    ),
  ],
  'account/signing/sign-typed-data': [
    context(
      evm +
        argument('account', 'signTypedData', 'parameters') +
        argument('account', 'signTypedData', 'signers', 2),
    ),
  ],
  'account/smart-sessions/get-session-details': [
    context(evm + argument('account', 'getSessionDetails', 'sessions')),
  ],
  'account/smart-sessions/is-session-enabled': [
    context(evm + argument('account', 'isSessionEnabled', 'session')),
  ],
  'account/smart-sessions/sign-enable-session': [
    context(evm + argument('account', 'signEnableSession', 'details')),
  ],
  'account/transactions/prepare-transaction': [
    context(`${evm}declare const calls: import('@rhinestone/sdk').Call[]\n`),
    context(
      `${evm}declare const usdcOnBase: Address\ndeclare const usdcOnOptimism: Address\ndeclare const recipient: Address\n`,
    ),
  ],
  'account/transactions/get-transaction-messages': [
    context(
      `${evm}declare const preparedTransaction: import('@rhinestone/sdk').PreparedTransactionData\n`,
    ),
  ],
  'account/transactions/sign-authorizations': [
    context(
      `${evm}declare const prepared: import('@rhinestone/sdk').PreparedTransactionData\ndeclare const contributions: import('@rhinestone/sdk').OwnerSignature[]\n`,
    ),
  ],
  'account/transactions/sign-transaction': [
    context(
      `${evm}declare const prepared: import('@rhinestone/sdk').PreparedTransactionData\n`,
      "type Ordinary = Assert<Equal<typeof signed, import('@rhinestone/sdk').SignedTransactionData>>",
    ),
    context(
      `${evm}declare const prepared: import('@rhinestone/sdk').PreparedTransactionData\n`,
      "type Detached = Assert<Equal<typeof contribution, import('@rhinestone/sdk').OwnerSignature>>",
    ),
  ],
  'account/transactions/assemble-transaction': [
    context(
      `${evm}declare const prepared: import('@rhinestone/sdk').PreparedTransactionData\ndeclare const contributions: import('@rhinestone/sdk').OwnerSignature[]\ndeclare const delegationProofs: Awaited<ReturnType<typeof account.signAuthorizations>>\n`,
    ),
  ],
  'account/transactions/sign-intent': [
    context(
      evm +
        argument('account', 'signIntent', 'signingRequests') +
        argument('account', 'signIntent', 'targetChain', 1),
    ),
  ],
  'account/transactions/submit-transaction': [
    context(
      `${evm}declare const signedTransaction: import('@rhinestone/sdk').SignedTransactionData\n`,
    ),
  ],
  'account/user-operations/prepare-user-operation': [
    context(evm + argument('account', 'prepareUserOperation', 'transaction')),
  ],
  'account/user-operations/send-user-operation': [
    context(evm + argument('account', 'sendUserOperation', 'transaction')),
  ],
  'account/user-operations/sign-user-operation': [
    context(
      `${evm}declare const preparedUserOperation: import('@rhinestone/sdk').PreparedUserOperationData\n`,
    ),
  ],
  'account/user-operations/submit-user-operation': [
    context(
      `${evm}declare const signedUserOperation: import('@rhinestone/sdk').SignedUserOperationData\n`,
    ),
  ],
  'account/execution/wait-for-execution': [
    context(
      `${evm}declare const intentResult: import('@rhinestone/sdk').TransactionResult\n`,
    ),
    context(
      `${evm}declare const userOperationResult: import('@rhinestone/sdk').UserOperationResult\n`,
      "type Receipt = Assert<Equal<typeof receipt, import('viem/account-abstraction').UserOperationReceipt>>",
    ),
  ],
  'actions/ecdsa/enable': [action('enable', ['owners'])],
  'actions/ecdsa/disable': [action('disable', [])],
  'actions/ecdsa/add-owner': [
    context(
      `${evm.replace(/\bowner\b/g, 'referenceOwner')}declare const owner: Address\n`,
    ),
  ],
  'actions/ecdsa/remove-owner': [
    action('removeOwner', ['prevOwner', 'ownerToRemove']),
  ],
  'actions/ecdsa/change-threshold': [
    action('changeThreshold', ['newThreshold']),
  ],
  'actions/passkeys/enable': [action('enable', ['credential'])],
  'actions/passkeys/disable': [action('disable', [])],
  'actions/passkeys/add-owner': [
    action('addOwner', ['pubKeyX', 'pubKeyY', 'requireUserVerification']),
  ],
  'actions/passkeys/remove-owner': [
    action('removeOwner', ['pubKeyX', 'pubKeyY']),
  ],
  'actions/passkeys/change-threshold': [
    action('changeThreshold', ['newThreshold']),
  ],
  'actions/recovery/enable': [action('enable', ['guardians'])],
  'actions/recovery/recover-ecdsa-ownership': [
    action('recoverEcdsaOwnership', ['options']),
  ],
  'actions/recovery/recover-passkey-ownership': [
    action('recoverPasskeyOwnership', ['options']),
  ],
  'actions/mfa/enable': [action('enable', ['validators'])],
  'actions/mfa/disable': [action('disable', [])],
  'actions/mfa/change-threshold': [action('changeThreshold', ['newThreshold'])],
  'actions/mfa/set-sub-validator': [
    action('setSubValidator', ['id', 'validator']),
  ],
  'actions/mfa/remove-sub-validator': [
    action('removeSubValidator', ['id', 'validator']),
  ],
  'actions/modules/install-module': [action('installModule', ['module'])],
  'actions/modules/uninstall-module': [action('uninstallModule', ['module'])],
  'actions/modules/deploy': [context(evm)],
  'actions/smart-sessions/enable': [action('enable', [])],
  'actions/smart-sessions/disable': [action('disable', [])],
  'actions/smart-sessions/enable-session': [
    action('enableSession', [
      'session',
      'enableSessionSignature',
      'hashesAndChainIds',
      'sessionToEnableIndex',
    ]),
  ],
  'actions/smart-sessions/disable-session': [
    action('disableSession', ['session']),
  ],
  'evm/experimental-get-rhinestone-init-data': [context(sdk)],
  'evm/experimental-get-v0-init-data': [context(sdk)],
  'evm/to-view-only-account': [
    context(`${sdk}declare const userAddress: Address\n`),
  ],
  'hyper-core/get-perp-market': [context('')],
  'hyper-core/get-perp-markets': [context('')],
  'hyper-core/get-perp-position': [context(evm)],
  'hyper-core/get-perp-positions': [context(evm)],
  'solana/solana-address': [context('declare const value: string\n')],
  'solana/create-solana-swig-id': [context('')],
  'solana/add-passkey': [context(solana)],
  'solana/remove-passkey': [context(solana)],
  'solana/add-ecdsa-key': [context(solana)],
  'solana/remove-ecdsa-key': [context(solana)],
  'solana/get-authority-status': [context(solana)],
}

export const inferredContracts = `${evm}
${assertTypes}
import { solanaAddress } from '@rhinestone/sdk/solana'
const solanaAccount = await sdk.createAccount({ solana: { owner: { type: 'ecdsa', account: owner }, swig: solanaAddress('11111111111111111111111111111111') } })
const native = solanaAccount.getAddress('solana')
type SolanaNative = Assert<Equal<typeof native, import('@rhinestone/sdk/solana').SolanaAddress>>
declare const intentResult: import('@rhinestone/sdk').TransactionResult
const intentStatus = await account.waitForExecution(intentResult)
type Intent = Assert<Equal<typeof intentStatus, Pick<import('@rhinestone/sdk').IntentOpStatus, 'traceId' | 'purpose' | 'status' | 'accounts' | 'operations' | 'refunds' | 'details'>>>
`
// Each probe must be rejected in its own file with its expected TS error code.
export const negativeExamples: Record<
  string,
  { source: string; code: number }
> = {
  auth: {
    source: `import { RhinestoneSDK } from '@rhinestone/sdk'\nnew RhinestoneSDK({})\n`,
    code: 2345,
  },
  legacy: {
    source: `${evm}await account.prepareTransaction({ chain, calls: [] })\n`,
    code: 2322,
  },
  import: {
    source: `import { missingPublicExport } from '@rhinestone/sdk'\n`,
    code: 2305,
  },
  capability: {
    source: `${sdk}const receiver = await sdk.createAccount({ evm: { address: '0x0000000000000000000000000000000000000001' } })\nawait receiver.prepareTransaction({ destination: { chain, calls: [] }, sponsored: true })\n`,
    code: 2339,
  },
}
