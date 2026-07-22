import type { HashTypedDataParameters, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import * as ecdsaActions from '../../src/actions/ecdsa'
import * as actions from '../../src/actions/index'
import * as mfaActions from '../../src/actions/mfa'
import * as passkeyActions from '../../src/actions/passkeys'
import * as sessionActions from '../../src/actions/smart-sessions'
import type { SponsorLimitKey } from '../../src/errors/index'
import * as errors from '../../src/errors/index'
import {
  type PreparedTransactionData,
  type RhinestoneAccount,
  type RhinestoneAccountConfig,
  RhinestoneSDK,
  type SignData,
  type SignedIntentData,
  type SignedTransactionData,
  type SignerSet,
  type Transaction,
  type UserOperationResult,
} from '../../src/index'
import * as jwtServer from '../../src/jwt-server/index'
import * as passkeySigning from '../../src/signing/passkeys'
import * as smartSessions from '../../src/smart-sessions/index'
import * as utils from '../../src/utils/index'

const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const recipient = '0x0000000000000000000000000000000000000001'
const accountConfig = {
  account: { type: 'safe', version: '1.4.1', adapter: '2.0.0' },
  owners: { type: 'ecdsa', accounts: [owner], threshold: 1 },
} satisfies RhinestoneAccountConfig

new RhinestoneSDK({ apiKey: 'legacy-api-key' })
new RhinestoneSDK({
  auth: { mode: 'apiKey', apiKey: 'api-key' },
  provider: { type: 'custom', urls: { [mainnet.id]: 'https://rpc.example' } },
  bundler: { type: 'custom', url: 'https://bundler.example' },
  paymaster: {
    type: 'custom',
    url: { [mainnet.id]: 'https://paymaster.example' },
  },
  headers: { 'x-sdk-consumer': 'type-test' },
})
new RhinestoneSDK({
  auth: {
    mode: 'experimental_jwt',
    accessToken: async () => 'access-token',
    getIntentExtensionToken: async () => 'intent-extension-token',
  },
})

declare const account: RhinestoneAccount
declare const prepared: PreparedTransactionData
declare const signData: SignData
declare const typedData: HashTypedDataParameters
declare const sessionSigners: Extract<
  SignerSet,
  { type: 'experimental_session' }
>

const ownerSigners = {
  type: 'owner',
  kind: 'ecdsa',
  accounts: [owner],
} as const satisfies SignerSet

const transaction = {
  sourceChains: [mainnet],
  targetChain: mainnet,
  calls: [{ to: recipient, value: 1n }],
  recipient: accountConfig,
  signers: ownerSigners,
} satisfies Transaction

const sameChainTransaction = {
  chain: mainnet,
  calls: [],
  customDeadline: 9_999_999_999,
} satisfies Transaction

const crossChainWithDeadline = {
  sourceChains: [mainnet],
  targetChain: mainnet,
  calls: [],
  customDeadline: 9_999_999_999,
} as const
// @ts-expect-error customDeadline is only valid for same-chain transactions.
const crossChainTransaction: Transaction = crossChainWithDeadline
const sponsorLimitKey: SponsorLimitKey = 'perIntentUSD'

const preparedResult: Promise<PreparedTransactionData> =
  account.prepareTransaction(transaction)
const signedResult: Promise<SignedTransactionData> = account.signTransaction(
  prepared,
  { intentId: 'selected-intent' },
)
const messageSignature: Promise<Hex> = account.signMessage(
  'message',
  mainnet,
  ownerSigners,
)
const typedDataSignature: Promise<Hex> = account.signTypedData(
  typedData,
  mainnet,
  ownerSigners,
)
const intentSignature: Promise<SignedIntentData> = account.signIntent(
  signData,
  mainnet,
  sessionSigners,
)
const userOperation: Promise<UserOperationResult> = account.sendUserOperation({
  chain: mainnet,
  calls: [{ to: recipient }],
  signers: ownerSigners,
})

void preparedResult
void signedResult
void messageSignature
void typedDataSignature
void intentSignature
void userOperation
void sameChainTransaction
void crossChainTransaction
void sponsorLimitKey
void actions
void ecdsaActions
void mfaActions
void passkeyActions
void sessionActions
void errors
void jwtServer
void passkeySigning
void smartSessions
void utils
